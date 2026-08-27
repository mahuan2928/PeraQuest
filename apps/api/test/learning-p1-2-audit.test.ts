import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it } from 'vitest'
import { PostgresLearningAuditRepository } from '../src/learning-audit-repository.js'
import { runMigrations, type MigrationDatabase } from '../src/migrate.js'

const databases: PGlite[] = []
const temporaryDirectories: string[] = []

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
  studentA: '00000000-0000-0000-0000-000000001001',
  studentB: '00000000-0000-0000-0000-000000001002',
  exam: '00000000-0000-0000-0000-000000001101',
  version: '00000000-0000-0000-0000-000000001102',
  item: '00000000-0000-0000-0000-000000001103',
  optionA: '00000000-0000-0000-0000-000000001104',
  optionB: '00000000-0000-0000-0000-000000001105',
  attemptA: '00000000-0000-0000-0000-000000001201',
  attemptB: '00000000-0000-0000-0000-000000001202',
  eventA: '00000000-0000-0000-0000-000000001301',
}

const createDatabase = async (): Promise<PGlite> => {
  const database = new PGlite()
  databases.push(database)
  await runMigrations(asMigrationDatabase(database))
  return database
}

const seedAttempts = async (database: PGlite): Promise<void> => {
  await database.exec(`
    INSERT INTO users (id, role, is_minor) VALUES
      ('${ids.studentA}', 'student', false),
      ('${ids.studentB}', 'student', false);
    INSERT INTO stage_exams (id, exam_level, stage, code)
      VALUES ('${ids.exam}', 'eiken_grade_3', 1, 'audit-stage');
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
    UPDATE stage_exam_versions
      SET status = 'published', published_at = CURRENT_TIMESTAMP
      WHERE id = '${ids.version}';
    INSERT INTO stage_attempts (id, student_id, exam_version_id, expires_at) VALUES
      ('${ids.attemptA}', '${ids.studentA}', '${ids.version}', CURRENT_TIMESTAMP + interval '20 minutes'),
      ('${ids.attemptB}', '${ids.studentB}', '${ids.version}', CURRENT_TIMESTAMP + interval '20 minutes');
  `)
}

const insertStartedEvent = (database: PGlite, overrides: Partial<{
  eventId: string
  actorId: string
  studentId: string
  attemptId: string
  requestId: string
  reason: string
}> = {}): Promise<unknown> => database.query(`
  INSERT INTO learning_audit_events
    (event_id, event_type, actor_id, student_id, attempt_id, request_id, reason)
  VALUES ($1, 'attempt_started', $2, $3, $4, $5, $6)
`, [
  overrides.eventId ?? ids.eventA,
  overrides.actorId ?? ids.studentA,
  overrides.studentId ?? ids.studentA,
  overrides.attemptId ?? ids.attemptA,
  overrides.requestId ?? 'request-audit-1',
  overrides.reason ?? 'formal_assessment_started',
])

afterEach(async () => {
  await Promise.all(databases.map((database) => database.close()))
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { force: true, recursive: true })))
  databases.length = 0
  temporaryDirectories.length = 0
})

