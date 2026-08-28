import { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations, type MigrationDatabase } from '../src/migrate.js'

const databases: PGlite[] = []

const asMigrationDatabase = (database: PGlite): MigrationDatabase => ({
  query: async <Row extends Record<string, unknown>>(sql: string, parameters?: unknown[]) => {
    if (parameters === undefined && sql.split(';').filter((statement) => statement.trim().length > 0).length > 1) {
      const results = await database.exec(sql)
      return { rows: (results.at(-1)?.rows ?? []) as Row[] }
    }
    const result = await database.query<Row>(sql, parameters)
    return { rows: result.rows }
  },
})

const ids = {
  student: '00000000-0000-0000-0000-000000003001',
  guardian: '00000000-0000-0000-0000-000000003002',
  exam: '00000000-0000-0000-0000-000000003101',
  versionOne: '00000000-0000-0000-0000-000000003111',
  versionTwo: '00000000-0000-0000-0000-000000003112',
  itemOne: '00000000-0000-0000-0000-000000003201',
  itemTwo: '00000000-0000-0000-0000-000000003202',
  optionOneA: '00000000-0000-0000-0000-000000003301',
  optionOneB: '00000000-0000-0000-0000-000000003302',
  optionTwoA: '00000000-0000-0000-0000-000000003303',
  optionTwoB: '00000000-0000-0000-0000-000000003304',
  attemptOne: '00000000-0000-0000-0000-000000003401',
  attemptTwo: '00000000-0000-0000-0000-000000003402',
  attemptThree: '00000000-0000-0000-0000-000000003403',
  idempotency: '00000000-0000-0000-0000-000000003501',
}

const createDatabase = async (): Promise<PGlite> => {
  const database = new PGlite()
  databases.push(database)
  await runMigrations(asMigrationDatabase(database))
  return database
}

const seedPublishedExam = async (database: PGlite): Promise<void> => {
  await database.exec(`
    INSERT INTO users (id, role, is_minor) VALUES
      ('${ids.student}', 'student', false),
      ('${ids.guardian}', 'guardian', false);
    INSERT INTO stage_exams (id, exam_level, stage, code)
      VALUES ('${ids.exam}', 'eiken_grade_3', 1, 'diagnostic-stage');
    INSERT INTO stage_exam_versions
      (id, exam_id, version, pass_score, duration_seconds, content_hash)
      VALUES
      ('${ids.versionOne}', '${ids.exam}', 1, 0.8, 1200, decode(repeat('ab', 32), 'hex')),
      ('${ids.versionTwo}', '${ids.exam}', 2, 0.8, 1200, decode(repeat('cd', 32), 'hex'));
    INSERT INTO stage_exam_items
      (id, exam_version_id, item_ref, ordinal, prompt, points, skill_ref, knowledge_point_ref)
      VALUES
      ('${ids.itemOne}', '${ids.versionOne}', 'item-1', 1, 'Choose Alpha.', 1, 'reading', 'vocab-alpha'),
      ('${ids.itemTwo}', '${ids.versionTwo}', 'item-1', 1, 'Choose Gamma.', 1, 'reading', 'vocab-gamma');
    INSERT INTO stage_exam_item_options (id, item_id, option_ref, option_text, ordinal) VALUES
      ('${ids.optionOneA}', '${ids.itemOne}', 'a', 'Alpha', 1),
      ('${ids.optionOneB}', '${ids.itemOne}', 'b', 'Beta', 2),
      ('${ids.optionTwoA}', '${ids.itemTwo}', 'a', 'Gamma', 1),
      ('${ids.optionTwoB}', '${ids.itemTwo}', 'b', 'Delta', 2);
    INSERT INTO stage_exam_item_answer_keys (item_id, correct_option_id) VALUES
      ('${ids.itemOne}', '${ids.optionOneA}'),
      ('${ids.itemTwo}', '${ids.optionTwoA}');
    UPDATE stage_exam_versions
      SET status = 'published', published_at = CURRENT_TIMESTAMP
      WHERE id IN ('${ids.versionOne}', '${ids.versionTwo}');
  `)
}

const startAttempt = (database: PGlite, attemptId: string, versionId: string, studentId = ids.student): Promise<unknown> =>
  database.query(`
    INSERT INTO stage_attempts (id, student_id, exam_version_id, expires_at)
    VALUES ($1, $2, $3, CURRENT_TIMESTAMP + interval '20 minutes')
  `, [attemptId, studentId, versionId])

