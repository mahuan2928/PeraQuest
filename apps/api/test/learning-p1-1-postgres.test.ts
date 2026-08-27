import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from '../src/migrate.js'

const connectionString = process.env.TEST_DATABASE_URL
const describePostgres = connectionString ? describe : describe.skip
const schemas: string[] = []

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`

const connect = async (schema?: string): Promise<Client> => {
  const client = new Client({ connectionString })
  await client.connect()
  if (schema) await client.query(`SET search_path TO ${quoteIdentifier(schema)}`)
  return client
}

const createSchema = async (): Promise<string> => {
  const schema = `p1_1_${randomUUID().replaceAll('-', '')}`
  const admin = await connect()
  try {
    await admin.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`)
  } finally {
    await admin.end()
  }
  schemas.push(schema)
  return schema
}

const ids = {
  student: '00000000-0000-0000-0000-000000000101',
  exam: '00000000-0000-0000-0000-000000000201',
  version: '00000000-0000-0000-0000-000000000202',
  item: '00000000-0000-0000-0000-000000000203',
  optionA: '00000000-0000-0000-0000-000000000204',
  optionB: '00000000-0000-0000-0000-000000000205',
}

const seedCompleteDraft = async (client: Client): Promise<void> => {
  await client.query(`
    INSERT INTO users (id, role, is_minor)
      VALUES ('${ids.student}', 'student', false);
    INSERT INTO stage_exams (id, exam_level, stage, code)
      VALUES ('${ids.exam}', 'eiken_grade_3', 1, 'stage-1');
    INSERT INTO stage_exam_versions
      (id, exam_id, version, pass_score, duration_seconds, content_hash)
      VALUES ('${ids.version}', '${ids.exam}', 1, 0.8, 1200, decode(repeat('ab', 32), 'hex'));
    INSERT INTO stage_exam_items (id, exam_version_id, item_ref, ordinal, prompt, points)
      VALUES ('${ids.item}', '${ids.version}', 'item-1', 1, 'Choose one.', 1);
    INSERT INTO stage_exam_item_options (id, item_id, option_ref, option_text, ordinal) VALUES
      ('${ids.optionA}', '${ids.item}', 'a', 'Alpha', 1),
      ('${ids.optionB}', '${ids.item}', 'b', 'Beta', 2);
    INSERT INTO stage_exam_item_answer_keys (item_id, correct_option_id)
      VALUES ('${ids.item}', '${ids.optionA}');
  `)
}

const expectStillBlocked = async (promise: Promise<unknown>): Promise<void> => {
  const state = await Promise.race([
    promise.then(() => 'settled', () => 'settled'),
    new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 100)),
  ])
  expect(state).toBe('blocked')
}

const createBarrier = (): {
  arrived: Promise<void>
  release: () => void
  arriveAndWait: () => Promise<void>
} => {
  let markArrived!: () => void
  let release!: () => void
  const arrived = new Promise<void>((resolve) => { markArrived = resolve })
  const released = new Promise<void>((resolve) => { release = resolve })
  return {
    arrived,
    release,
    arriveAndWait: async () => {
      markArrived()
      await released
    },
  }
}

const childWrites = [
  {
    name: 'item',
    sql: `INSERT INTO stage_exam_items (id, exam_version_id, item_ref, ordinal, prompt, points)
          VALUES ('00000000-0000-0000-0000-000000000211', '${ids.version}', 'late-item', 2, 'Late item.', 1)`,
    publicationSucceeds: false,
  },
  {
    name: 'option',
    sql: `INSERT INTO stage_exam_item_options (id, item_id, option_ref, option_text, ordinal)
          VALUES ('00000000-0000-0000-0000-000000000212', '${ids.item}', 'c', 'Gamma', 3)`,
    publicationSucceeds: true,
  },
  {
    name: 'answer key',
    sql: `UPDATE stage_exam_item_answer_keys SET grading_version = 2 WHERE item_id = '${ids.item}'`,
    publicationSucceeds: true,
  },
] as const

beforeAll(() => {
  if (!connectionString && process.env.CI) {
    throw new Error('TEST_DATABASE_URL is required in CI for PostgreSQL concurrency tests')
  }
})