describe('learning P1.2 audit migration', () => {
  it('upgrades an existing P1.1 database and remains idempotent', async () => {
    const database = new PGlite()
    databases.push(database)
    const baselineDirectory = await mkdtemp(join(tmpdir(), 'peraquest-p1-1-migrations-'))
    temporaryDirectories.push(baselineDirectory)
    for (const name of [
      '0001_identity_guardian_consent.sql',
      '0002_one_time_trial.sql',
      '0004_learning_p1_1_idempotency.sql',
    ]) {
      await writeFile(join(baselineDirectory, name), await readFile(resolve(process.cwd(), 'migrations', name)))
    }

    await runMigrations(asMigrationDatabase(database), baselineDirectory)
    await seedAttempts(database)
    await expect(runMigrations(asMigrationDatabase(database))).resolves.toEqual(['0005_learning_audit.sql'])
    await expect(runMigrations(asMigrationDatabase(database))).resolves.toEqual([])
    await expect(insertStartedEvent(database)).resolves.toBeDefined()
  })

  it('rolls the P1.2 migration back when a later migration fails', async () => {
    const database = new PGlite()
    databases.push(database)
    const baselineDirectory = await mkdtemp(join(tmpdir(), 'peraquest-p1-1-baseline-'))
    const failingDirectory = await mkdtemp(join(tmpdir(), 'peraquest-p1-2-failing-'))
    temporaryDirectories.push(baselineDirectory, failingDirectory)
    for (const name of [
      '0001_identity_guardian_consent.sql',
      '0002_one_time_trial.sql',
      '0004_learning_p1_1_idempotency.sql',
    ]) {
      await writeFile(join(baselineDirectory, name), await readFile(resolve(process.cwd(), 'migrations', name)))
    }
    await runMigrations(asMigrationDatabase(database), baselineDirectory)
    await writeFile(
      join(failingDirectory, '0005_learning_audit.sql'),
      await readFile(resolve(process.cwd(), 'migrations/0005_learning_audit.sql')),
    )
    await writeFile(join(failingDirectory, '0006_forced_failure.sql'), 'SELECT * FROM deliberately_missing_table;\n')

    await expect(runMigrations(asMigrationDatabase(database), failingDirectory)).rejects.toThrow()
    const state = await database.query<{ audit_table: string | null; audit_type: string | null; ledger_count: number }>(`
      SELECT to_regclass('learning_audit_events')::text AS audit_table,
             to_regtype('learning_audit_event_type')::text AS audit_type,
             (SELECT count(*)::int FROM schema_migrations WHERE name = '0005_learning_audit.sql') AS ledger_count
    `)
    expect(state.rows).toEqual([{ audit_table: null, audit_type: null, ledger_count: 0 }])
  })

  it('provides a transaction-compatible repository foundation without runtime registration', async () => {
    const database = await createDatabase()
    await seedAttempts(database)
    const repository = new PostgresLearningAuditRepository(asMigrationDatabase(database))

    const event = await repository.append({
      eventId: ids.eventA,
      eventType: 'attempt_started',
      actorId: ids.studentA,
      studentId: ids.studentA,
      attemptId: ids.attemptA,
      requestId: 'request-audit-1',
      reason: 'formal_assessment_started',
    })

    expect(event).toMatchObject({
      eventId: ids.eventA,
      eventType: 'attempt_started',
      actorId: ids.studentA,
      studentId: ids.studentA,
      attemptId: ids.attemptA,
      requestId: 'request-audit-1',
      reason: 'formal_assessment_started',
    })
  })

  it('rejects direct SQL cross-student attempt attribution and unknown actors', async () => {
    const database = await createDatabase()
    await seedAttempts(database)

    await expect(insertStartedEvent(database, {
      studentId: ids.studentB,
      attemptId: ids.attemptA,
    })).rejects.toThrow()
    await expect(insertStartedEvent(database, {
      actorId: '00000000-0000-0000-0000-000000009999',
      attemptId: ids.attemptA,
    })).rejects.toThrow()
    const count = await database.query<{ count: number }>('SELECT count(*)::int AS count FROM learning_audit_events')
    expect(count.rows).toEqual([{ count: 0 }])
  })

  it('is append-only even through direct UPDATE and DELETE SQL', async () => {
    const database = await createDatabase()
    await seedAttempts(database)
    await insertStartedEvent(database)

    await expect(database.query(
      'UPDATE learning_audit_events SET reason = $1 WHERE event_id = $2',
      ['rewritten', ids.eventA],
    )).rejects.toThrow(/append-only/)
    await expect(database.query(
      'DELETE FROM learning_audit_events WHERE event_id = $1',
      [ids.eventA],
    )).rejects.toThrow(/append-only/)
  })

  it('enforces event, request, reason, uniqueness, and database-time constraints', async () => {
    const database = await createDatabase()
    await seedAttempts(database)
    await insertStartedEvent(database)

    await expect(insertStartedEvent(database, {
      eventId: '00000000-0000-0000-0000-000000001302',
      requestId: 'request-audit-2',
    })).rejects.toThrow()
    await expect(database.query(`
      INSERT INTO learning_audit_events
        (event_id, event_type, actor_id, student_id, attempt_id, request_id, reason)
      VALUES ('00000000-0000-0000-0000-000000001303', 'not_an_event', $1, $1, $2, 'request-audit-3', 'reason')
    `, [ids.studentA, ids.attemptA])).rejects.toThrow()
    await expect(insertStartedEvent(database, {
      eventId: '00000000-0000-0000-0000-000000001304',
      attemptId: ids.attemptB,
      actorId: ids.studentB,
      studentId: ids.studentB,
      requestId: 'short',
    })).rejects.toThrow()
    await expect(insertStartedEvent(database, {
      eventId: '00000000-0000-0000-0000-000000001305',
      attemptId: ids.attemptB,
      actorId: ids.studentB,
      studentId: ids.studentB,
      requestId: 'request-audit-1',
      reason: '   ',
    })).rejects.toThrow()
    await expect(database.query(`
      INSERT INTO learning_audit_events
        (event_id, event_type, actor_id, student_id, attempt_id, request_id, reason, occurred_at)
      SELECT '00000000-0000-0000-0000-000000001306', 'attempt_started', student_id, student_id,
             id, 'request-audit-6', 'backdated', started_at - interval '1 second'
      FROM stage_attempts WHERE id = $1
    `, [ids.attemptB])).rejects.toThrow(/cannot precede/)
    await expect(database.query(`
      INSERT INTO learning_audit_events
        (event_id, event_type, actor_id, student_id, attempt_id, request_id, reason, recorded_at)
      VALUES ('00000000-0000-0000-0000-000000001307', 'attempt_started', $1, $1, $2,
              'request-audit-7', 'forged time', CURRENT_TIMESTAMP - interval '1 second')
    `, [ids.studentB, ids.attemptB])).rejects.toThrow(/database current time/)
  })
})
