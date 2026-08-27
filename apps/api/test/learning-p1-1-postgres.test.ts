import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../src/migrate.js'

const connectionString = process.env.TEST_DATABASE_URL

if (process.env.CI && !connectionString) {
  throw new Error('TEST_DATABASE_URL is required in CI for PostgreSQL concurrency tests')
}

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
        ['0001_identity_guardian_consent.sql', '0002_one_time_trial.sql', '0004_learning_p1_1_idempotency.sql', '0005_learning_audit.sql'],
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
        { name: '0005_learning_audit.sql', count: '1' },
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

  it('rejects forged direct-SQL attempt outcomes until persisted grading evidence exists', async () => {
    const schema = await createSchema()
    const client = await connect(schema)
    try {
      await runMigrations(client)
      await seedCompleteDraft(client)
      await client.query(`
        UPDATE stage_exam_versions
        SET status = 'published', published_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [ids.version])
      await client.query(`
        INSERT INTO stage_attempts (id, student_id, exam_version_id, expires_at)
        VALUES ('00000000-0000-0000-0000-000000000301', $1, $2,
                CURRENT_TIMESTAMP + interval '20 minutes')
      `, [ids.student, ids.version])

      for (const transition of [
        `SET status = 'passed', submitted_at = CURRENT_TIMESTAMP, score = 1,
             passed = true, updated_at = CURRENT_TIMESTAMP`,
        `SET status = 'failed', submitted_at = CURRENT_TIMESTAMP, score = 0,
             passed = false, updated_at = CURRENT_TIMESTAMP`,
        `SET status = 'expired', expired_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`,
      ]) {
        await expect(client.query(`
          UPDATE stage_attempts ${transition}
          WHERE id = '00000000-0000-0000-0000-000000000301'
        `)).rejects.toThrow(/P1.3 grading runtime/)
      }

      const attempt = await client.query<{ status: string; score: string | null; passed: boolean | null }>(`
        SELECT status, score::text AS score, passed
        FROM stage_attempts
        WHERE id = '00000000-0000-0000-0000-000000000301'
      `)
      expect(attempt.rows).toEqual([{ status: 'open', score: null, passed: null }])
    } finally {
      await client.end()
    }
  }, 30_000)

  it('allows one direct-SQL idempotency completion and rejects every completed-row mutation', async () => {
    const schema = await createSchema()
    const client = await connect(schema)
    try {
      await runMigrations(client)
      await client.query(`INSERT INTO users (id, role, is_minor) VALUES ($1, 'student', false)`, [ids.student])
      await expect(client.query(`
        INSERT INTO idempotency_records
          (student_id, operation_scope, idempotency_key, request_hash, status, http_status,
           response_headers, response_body, completed_at, expires_at)
        VALUES ($1, 'stage_attempt.start:v1:forged', 'request-forged', decode(repeat('ab', 32), 'hex'),
                'completed', 201, '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP + interval '1 day')
      `, [ids.student])).rejects.toThrow(/must start in_progress/)
      await client.query(`
        INSERT INTO idempotency_records
          (student_id, operation_scope, idempotency_key, request_hash, expires_at)
        VALUES ($1, 'stage_attempt.start:v1:one', 'request-1', decode(repeat('ab', 32), 'hex'),
                CURRENT_TIMESTAMP + interval '1 day')
      `, [ids.student])
      await client.query(`
        UPDATE idempotency_records
        SET status = 'completed', http_status = 201,
            response_headers = '{"content-type":"application/json"}'::jsonb,
            response_body = '{"attempt_id":"one"}'::jsonb,
            completed_at = CURRENT_TIMESTAMP
        WHERE student_id = $1 AND operation_scope = 'stage_attempt.start:v1:one'
      `, [ids.student])

      for (const mutation of [
        'http_status = 202',
        `response_headers = '{"x-replayed":"true"}'::jsonb`,
        `response_body = '{"attempt_id":"forged"}'::jsonb`,
        'completed_at = CURRENT_TIMESTAMP',
        `status = 'in_progress', http_status = NULL, response_headers = NULL, response_body = NULL, completed_at = NULL`,
      ]) {
        await expect(client.query(`
          UPDATE idempotency_records SET ${mutation}
          WHERE student_id = $1 AND operation_scope = 'stage_attempt.start:v1:one'
        `, [ids.student])).rejects.toThrow(/completed idempotency record is immutable/)
      }
      await expect(client.query(`
        DELETE FROM idempotency_records
        WHERE student_id = $1 AND operation_scope = 'stage_attempt.start:v1:one'
      `, [ids.student])).rejects.toThrow(/completed idempotency record is immutable/)

      const snapshot = await client.query<{
        status: string
        http_status: number
        response_headers: unknown
        response_body: unknown
      }>(`
        SELECT status, http_status, response_headers, response_body
        FROM idempotency_records
        WHERE student_id = $1 AND operation_scope = 'stage_attempt.start:v1:one'
      `, [ids.student])
      expect(snapshot.rows).toEqual([{
        status: 'completed',
        http_status: 201,
        response_headers: { 'content-type': 'application/json' },
        response_body: { attempt_id: 'one' },
      }])
    } finally {
      await client.end()
    }
  }, 30_000)


  it('enforces the P1.2 audit invariants through direct PostgreSQL SQL', async () => {
    const schema = await createSchema()
    const client = await connect(schema)
    try {
      await runMigrations(client)
      await seedCompleteDraft(client)
      await client.query(`
        INSERT INTO users (id, role, is_minor) VALUES
          ('00000000-0000-0000-0000-000000000102', 'student', false);
        INSERT INTO auth_identities (id, user_id, provider, provider_subject) VALUES
          ('00000000-0000-0000-0000-000000000111', '${ids.student}', 'email_magic_link', 'student-sub'),
          ('00000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-000000000102', 'email_magic_link', 'other-sub');
        UPDATE stage_exam_versions SET status = 'published', published_at = CURRENT_TIMESTAMP WHERE id = '${ids.version}';
        INSERT INTO stage_attempts (id, student_id, exam_version_id, expires_at) VALUES
          ('00000000-0000-0000-0000-000000000301', '${ids.student}', '${ids.version}', CURRENT_TIMESTAMP + interval '20 minutes'),
          ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000102', '${ids.version}', CURRENT_TIMESTAMP + interval '20 minutes');
      `)
      const insert = (eventId: string, eventType: string, actorId: string, actorSubject: string,
        studentId: string, attemptId: string, requestId: string, occurredAt: string): Promise<unknown> => client.query(`
        INSERT INTO learning_audit_events
          (event_id, event_type, actor_id, actor_role, actor_auth_provider, actor_provider_subject,
           actor_relationship, student_id, attempt_id, request_id, reason, occurred_at)
        VALUES ($1, $2, $3, 'student', 'email_magic_link', $4, 'self', $5, $6, $7, 'postgres_gate', ${occurredAt})
      `, [eventId, eventType, actorId, actorSubject, studentId, attemptId, requestId])

      await expect(insert('00000000-0000-0000-0000-000000000401', 'attempt_submitted', ids.student,
        'student-sub', ids.student, '00000000-0000-0000-0000-000000000301', 'request-pg-1', 'CURRENT_TIMESTAMP')).rejects.toThrow(/not enabled/)
      await expect(insert('00000000-0000-0000-0000-000000000402', 'attempt_started',
        '00000000-0000-0000-0000-000000000102', 'other-sub', ids.student,
        '00000000-0000-0000-0000-000000000301', 'request-pg-2', '(SELECT started_at FROM stage_attempts WHERE id = $6)')).rejects.toThrow(/not attributed/)
      await insert('00000000-0000-0000-0000-000000000403', 'attempt_started', ids.student,
        'student-sub', ids.student, '00000000-0000-0000-0000-000000000301', 'request-pg-shared',
        '(SELECT started_at FROM stage_attempts WHERE id = $6)')
      await expect(insert('00000000-0000-0000-0000-000000000404', 'attempt_started',
        '00000000-0000-0000-0000-000000000102', 'other-sub', '00000000-0000-0000-0000-000000000102',
        '00000000-0000-0000-0000-000000000302', 'request-pg-shared',
        '(SELECT started_at FROM stage_attempts WHERE id = $6)')).rejects.toThrow()
      await expect(client.query(`UPDATE learning_audit_events SET actor_role = 'admin'`)).rejects.toThrow(/append-only/)
      await expect(client.query('TRUNCATE learning_audit_events')).rejects.toThrow(/append-only/)
    } finally {
      await client.end()
    }
  }, 30_000)

})