afterEach(async () => {
  await Promise.all(databases.map((database) => database.close()))
  databases.length = 0
})

describe('learning P1.3-1 stage attempt snapshots', () => {
  it('creates immutable question, option, and private answer snapshots with a stable hash', async () => {
    const database = await createDatabase()
    await seedPublishedExam(database)
    await startAttempt(database, ids.attemptOne, ids.versionOne)

    const attempts = await database.query<{ snapshot_hash: string; mode: string }>(`
      SELECT snapshot_hash, mode FROM stage_attempts WHERE id = $1
    `, [ids.attemptOne])
    expect(attempts.rows).toEqual([{ snapshot_hash: expect.stringMatching(/^[0-9a-f]{64}$/), mode: 'formal' }])

    const snapshots = await database.query<{
      prompt: string
      position: number
      skill_ref: string
      knowledge_point_ref: string
      max_score: string
      correct_option_text: string
    }>(`
      SELECT s.prompt, s.position, s.skill_ref, s.knowledge_point_ref, s.max_score::text,
             os.option_text AS correct_option_text
      FROM stage_attempt_item_snapshots s
      JOIN stage_attempt_answer_key_snapshots k ON k.item_snapshot_id = s.id
      JOIN stage_attempt_item_option_snapshots os ON os.id = k.correct_option_snapshot_id
      WHERE s.attempt_id = $1
    `, [ids.attemptOne])
    expect(snapshots.rows).toEqual([{
      prompt: 'Choose Alpha.',
      position: 1,
      skill_ref: 'reading',
      knowledge_point_ref: 'vocab-alpha',
      max_score: '1.000000',
      correct_option_text: 'Alpha',
    }])

    await expect(database.query(`
      UPDATE stage_attempt_item_snapshots SET prompt = 'tampered' WHERE attempt_id = $1
    `, [ids.attemptOne])).rejects.toThrow(/immutable/)
    await expect(database.query(`
      INSERT INTO stage_attempt_item_snapshots
        (attempt_id, source_item_id, item_ref, position, prompt, skill_ref, knowledge_point_ref, max_score)
      VALUES ($1, $2, 'forged', 99, 'Forged prompt.', 'reading', 'forged', 1)
    `, [ids.attemptOne, ids.itemOne])).rejects.toThrow(/snapshot trigger/)
    await database.query("SELECT set_config('peraquest.stage_attempt_snapshot_write', 'on', true)")
    await expect(database.query(`
      INSERT INTO stage_attempt_item_snapshots
        (attempt_id, source_item_id, item_ref, position, prompt, skill_ref, knowledge_point_ref, max_score)
      VALUES ($1, $2, 'forged-guc', 100, 'Forged prompt.', 'reading', 'forged', 1)
    `, [ids.attemptOne, ids.itemOne])).rejects.toThrow(/snapshot trigger/)
    await expect(database.query(`
      UPDATE stage_attempts SET snapshot_hash = repeat('0', 64) WHERE id = $1
    `, [ids.attemptOne])).rejects.toThrow()
  })

  it('keeps old attempt snapshots independent from later published exam versions', async () => {
    const database = await createDatabase()
    await seedPublishedExam(database)
    await startAttempt(database, ids.attemptOne, ids.versionOne)
    await startAttempt(database, ids.attemptTwo, ids.versionTwo)

    const rows = await database.query<{ attempt_id: string; prompt: string; snapshot_hash: string }>(`
      SELECT a.id AS attempt_id, s.prompt, a.snapshot_hash
      FROM stage_attempts a
      JOIN stage_attempt_item_snapshots s ON s.attempt_id = a.id
      ORDER BY a.id
    `)
    expect(rows.rows).toEqual([
      { attempt_id: ids.attemptOne, prompt: 'Choose Alpha.', snapshot_hash: expect.stringMatching(/^[0-9a-f]{64}$/) },
      { attempt_id: ids.attemptTwo, prompt: 'Choose Gamma.', snapshot_hash: expect.stringMatching(/^[0-9a-f]{64}$/) },
    ])
    expect(rows.rows[0]?.snapshot_hash).not.toBe(rows.rows[1]?.snapshot_hash)
  })

  it('enforces formal start idempotency uniqueness without hardcoding response payloads', async () => {
    const database = await createDatabase()
    await seedPublishedExam(database)
    await startAttempt(database, ids.attemptOne, ids.versionOne)
    await database.query(`
      INSERT INTO idempotency_records
        (id, student_id, operation_scope, idempotency_key, request_hash, expires_at)
      VALUES ($1, $2, 'stage_attempt.start:v1:${ids.exam}', 'start-key-1',
              decode(repeat('ab', 32), 'hex'), CURRENT_TIMESTAMP + interval '1 day')
    `, [ids.idempotency, ids.student])

    await database.query(`
      INSERT INTO stage_attempt_start_idempotency
        (student_id, exam_id, operation_scope, idempotency_key, attempt_id)
      VALUES ($1, '${ids.exam}', 'stage_attempt.start:v1:${ids.exam}', 'start-key-1', $2)
    `, [ids.student, ids.attemptOne])
    await expect(database.query(`
      INSERT INTO stage_attempt_start_idempotency
        (student_id, exam_id, operation_scope, idempotency_key, attempt_id)
      VALUES ($1, '${ids.exam}', 'stage_attempt.start:v1:${ids.exam}', 'start-key-1', $2)
    `, [ids.student, ids.attemptOne])).rejects.toThrow()
  })

  it('rejects guardian attempts, cross-item options, and duplicate answers', async () => {
    const database = await createDatabase()
    await seedPublishedExam(database)
    await expect(startAttempt(database, ids.attemptOne, ids.versionOne, ids.guardian)).rejects.toThrow(/active student/)
    await startAttempt(database, ids.attemptOne, ids.versionOne)

    const snapshot = await database.query<{ item_snapshot_id: string; option_snapshot_id: string }>(`
      SELECT s.id AS item_snapshot_id, os.id AS option_snapshot_id
      FROM stage_attempt_item_snapshots s
      JOIN stage_attempt_item_option_snapshots os ON os.item_snapshot_id = s.id
      WHERE s.attempt_id = $1 AND os.option_ref = 'a'
    `, [ids.attemptOne])
    const { item_snapshot_id, option_snapshot_id } = snapshot.rows[0]!

    await database.query(`
      INSERT INTO stage_attempt_answers
        (attempt_id, item_snapshot_id, answer_status, selected_option_snapshot_id, idempotency_key)
      VALUES ($1, $2, 'answered', $3, 'answer-1')
    `, [ids.attemptOne, item_snapshot_id, option_snapshot_id])
    await expect(database.query(`
      INSERT INTO stage_attempt_answers
        (attempt_id, item_snapshot_id, answer_status, selected_option_snapshot_id, idempotency_key)
      VALUES ($1, $2, 'skipped', NULL, 'answer-2')
    `, [ids.attemptOne, item_snapshot_id])).rejects.toThrow()
  })

  it('keeps Trial writes out of formal attempt, answer, snapshot, and audit tables', async () => {
    const database = await createDatabase()
    await database.query(`
      INSERT INTO users (id, role, is_minor) VALUES ($1, 'student', true)
    `, [ids.student])
    const before = await database.query<{ count: number }>(`
      SELECT
        (SELECT count(*)::int FROM stage_attempts) +
        (SELECT count(*)::int FROM stage_attempt_item_snapshots) +
        (SELECT count(*)::int FROM stage_attempt_answers) +
        (SELECT count(*)::int FROM learning_audit_events) AS count
    `)
    await database.query('INSERT INTO trial_redemptions (student_id) VALUES ($1)', [ids.student])
    await database.query(`
      INSERT INTO trial_attempts (id, student_id, expires_at)
      VALUES ('00000000-0000-0000-0000-000000003901', $1, now() + interval '10 minutes')
    `, [ids.student])
    const after = await database.query<{ count: number }>(`
      SELECT
        (SELECT count(*)::int FROM stage_attempts) +
        (SELECT count(*)::int FROM stage_attempt_item_snapshots) +
        (SELECT count(*)::int FROM stage_attempt_answers) +
        (SELECT count(*)::int FROM learning_audit_events) AS count
    `)
    expect(after.rows).toEqual(before.rows)
  })

  it('scores answers from snapshots and rejects forged terminal scores', async () => {
    const database = await createDatabase()
    await seedPublishedExam(database)
    await startAttempt(database, ids.attemptOne, ids.versionOne)

    const snapshot = await database.query<{ item_snapshot_id: string; correct_option_snapshot_id: string; wrong_option_snapshot_id: string }>(`
      SELECT s.id AS item_snapshot_id,
             max(os.id::text) FILTER (WHERE os.option_ref = 'a') AS correct_option_snapshot_id,
             max(os.id::text) FILTER (WHERE os.option_ref = 'b') AS wrong_option_snapshot_id
      FROM stage_attempt_item_snapshots s
      JOIN stage_attempt_item_option_snapshots os ON os.item_snapshot_id = s.id
      WHERE s.attempt_id = $1
      GROUP BY s.id
    `, [ids.attemptOne])
    const row = snapshot.rows[0]!
    await database.query(`
      INSERT INTO stage_attempt_answers
        (attempt_id, item_snapshot_id, answer_status, selected_option_snapshot_id, idempotency_key)
      VALUES ($1, $2, 'answered', $3, 'submit-1')
    `, [ids.attemptOne, row.item_snapshot_id, row.correct_option_snapshot_id])
    await expect(database.query(`
      UPDATE stage_attempts
      SET status = 'failed', submitted_at = CURRENT_TIMESTAMP, score = 0, passed = false,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [ids.attemptOne])).rejects.toThrow(/score must match/)
    await database.query(`
      UPDATE stage_attempts
      SET status = 'passed', submitted_at = CURRENT_TIMESTAMP, score = 1, passed = true,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [ids.attemptOne])

    const result = await database.query<{ status: string; score: string; passed: boolean; outcome: string; earned_score: string }>(`
      SELECT a.status, a.score::text, a.passed, ans.outcome, ans.earned_score::text
      FROM stage_attempts a
      JOIN stage_attempt_answers ans ON ans.attempt_id = a.id
      WHERE a.id = $1
    `, [ids.attemptOne])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ status: 'passed', passed: true, outcome: 'correct', earned_score: '1.000000' })
    expect(Number(result.rows[0]!.score)).toBe(1)

    await startAttempt(database, ids.attemptTwo, ids.versionOne)
    const secondSnapshot = await database.query<{ item_snapshot_id: string }>(`
      SELECT id AS item_snapshot_id FROM stage_attempt_item_snapshots WHERE attempt_id = $1
    `, [ids.attemptTwo])
    await database.query(`
      INSERT INTO stage_attempt_answers
        (attempt_id, item_snapshot_id, answer_status, selected_option_snapshot_id, idempotency_key)
      VALUES ($1, $2, 'skipped', NULL, 'submit-1')
    `, [ids.attemptTwo, secondSnapshot.rows[0]!.item_snapshot_id])
    await database.query(`
      UPDATE stage_attempts
      SET status = 'failed', submitted_at = CURRENT_TIMESTAMP, score = 0, passed = false,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [ids.attemptTwo])
    const skipped = await database.query<{ outcome: string; earned_score: string }>(`
      SELECT outcome, earned_score::text FROM stage_attempt_answers WHERE attempt_id = $1
    `, [ids.attemptTwo])
    expect(skipped.rows).toEqual([{ outcome: 'skipped', earned_score: '0.000000' }])

    await startAttempt(database, ids.attemptThree, ids.versionOne)
    const thirdSnapshot = await database.query<{ item_snapshot_id: string; correct_option_snapshot_id: string }>(`
      SELECT item.id AS item_snapshot_id, keys.correct_option_snapshot_id
      FROM stage_attempt_item_snapshots item
      JOIN stage_attempt_answer_key_snapshots keys ON keys.item_snapshot_id = item.id
      WHERE item.attempt_id = $1
    `, [ids.attemptThree])
    await database.query(`
      INSERT INTO stage_attempt_answers
        (attempt_id, item_snapshot_id, answer_status, selected_option_snapshot_id, idempotency_key)
      VALUES ($1, $2, 'answered', $3, 'submit-1')
    `, [ids.attemptThree, thirdSnapshot.rows[0]!.item_snapshot_id, thirdSnapshot.rows[0]!.correct_option_snapshot_id])
    await database.query('ALTER TABLE stage_attempts DISABLE TRIGGER stage_attempt_transition_trg')
    await database.query(`
      UPDATE stage_attempts
      SET started_at = CURRENT_TIMESTAMP - interval '2 hours',
          expires_at = CURRENT_TIMESTAMP - interval '1 hour'
      WHERE id = $1
    `, [ids.attemptThree])
    await database.query('ALTER TABLE stage_attempts ENABLE TRIGGER stage_attempt_transition_trg')
    await expect(database.query(`
      UPDATE stage_attempts
      SET status = 'passed', submitted_at = CURRENT_TIMESTAMP, score = 1, passed = true,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [ids.attemptThree])).rejects.toThrow(/expired stage attempts cannot be submitted/)
  })
})