afterEach(async () => {
  if (!connectionString) return
  const admin = await connect()
  try {
    for (const schema of schemas.splice(0)) {
      await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`)
    }
  } finally {
    await admin.end()
  }
})

describePostgres('learning P1.1 PostgreSQL concurrency', () => {
  it('serializes two first-deploy migration runners before schema_migrations exists', async () => {
    const schema = await createSchema()
    const first = await connect(schema)
    const second = await connect(schema)
    try {
      const [firstResult, secondResult] = await Promise.all([
        runMigrations(first),
        runMigrations(second),
      ])
      expect([firstResult, secondResult].sort((left, right) => right.length - left.length)).toEqual([
        ['0001_identity_guardian_consent.sql', '0002_one_time_trial.sql', '0004_learning_p1_1_idempotency.sql'],
        [],
      ])
      const ledger = await first.query<{ name: string; count: string }>(`
        SELECT name, count(*)::text AS count
        FROM schema_migrations
        GROUP BY name
        ORDER BY name
      `)
      expect(ledger.rows).toEqual([
        { name: '0001_identity_guardian_consent.sql', count: '1' },
        { name: '0002_one_time_trial.sql', count: '1' },
        { name: '0004_learning_p1_1_idempotency.sql', count: '1' },
      ])
    } finally {
      await Promise.all([first.end(), second.end()])
    }
  }, 30_000)

  it.each(childWrites)('serializes publication after an in-flight $name write', async ({ sql, publicationSucceeds }) => {
    const schema = await createSchema()
    const setup = await connect(schema)
    await runMigrations(setup)
    await seedCompleteDraft(setup)
    await setup.end()

    const childWriter = await connect(schema)
    const publisher = await connect(schema)
    const barrier = createBarrier()
    try {
      const childTransaction = (async (): Promise<void> => {
        await childWriter.query('BEGIN')
        await childWriter.query(sql)
        await barrier.arriveAndWait()
        await childWriter.query('COMMIT')
      })()
      await barrier.arrived

      await publisher.query('BEGIN')
      const publication = publisher.query(`
        UPDATE stage_exam_versions
        SET status = 'published', published_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [ids.version])
      await expectStillBlocked(publication)
      barrier.release()
      await childTransaction

      if (publicationSucceeds) {
        await expect(publication).resolves.toBeDefined()
        await publisher.query('COMMIT')
      } else {
        await expect(publication).rejects.toThrow(/incomplete/)
        await publisher.query('ROLLBACK')
      }

      const version = await publisher.query<{ status: string }>('SELECT status FROM stage_exam_versions WHERE id = $1', [ids.version])
      expect(version.rows).toEqual([{ status: publicationSucceeds ? 'published' : 'draft' }])
    } finally {
      barrier.release()
      await Promise.all([
        childWriter.query('ROLLBACK').catch(() => undefined),
        publisher.query('ROLLBACK').catch(() => undefined),
      ])
      await Promise.all([childWriter.end(), publisher.end()])
    }
  }, 30_000)

  it.each(childWrites)('rejects an in-flight $name write after publication commits', async ({ sql }) => {
    const schema = await createSchema()
    const setup = await connect(schema)
    await runMigrations(setup)
    await seedCompleteDraft(setup)
    await setup.end()

    const publisher = await connect(schema)
    const childWriter = await connect(schema)
    const barrier = createBarrier()
    try {
      const publicationTransaction = (async (): Promise<void> => {
        await publisher.query('BEGIN')
        await publisher.query(`
          UPDATE stage_exam_versions
          SET status = 'published', published_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `, [ids.version])
        await barrier.arriveAndWait()
        await publisher.query('COMMIT')
      })()
      await barrier.arrived

      await childWriter.query('BEGIN')
      const childWrite = childWriter.query(sql)
      await expectStillBlocked(childWrite)
      barrier.release()
      await publicationTransaction
      await expect(childWrite).rejects.toThrow(/immutable/)
      await childWriter.query('ROLLBACK')

      const result = await childWriter.query<{ status: string; item_count: number }>(`
        SELECT ev.status, count(i.id)::int AS item_count
        FROM stage_exam_versions ev
        JOIN stage_exam_items i ON i.exam_version_id = ev.id
        WHERE ev.id = $1
        GROUP BY ev.status
      `, [ids.version])
      expect(result.rows).toEqual([{ status: 'published', item_count: 1 }])
    } finally {
      barrier.release()
      await Promise.all([
        publisher.query('ROLLBACK').catch(() => undefined),
        childWriter.query('ROLLBACK').catch(() => undefined),
      ])
      await Promise.all([publisher.end(), childWriter.end()])
    }
  }, 30_000)
})
