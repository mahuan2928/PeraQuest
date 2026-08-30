import { randomUUID } from 'node:crypto'
import { Client, Pool } from 'pg'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../src/migrate.js'
import { PostgresStudentRepository } from '../src/repository.js'

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
        [
          '0001_identity_guardian_consent.sql',
          '0002_one_time_trial.sql',
          '0004_learning_p1_1_idempotency.sql',
          '0005_learning_audit.sql',
          '0006_learning_p1_3_1_stage_attempt_snapshot.sql',
          '0007_learning_p1_3_3_submit_grading.sql',
          '0008_learning_p1_3_4_terminal_audit.sql',
          '0009_learning_p1_3_5_knowledge_evidence.sql',
          '0010_learning_p1_3_6_mastery_due.sql',
        ],
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
        { name: '0006_learning_p1_3_1_stage_attempt_snapshot.sql', count: '1' },
        { name: '0007_learning_p1_3_3_submit_grading.sql', count: '1' },
        { name: '0008_learning_p1_3_4_terminal_audit.sql', count: '1' },
        { name: '0009_learning_p1_3_5_knowledge_evidence.sql', count: '1' },
        { name: '0010_learning_p1_3_6_mastery_due.sql', count: '1' },
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
      ]) {
        await expect(client.query(`
          UPDATE stage_attempts ${transition}
          WHERE id = '00000000-0000-0000-0000-000000000301'
        `)).rejects.toThrow(/exactly one scored answer per item/)
      }

      for (const transition of [
        `SET status = 'expired', expired_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`,
      ]) {
        await expect(client.query(`
          UPDATE stage_attempts ${transition}
          WHERE id = '00000000-0000-0000-0000-000000000301'
        `)).rejects.toThrow(/cannot expire before expires_at/)
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

  it('creates attempt snapshots and rejects direct snapshot injection even with a forged GUC', async () => {
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
        VALUES ('00000000-0000-0000-0000-000000000303', $1, $2,
                CURRENT_TIMESTAMP + interval '20 minutes')
      `, [ids.student, ids.version])

      const snapshots = await client.query<{ snapshot_hash: string; count: number }>(`
        SELECT a.snapshot_hash, count(s.id)::int AS count
        FROM stage_attempts a
        JOIN stage_attempt_item_snapshots s ON s.attempt_id = a.id
        WHERE a.id = '00000000-0000-0000-0000-000000000303'
        GROUP BY a.snapshot_hash
      `)
      expect(snapshots.rows).toEqual([{ snapshot_hash: expect.stringMatching(/^[0-9a-f]{64}$/), count: 1 }])

      await client.query('BEGIN')
      await client.query("SET LOCAL peraquest.stage_attempt_snapshot_write = 'on'")
      await expect(client.query(`
        INSERT INTO stage_attempt_item_snapshots
          (attempt_id, source_item_id, item_ref, position, prompt, skill_ref, knowledge_point_ref, max_score)
        VALUES ('00000000-0000-0000-0000-000000000303', $1, 'forged', 99,
                'Forged prompt.', 'reading', 'forged', 1)
      `, [ids.item])).rejects.toThrow(/snapshot trigger/)
      await client.query('ROLLBACK')
    } finally {
      await client.query('ROLLBACK').catch(() => undefined)
      await client.end()
    }
  }, 30_000)

  it('starts a formal attempt atomically with snapshot, idempotency, and audit records', async () => {
    const schema = await createSchema()
    const client = await connect(schema)
    const pool = new Pool({ connectionString, options: `-c search_path=${schema}` })
    try {
      await runMigrations(client)
      await seedCompleteDraft(client)
      await client.query(`
        INSERT INTO auth_identities (id, user_id, provider, provider_subject)
        VALUES ('00000000-0000-0000-0000-000000000701', $1, 'email_magic_link', 'student-start-sub')
      `, [ids.student])
      await client.query(`
        UPDATE stage_exam_versions
        SET status = 'published', published_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [ids.version])

      const repository = new PostgresStudentRepository(pool)
      const result = await repository.startStageAttempt({
        studentId: ids.student,
        stageExamId: ids.exam,
        attemptId: '00000000-0000-0000-0000-000000000304',
        idempotencyKey: 'start-key-1',
        requestHash: Buffer.from('a'.repeat(64), 'hex'),
        actorAuthProvider: 'email_magic_link',
        actorProviderSubject: 'student-start-sub',
        eventId: '00000000-0000-0000-0000-000000000801',
        requestId: '00000000-0000-0000-0000-000000000901',
      })

      expect(result.status).toBe('created')
      if (result.status !== 'created') throw new Error('expected created attempt')
      expect(result.attempt).toMatchObject({
        attemptId: '00000000-0000-0000-0000-000000000304',
        examVersionId: ids.version,
        status: 'open',
        passScore: 0.8,
      })
      expect(result.attempt.items).toHaveLength(1)
      expect(result.attempt.items[0]?.options).toHaveLength(2)
      expect(JSON.stringify(result.attempt)).not.toContain(ids.optionA)

      const counts = await client.query<{
        attempts: number
        snapshots: number
        idempotency: number
        audit: number
      }>(`
        SELECT
          (SELECT count(*)::int FROM stage_attempts) AS attempts,
          (SELECT count(*)::int FROM stage_attempt_item_snapshots) AS snapshots,
          (SELECT count(*)::int FROM stage_attempt_start_idempotency) AS idempotency,
          (SELECT count(*)::int FROM learning_audit_events WHERE event_type = 'attempt_started') AS audit
      `)
      expect(counts.rows).toEqual([{ attempts: 1, snapshots: 1, idempotency: 1, audit: 1 }])

      const replay = await repository.startStageAttempt({
        studentId: ids.student,
        stageExamId: ids.exam,
        attemptId: '00000000-0000-0000-0000-000000000305',
        idempotencyKey: 'start-key-1',
        requestHash: Buffer.from('a'.repeat(64), 'hex'),
        actorAuthProvider: 'email_magic_link',
        actorProviderSubject: 'student-start-sub',
        eventId: '00000000-0000-0000-0000-000000000802',
        requestId: '00000000-0000-0000-0000-000000000902',
      })
      expect(replay).toMatchObject({ status: 'replayed', attempt: result.attempt })

      const secondKey = await repository.startStageAttempt({
        studentId: ids.student,
        stageExamId: ids.exam,
        attemptId: '00000000-0000-0000-0000-000000000306',
        idempotencyKey: 'start-key-2',
        requestHash: Buffer.from('b'.repeat(64), 'hex'),
        actorAuthProvider: 'email_magic_link',
        actorProviderSubject: 'student-start-sub',
        eventId: '00000000-0000-0000-0000-000000000803',
        requestId: '00000000-0000-0000-0000-000000000903',
      })
      expect(secondKey).toEqual({ status: 'already_open' })
    } finally {
      await client.end()
      await pool.end()
    }
  }, 30_000)

  it('submits and scores a formal attempt using PostgreSQL-derived answer keys', async () => {
    const schema = await createSchema()
    const client = await connect(schema)
    const pool = new Pool({ connectionString, options: `-c search_path=${schema}` })
    try {
      await runMigrations(client)
      await seedCompleteDraft(client)
      await client.query(`
        INSERT INTO auth_identities (id, user_id, provider, provider_subject)
        VALUES ('00000000-0000-0000-0000-000000000702', $1, 'email_magic_link', 'student-submit-sub')
      `, [ids.student])
      await client.query(`
        UPDATE stage_exam_versions
        SET status = 'published', published_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [ids.version])

      const repository = new PostgresStudentRepository(pool)
      const started = await repository.startStageAttempt({
        studentId: ids.student,
        stageExamId: ids.exam,
        attemptId: '00000000-0000-0000-0000-000000000307',
        idempotencyKey: 'start-submit-key-1',
        requestHash: Buffer.from('c'.repeat(64), 'hex'),
        actorAuthProvider: 'email_magic_link',
        actorProviderSubject: 'student-submit-sub',
        eventId: '00000000-0000-0000-0000-000000000804',
        requestId: '00000000-0000-0000-0000-000000000904',
      })
      if (started.status !== 'created') throw new Error(`expected created attempt, got ${started.status}`)

      const key = await client.query<{ item_id: string; option_id: string }>(`
        SELECT item.id AS item_id, keys.correct_option_snapshot_id AS option_id
        FROM stage_attempt_item_snapshots item
        JOIN stage_attempt_answer_key_snapshots keys ON keys.item_snapshot_id = item.id
        WHERE item.attempt_id = $1
      `, [started.attempt.attemptId])
      const submit = await repository.submitStageAttempt({
        studentId: ids.student,
        attemptId: started.attempt.attemptId,
        idempotencyKey: 'submit-key-1',
        requestHash: Buffer.from('d'.repeat(64), 'hex'),
        actorAuthProvider: 'email_magic_link',
        actorProviderSubject: 'student-submit-sub',
        eventId: '00000000-0000-0000-0000-000000000805',
        requestId: '00000000-0000-0000-0000-000000000905',
        answers: [{ itemId: key.rows[0]!.item_id, selectedOptionId: key.rows[0]!.option_id }],
      })

      expect(submit.status).toBe('submitted')
      if (submit.status !== 'submitted') throw new Error(`expected submitted attempt, got ${submit.status}`)
      expect(submit.result).toMatchObject({
        attemptId: started.attempt.attemptId,
        status: 'passed',
        rawScore: 1,
        maxScore: 1,
        score: 1,
        passed: true,
        passScore: 0.8,
      })
      expect(submit.result.items).toEqual([{ itemId: key.rows[0]!.item_id, outcome: 'correct', earnedScore: 1, maxScore: 1 }])

      const replay = await repository.submitStageAttempt({
        studentId: ids.student,
        attemptId: started.attempt.attemptId,
        idempotencyKey: 'submit-key-1',
        requestHash: Buffer.from('d'.repeat(64), 'hex'),
        actorAuthProvider: 'email_magic_link',
        actorProviderSubject: 'student-submit-sub',
        eventId: '00000000-0000-0000-0000-000000000806',
        requestId: '00000000-0000-0000-0000-000000000906',
        answers: [{ itemId: key.rows[0]!.item_id, selectedOptionId: key.rows[0]!.option_id }],
      })
      expect(replay).toMatchObject({ status: 'replayed', result: submit.result })

      const persisted = await client.query<{
        scored_answers: number
        evidence: number
        applied_evidence: number
        mastery_score: string
        state: string
        due_matches: boolean
        submitted_audits: number
      }>(`
        SELECT
          (SELECT count(*)::int FROM stage_attempt_answers WHERE attempt_id = $1 AND outcome = 'correct' AND earned_score = 1) AS scored_answers,
          (SELECT count(*)::int FROM knowledge_evidence WHERE attempt_id = $1 AND outcome = 'correct' AND earned_score = 1) AS evidence,
          (SELECT count(*)::int FROM student_knowledge_applied_evidence WHERE student_id = $2) AS applied_evidence,
          (SELECT mastery_score::text FROM student_knowledge WHERE student_id = $2 AND knowledge_point_ref = 'unassigned') AS mastery_score,
          (SELECT state FROM student_knowledge WHERE student_id = $2 AND knowledge_point_ref = 'unassigned') AS state,
          (SELECT due_at = last_occurred_at + interval '14 days' FROM student_knowledge WHERE student_id = $2 AND knowledge_point_ref = 'unassigned') AS due_matches,
          (SELECT count(*)::int FROM learning_audit_events WHERE attempt_id = $1 AND event_type = 'attempt_submitted') AS submitted_audits
      `, [started.attempt.attemptId, ids.student])
      expect(persisted.rows).toEqual([{
        scored_answers: 1,
        evidence: 1,
        applied_evidence: 1,
        mastery_score: '1.000000',
        state: 'mastered',
        due_matches: true,
        submitted_audits: 1,
      }])
    } finally {
      await client.end()
      await pool.end()
    }
  }, 30_000)

  it('rolls back answers, terminal status, and idempotency when submit audit fails', async () => {
    const schema = await createSchema()
    const client = await connect(schema)
    const pool = new Pool({ connectionString, options: `-c search_path=${schema}` })
    try {
      await runMigrations(client)
      await seedCompleteDraft(client)
      await client.query(`
        INSERT INTO auth_identities (id, user_id, provider, provider_subject)
        VALUES ('00000000-0000-0000-0000-000000000703', $1, 'email_magic_link', 'student-rollback-sub')
      `, [ids.student])
      await client.query(`
        UPDATE stage_exam_versions
        SET status = 'published', published_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [ids.version])

      const repository = new PostgresStudentRepository(pool)
      const started = await repository.startStageAttempt({
        studentId: ids.student,
        stageExamId: ids.exam,
        attemptId: '00000000-0000-0000-0000-000000000308',
        idempotencyKey: 'start-rollback-key-1',
        requestHash: Buffer.from('e'.repeat(64), 'hex'),
        actorAuthProvider: 'email_magic_link',
        actorProviderSubject: 'student-rollback-sub',
        eventId: '00000000-0000-0000-0000-000000000807',
        requestId: '00000000-0000-0000-0000-000000000907',
      })
      if (started.status !== 'created') throw new Error(`expected created attempt, got ${started.status}`)

      const key = await client.query<{ item_id: string; option_id: string }>(`
        SELECT item.id AS item_id, keys.correct_option_snapshot_id AS option_id
        FROM stage_attempt_item_snapshots item
        JOIN stage_attempt_answer_key_snapshots keys ON keys.item_snapshot_id = item.id
        WHERE item.attempt_id = $1
      `, [started.attempt.attemptId])
      await expect(repository.submitStageAttempt({
        studentId: ids.student,
        attemptId: started.attempt.attemptId,
        idempotencyKey: 'submit-rollback-key-1',
        requestHash: Buffer.from('f'.repeat(64), 'hex'),
        actorAuthProvider: 'email_magic_link',
        actorProviderSubject: 'missing-submit-sub',
        eventId: '00000000-0000-0000-0000-000000000808',
        requestId: '00000000-0000-0000-0000-000000000908',
        answers: [{ itemId: key.rows[0]!.item_id, selectedOptionId: key.rows[0]!.option_id }],
      })).rejects.toThrow()

      const rollback = await client.query<{ status: string; answers: number; evidence: number; mastery: number; applied: number; idempotency: number; audit: number }>(`
        SELECT
          (SELECT status::text FROM stage_attempts WHERE id = $1) AS status,
          (SELECT count(*)::int FROM stage_attempt_answers WHERE attempt_id = $1) AS answers,
          (SELECT count(*)::int FROM knowledge_evidence WHERE attempt_id = $1) AS evidence,
          (SELECT count(*)::int FROM student_knowledge WHERE student_id = $3) AS mastery,
          (SELECT count(*)::int FROM student_knowledge_applied_evidence WHERE student_id = $3) AS applied,
          (SELECT count(*)::int FROM idempotency_records WHERE operation_scope = $2) AS idempotency,
          (SELECT count(*)::int FROM learning_audit_events WHERE attempt_id = $1 AND event_type = 'attempt_submitted') AS audit
      `, [started.attempt.attemptId, `stage_attempt.submit:v1:${started.attempt.attemptId}`, ids.student])
      expect(rollback.rows).toEqual([{ status: 'open', answers: 0, evidence: 0, mastery: 0, applied: 0, idempotency: 0, audit: 0 }])
    } finally {
      await client.end()
      await pool.end()
    }
  }, 30_000)

  it('rolls back answers, terminal status, audit, and idempotency when evidence creation fails', async () => {
    const schema = await createSchema()
    const client = await connect(schema)
    const pool = new Pool({ connectionString, options: `-c search_path=${schema}` })
    try {
      await runMigrations(client)
      await seedCompleteDraft(client)
      await client.query(`
        INSERT INTO auth_identities (id, user_id, provider, provider_subject)
        VALUES ('00000000-0000-0000-0000-000000000705', $1, 'email_magic_link', 'student-evidence-rollback-sub')
      `, [ids.student])
      await client.query(`
        UPDATE stage_exam_versions
        SET status = 'published', published_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [ids.version])
      await client.query(`
        CREATE OR REPLACE FUNCTION reject_knowledge_evidence_for_test()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'forced knowledge evidence failure' USING ERRCODE = '23514';
        END;
        $$;
        CREATE TRIGGER reject_knowledge_evidence_for_test_trg
        BEFORE INSERT ON knowledge_evidence
        FOR EACH ROW EXECUTE FUNCTION reject_knowledge_evidence_for_test();
      `)

      const repository = new PostgresStudentRepository(pool)
      const started = await repository.startStageAttempt({
        studentId: ids.student,
        stageExamId: ids.exam,
        attemptId: '00000000-0000-0000-0000-000000000310',
        idempotencyKey: 'start-evidence-rollback-key-1',
        requestHash: Buffer.from('3'.repeat(64), 'hex'),
        actorAuthProvider: 'email_magic_link',
        actorProviderSubject: 'student-evidence-rollback-sub',
        eventId: '00000000-0000-0000-0000-000000000812',
        requestId: '00000000-0000-0000-0000-000000000912',
      })
      if (started.status !== 'created') throw new Error(`expected created attempt, got ${started.status}`)

      const key = await client.query<{ item_id: string; option_id: string }>(`
        SELECT item.id AS item_id, keys.correct_option_snapshot_id AS option_id
        FROM stage_attempt_item_snapshots item
        JOIN stage_attempt_answer_key_snapshots keys ON keys.item_snapshot_id = item.id
        WHERE item.attempt_id = $1
      `, [started.attempt.attemptId])
      await expect(repository.submitStageAttempt({
        studentId: ids.student,
        attemptId: started.attempt.attemptId,
        idempotencyKey: 'submit-evidence-rollback-key-1',
        requestHash: Buffer.from('4'.repeat(64), 'hex'),
        actorAuthProvider: 'email_magic_link',
        actorProviderSubject: 'student-evidence-rollback-sub',
        eventId: '00000000-0000-0000-0000-000000000813',
        requestId: '00000000-0000-0000-0000-000000000913',
        answers: [{ itemId: key.rows[0]!.item_id, selectedOptionId: key.rows[0]!.option_id }],
      })).rejects.toThrow(/forced knowledge evidence failure/)

      const rollback = await client.query<{ status: string; answers: number; evidence: number; mastery: number; applied: number; idempotency: number; audit: number }>(`
        SELECT
          (SELECT status::text FROM stage_attempts WHERE id = $1) AS status,
          (SELECT count(*)::int FROM stage_attempt_answers WHERE attempt_id = $1) AS answers,
          (SELECT count(*)::int FROM knowledge_evidence WHERE attempt_id = $1) AS evidence,
          (SELECT count(*)::int FROM student_knowledge WHERE student_id = $3) AS mastery,
          (SELECT count(*)::int FROM student_knowledge_applied_evidence WHERE student_id = $3) AS applied,
          (SELECT count(*)::int FROM idempotency_records WHERE operation_scope = $2) AS idempotency,
          (SELECT count(*)::int FROM learning_audit_events WHERE attempt_id = $1 AND event_type = 'attempt_submitted') AS audit
      `, [started.attempt.attemptId, `stage_attempt.submit:v1:${started.attempt.attemptId}`, ids.student])
      expect(rollback.rows).toEqual([{ status: 'open', answers: 0, evidence: 0, mastery: 0, applied: 0, idempotency: 0, audit: 0 }])
    } finally {
      await client.end()
      await pool.end()
    }
  }, 30_000)

  it('expires an overdue formal attempt with terminal audit and idempotent replay', async () => {
    const schema = await createSchema()
    const client = await connect(schema)
    const pool = new Pool({ connectionString, options: `-c search_path=${schema}` })
    try {
      await runMigrations(client)
      await seedCompleteDraft(client)
      await client.query(`
        INSERT INTO auth_identities (id, user_id, provider, provider_subject)
        VALUES ('00000000-0000-0000-0000-000000000704', $1, 'email_magic_link', 'student-expire-sub')
      `, [ids.student])
      await client.query(`
        UPDATE stage_exam_versions
        SET status = 'published', published_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [ids.version])

      const repository = new PostgresStudentRepository(pool)
      const started = await repository.startStageAttempt({
        studentId: ids.student,
        stageExamId: ids.exam,
        attemptId: '00000000-0000-0000-0000-000000000309',
        idempotencyKey: 'start-expire-key-1',
        requestHash: Buffer.from('1'.repeat(64), 'hex'),
        actorAuthProvider: 'email_magic_link',
        actorProviderSubject: 'student-expire-sub',
        eventId: '00000000-0000-0000-0000-000000000809',
        requestId: '00000000-0000-0000-0000-000000000909',
      })
      if (started.status !== 'created') throw new Error(`expected created attempt, got ${started.status}`)
      await client.query('ALTER TABLE stage_attempts DISABLE TRIGGER stage_attempt_transition_trg')
      await client.query(`
        UPDATE stage_attempts
        SET started_at = CURRENT_TIMESTAMP - interval '2 hours',
            expires_at = CURRENT_TIMESTAMP - interval '1 hour'
        WHERE id = $1
      `, [started.attempt.attemptId])
      await client.query('ALTER TABLE stage_attempts ENABLE TRIGGER stage_attempt_transition_trg')

      const payload = {
        studentId: ids.student,
        attemptId: started.attempt.attemptId,
        idempotencyKey: 'submit-expire-key-1',
        requestHash: Buffer.from('2'.repeat(64), 'hex'),
        actorAuthProvider: 'email_magic_link' as const,
        actorProviderSubject: 'student-expire-sub',
        eventId: '00000000-0000-0000-0000-000000000810',
        requestId: '00000000-0000-0000-0000-000000000910',
        answers: [{ itemId: started.attempt.items[0]!.itemId, selectedOptionId: null }],
      }
      await expect(repository.submitStageAttempt(payload)).resolves.toEqual({ status: 'expired' })
      await expect(repository.submitStageAttempt({
        ...payload,
        eventId: '00000000-0000-0000-0000-000000000811',
        requestId: '00000000-0000-0000-0000-000000000911',
      })).resolves.toEqual({ status: 'expired' })

      const expired = await client.query<{ status: string; answers: number; evidence: number; mastery: number; applied: number; audits: number; idempotency_status: string; http_status: number }>(`
        SELECT
          (SELECT status::text FROM stage_attempts WHERE id = $1) AS status,
          (SELECT count(*)::int FROM stage_attempt_answers WHERE attempt_id = $1) AS answers,
          (SELECT count(*)::int FROM knowledge_evidence WHERE attempt_id = $1) AS evidence,
          (SELECT count(*)::int FROM student_knowledge WHERE student_id = $4) AS mastery,
          (SELECT count(*)::int FROM student_knowledge_applied_evidence WHERE student_id = $4) AS applied,
          (SELECT count(*)::int FROM learning_audit_events WHERE attempt_id = $1 AND event_type = 'attempt_expired') AS audits,
          (SELECT status::text FROM idempotency_records WHERE operation_scope = $2 AND idempotency_key = $3) AS idempotency_status,
          (SELECT http_status::int FROM idempotency_records WHERE operation_scope = $2 AND idempotency_key = $3) AS http_status
      `, [started.attempt.attemptId, `stage_attempt.submit:v1:${started.attempt.attemptId}`, payload.idempotencyKey, ids.student])
      expect(expired.rows).toEqual([{ status: 'expired', answers: 0, evidence: 0, mastery: 0, applied: 0, audits: 1, idempotency_status: 'completed', http_status: 410 }])
    } finally {
      await client.end()
      await pool.end()
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
        'student-sub', ids.student, '00000000-0000-0000-0000-000000000301', 'request-pg-1', 'CURRENT_TIMESTAMP')).rejects.toThrow(/attempt_submitted must match/)
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
