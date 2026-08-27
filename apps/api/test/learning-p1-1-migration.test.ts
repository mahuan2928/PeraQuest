import { appendFile, copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it } from 'vitest'
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

const createDatabase = async (): Promise<PGlite> => {
  const database = new PGlite()
  databases.push(database)
  await runMigrations(asMigrationDatabase(database))
  return database
}

const ids = {
  student: '00000000-0000-0000-0000-000000000101',
  guardian: '00000000-0000-0000-0000-000000000102',
  exam: '00000000-0000-0000-0000-000000000201',
  version: '00000000-0000-0000-0000-000000000202',
  item: '00000000-0000-0000-0000-000000000203',
  optionA: '00000000-0000-0000-0000-000000000204',
  optionB: '00000000-0000-0000-0000-000000000205',
  attempt: '00000000-0000-0000-0000-000000000301',
}

const seedDraftExam = async (database: PGlite): Promise<void> => {
  await database.exec(`
    INSERT INTO users (id, role, is_minor) VALUES
      ('${ids.student}', 'student', false),
      ('${ids.guardian}', 'guardian', false);
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

const publishExam = (database: PGlite): Promise<unknown> => database.query(
  `UPDATE stage_exam_versions SET status = 'published', published_at = CURRENT_TIMESTAMP WHERE id = $1`,
  [ids.version],
)

afterEach(async () => {
  await Promise.all(databases.map((database) => database.close()))
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { force: true, recursive: true })))
  databases.length = 0
  temporaryDirectories.length = 0
})

describe('learning P1.1 migration', () => {
  it('rolls back the complete migration batch when a later migration fails', async () => {
    const database = new PGlite()
    databases.push(database)
    const directory = await mkdtemp(join(tmpdir(), 'peraquest-failing-migrations-'))
    temporaryDirectories.push(directory)
    await copyFile(resolve(process.cwd(), 'migrations/0001_identity_guardian_consent.sql'), join(directory, '0001_identity_guardian_consent.sql'))
    await writeFile(join(directory, '0002_forced_failure.sql'), `
      CREATE TABLE migration_partial_write (id integer PRIMARY KEY);
      SELECT * FROM deliberately_missing_table;
    `)

    await expect(runMigrations(asMigrationDatabase(database), directory)).rejects.toThrow()
    const objects = await database.query<{ ledger: string | null; users: string | null; partial: string | null }>(`
      SELECT to_regclass('schema_migrations')::text AS ledger,
             to_regclass('users')::text AS users,
             to_regclass('migration_partial_write')::text AS partial
    `)
    expect(objects.rows).toEqual([{ ledger: null, users: null, partial: null }])
  })

  it('rejects a checksum change to an already applied migration', async () => {
    const database = new PGlite()
    databases.push(database)
    const directory = await mkdtemp(join(tmpdir(), 'peraquest-checksum-migrations-'))
    temporaryDirectories.push(directory)
    const migration = join(directory, '0001_identity_guardian_consent.sql')
    await copyFile(resolve(process.cwd(), 'migrations/0001_identity_guardian_consent.sql'), migration)
    await runMigrations(asMigrationDatabase(database), directory)
    await appendFile(migration, '\n-- changed after application\n')

    await expect(runMigrations(asMigrationDatabase(database), directory)).rejects.toThrow(/has changed/)
    const count = await database.query<{ count: number }>('SELECT count(*)::int AS count FROM schema_migrations')
    expect(count.rows).toEqual([{ count: 1 }])
  })

  it('upgrades an existing database, removes historical trial rows outside 30 minutes, and replaces the real legacy constraint', async () => {
    const database = new PGlite()
    databases.push(database)
    const legacyDirectory = await mkdtemp(join(tmpdir(), 'peraquest-legacy-migrations-'))
    temporaryDirectories.push(legacyDirectory)
    for (const name of ['0001_identity_guardian_consent.sql', '0002_one_time_trial.sql']) {
      await copyFile(resolve(process.cwd(), 'migrations', name), join(legacyDirectory, name))
    }

    await runMigrations(asMigrationDatabase(database), legacyDirectory)
    await database.exec(`
      INSERT INTO users (id, role, is_minor) VALUES
        ('00000000-0000-0000-0000-000000000111', 'student', false),
        ('00000000-0000-0000-0000-000000000112', 'student', false),
        ('00000000-0000-0000-0000-000000000113', 'student', false);
      INSERT INTO trial_attempts (id, student_id, created_at, expires_at) VALUES
        ('00000000-0000-0000-0000-000000000121', '00000000-0000-0000-0000-000000000111', '2026-08-27T00:00:00Z', '2026-08-27T00:20:00Z'),
        ('00000000-0000-0000-0000-000000000122', '00000000-0000-0000-0000-000000000112', '2026-08-27T00:00:00Z', '2026-08-27T01:00:00Z'),
        ('00000000-0000-0000-0000-000000000123', '00000000-0000-0000-0000-000000000113', '2026-08-27T00:00:00Z', '2026-08-26T23:59:00Z');
      ALTER TABLE trial_attempts ADD CONSTRAINT trial_attempts_expiry_safety_check
        CHECK (expires_at > created_at - interval '1 hour');
    `)

    await expect(runMigrations(asMigrationDatabase(database))).resolves.toEqual(['0004_learning_p1_1_idempotency.sql', '0005_learning_audit.sql'])
    const rows = await database.query<{ id: string }>('SELECT id FROM trial_attempts ORDER BY id')
    expect(rows.rows).toEqual([{ id: '00000000-0000-0000-0000-000000000121' }])

    const constraints = await database.query<{ conname: string }>(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'trial_attempts'::regclass AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%expires_at%'
    `)
    expect(constraints.rows).toEqual([
      { conname: 'trial_attempts_expiry_safety_check' },
      { conname: 'trial_attempts_ttl_30m_check' },
    ])
    await expect(database.query(`
      INSERT INTO trial_attempts (id, student_id, created_at, expires_at)
      VALUES ('00000000-0000-0000-0000-000000000124', '00000000-0000-0000-0000-000000000112',
              '2026-08-27T00:00:00Z', '2026-08-27T00:31:00Z')
    `)).rejects.toThrow()
  })

  it('keeps answer keys in a private table and enforces cross-table option ownership', async () => {
    const database = await createDatabase()
    await seedDraftExam(database)
    const secondItem = '00000000-0000-0000-0000-000000000206'
    const secondOption = '00000000-0000-0000-0000-000000000207'
    await database.exec(`
      INSERT INTO stage_exam_items (id, exam_version_id, item_ref, ordinal, prompt, points)
        VALUES ('${secondItem}', '${ids.version}', 'item-2', 2, 'Second.', 1);
      INSERT INTO stage_exam_item_options (id, item_id, option_ref, option_text, ordinal)
        VALUES ('${secondOption}', '${secondItem}', 'a', 'Other', 1)
    `)

    await expect(database.query(
      'UPDATE stage_exam_item_answer_keys SET correct_option_id = $1 WHERE item_id = $2',
      [secondOption, ids.item],
    )).rejects.toThrow()

    const publicColumns = await database.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name IN ('stage_exam_items', 'stage_exam_item_options')
    `)
    expect(publicColumns.rows.map(({ column_name }) => column_name)).not.toContain('correct_option_id')
  })

  it('publishes only complete versions and makes the version, items, options, and answer key immutable', async () => {
    const database = await createDatabase()
    await seedDraftExam(database)
    await publishExam(database)

    await expect(database.query("UPDATE stage_exam_versions SET pass_score = 0.7 WHERE id = $1", [ids.version])).rejects.toThrow()
    await expect(database.query("UPDATE stage_exam_items SET prompt = 'changed' WHERE id = $1", [ids.item])).rejects.toThrow()
    await expect(database.query("DELETE FROM stage_exam_item_options WHERE id = $1", [ids.optionB])).rejects.toThrow()
    await expect(database.query('UPDATE stage_exam_item_answer_keys SET grading_version = 2 WHERE item_id = $1', [ids.item])).rejects.toThrow()
    await expect(database.query('DELETE FROM stage_exam_versions WHERE id = $1', [ids.version])).rejects.toThrow()
  })

  it('keeps stage exam business identity immutable before and after publication', async () => {
    const database = await createDatabase()
    await seedDraftExam(database)

    await expect(database.query("UPDATE stage_exams SET code = 'renamed' WHERE id = $1", [ids.exam])).rejects.toThrow()
    await publishExam(database)
    await expect(database.query('UPDATE stage_exams SET stage = 2 WHERE id = $1', [ids.exam])).rejects.toThrow()
    await expect(database.query('DELETE FROM stage_exams WHERE id = $1', [ids.exam])).rejects.toThrow()
  })

  it('allows direct SQL to create only an active student open attempt at database time for a published non-retired version', async () => {
    const database = await createDatabase()
    await seedDraftExam(database)

    await expect(database.query(`
      INSERT INTO stage_attempts (id, student_id, exam_version_id, expires_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP + interval '20 minutes')
    `, [ids.attempt, ids.student, ids.version])).rejects.toThrow()

    await publishExam(database)
    await expect(database.query(`
      INSERT INTO stage_attempts (id, student_id, exam_version_id, expires_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP + interval '20 minutes')
    `, [ids.attempt, ids.student, ids.version])).resolves.toBeDefined()

    await expect(database.query(`
      INSERT INTO stage_attempts (id, student_id, exam_version_id, status, started_at, expires_at, submitted_at, score, passed)
      VALUES ('00000000-0000-0000-0000-000000000302', $1, $2, 'passed', CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP + interval '20 minutes', CURRENT_TIMESTAMP, 1, true)
    `, [ids.student, ids.version])).rejects.toThrow()
    await expect(database.query(`
      INSERT INTO stage_attempts (id, student_id, exam_version_id, started_at, expires_at)
      VALUES ('00000000-0000-0000-0000-000000000303', $1, $2, CURRENT_TIMESTAMP - interval '1 second',
              CURRENT_TIMESTAMP + interval '20 minutes')
    `, [ids.student, ids.version])).rejects.toThrow()
    await expect(database.query(`
      INSERT INTO stage_attempts (id, student_id, exam_version_id, expires_at)
      VALUES ('00000000-0000-0000-0000-000000000304', $1, $2, CURRENT_TIMESTAMP + interval '19 minutes')
    `, [ids.student, ids.version])).rejects.toThrow()
    await expect(database.query(`
      INSERT INTO stage_attempts (id, student_id, exam_version_id, expires_at)
      VALUES ('00000000-0000-0000-0000-000000000305', $1, $2, CURRENT_TIMESTAMP + interval '20 minutes')
    `, [ids.guardian, ids.version])).rejects.toThrow()

    await database.query(`
      INSERT INTO stage_exam_version_retirements (exam_version_id, retired_at, reason)
      VALUES ($1, CURRENT_TIMESTAMP, 'superseded')
    `, [ids.version])
    await expect(database.query(`
      INSERT INTO stage_attempts (id, student_id, exam_version_id, expires_at)
      VALUES ('00000000-0000-0000-0000-000000000306', $1, $2, CURRENT_TIMESTAMP + interval '20 minutes')
    `, [ids.student, ids.version])).rejects.toThrow()
  })

  it('rejects every direct stage-attempt terminal transition until P1.3 can grade persisted answers', async () => {
    const database = await createDatabase()
    await seedDraftExam(database)
    await publishExam(database)
    await database.query(`
      INSERT INTO stage_attempts (id, student_id, exam_version_id, expires_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP + interval '20 minutes')
    `, [ids.attempt, ids.student, ids.version])

    for (const transition of [
      `SET status = 'passed', submitted_at = CURRENT_TIMESTAMP, score = 1,
           passed = true, updated_at = CURRENT_TIMESTAMP`,
      `SET status = 'failed', submitted_at = CURRENT_TIMESTAMP, score = 0,
           passed = false, updated_at = CURRENT_TIMESTAMP`,
      `SET status = 'expired', expired_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`,
    ]) {
      await expect(database.query(`
        UPDATE stage_attempts ${transition} WHERE id = $1
      `, [ids.attempt])).rejects.toThrow(/P1.3 grading runtime/)
    }
    await expect(database.query(`
      UPDATE stage_attempts SET updated_at = CURRENT_TIMESTAMP WHERE id = $1
    `, [ids.attempt])).rejects.toThrow(/P1.3 grading runtime/)
    await expect(database.query('DELETE FROM stage_attempts WHERE id = $1', [ids.attempt])).rejects.toThrow()

    const attempt = await database.query<{ status: string; score: string | null; passed: boolean | null }>(`
      SELECT status, score::text AS score, passed FROM stage_attempts WHERE id = $1
    `, [ids.attempt])
    expect(attempt.rows).toEqual([{ status: 'open', score: null, passed: null }])
  })

  it('enforces idempotency shape, state completeness, and scoped uniqueness', async () => {
    const database = await createDatabase()
    await database.query(`INSERT INTO users (id, role, is_minor) VALUES
      ('${ids.student}', 'student', false),
      ('${ids.guardian}', 'guardian', false)`)
    const insert = `
      INSERT INTO idempotency_records
        (student_id, operation_scope, idempotency_key, request_hash, expires_at)
      VALUES ($1, $2, $3, decode(repeat('ab', 32), 'hex'), CURRENT_TIMESTAMP + interval '1 day')
    `
    await database.query(insert, [ids.student, 'stage_attempt.start:v1:one', 'request-1'])
    await database.query(insert, [ids.student, 'stage_attempt.submit:v1:one', 'request-1'])
    await expect(database.query(insert, [ids.student, 'stage_attempt.start:v1:one', 'request-1'])).rejects.toThrow()
    await expect(database.query(insert, [ids.student, 'stage_attempt.start:v1:one', 'short'])).rejects.toThrow()
    await expect(database.query(`
      INSERT INTO idempotency_records
        (student_id, operation_scope, idempotency_key, request_hash, status, http_status,
         response_headers, response_body, completed_at, expires_at)
      VALUES ($1, 'scope', 'request-2', decode(repeat('ab', 32), 'hex'), 'completed', 201,
              '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + interval '1 day')
    `, [ids.student])).rejects.toThrow(/must start in_progress/)

    await expect(database.query(`
      UPDATE idempotency_records SET operation_scope = 'changed'
      WHERE student_id = $1 AND idempotency_key = 'request-1'
    `, [ids.student])).rejects.toThrow()
    await expect(database.query(`
      UPDATE idempotency_records SET request_hash = decode(repeat('cd', 32), 'hex')
      WHERE student_id = $1 AND operation_scope = 'stage_attempt.start:v1:one'
    `, [ids.student])).rejects.toThrow()
    await expect(database.query(`
      UPDATE idempotency_records SET student_id = $1
      WHERE student_id = $2 AND operation_scope = 'stage_attempt.start:v1:one'
    `, [ids.guardian, ids.student])).rejects.toThrow()
  })

  it('allows one atomic idempotency completion and makes the completed snapshot immutable', async () => {
    const database = await createDatabase()
    await database.query(`INSERT INTO users (id, role, is_minor) VALUES ('${ids.student}', 'student', false)`)
    await database.query(`
      INSERT INTO idempotency_records
        (student_id, operation_scope, idempotency_key, request_hash, expires_at)
      VALUES ($1, 'stage_attempt.start:v1:one', 'request-1', decode(repeat('ab', 32), 'hex'),
              CURRENT_TIMESTAMP + interval '1 day')
    `, [ids.student])

    await expect(database.query(`
      UPDATE idempotency_records
      SET status = 'completed', http_status = 201,
          response_headers = '{"content-type":"application/json"}'::jsonb,
          response_body = '{"attempt_id":"one"}'::jsonb,
          completed_at = CURRENT_TIMESTAMP
      WHERE student_id = $1 AND operation_scope = 'stage_attempt.start:v1:one'
    `, [ids.student])).resolves.toBeDefined()

    for (const mutation of [
      'http_status = 202',
      `response_headers = '{"x-replayed":"true"}'::jsonb`,
      `response_body = '{"attempt_id":"forged"}'::jsonb`,
      'completed_at = CURRENT_TIMESTAMP',
      `status = 'in_progress', http_status = NULL, response_headers = NULL, response_body = NULL, completed_at = NULL`,
    ]) {
      await expect(database.query(`
        UPDATE idempotency_records SET ${mutation}
        WHERE student_id = $1 AND operation_scope = 'stage_attempt.start:v1:one'
      `, [ids.student])).rejects.toThrow(/completed idempotency record is immutable/)
    }
    await expect(database.query(`
      DELETE FROM idempotency_records
      WHERE student_id = $1 AND operation_scope = 'stage_attempt.start:v1:one'
    `, [ids.student])).rejects.toThrow(/completed idempotency record is immutable/)

    const snapshot = await database.query<{
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
  })

  it('creates the required foreign keys, checks, non-null columns, and indexes without P2 tables', async () => {
    const database = await createDatabase()
    const forbiddenTables = await database.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('knowledge_evidence', 'knowledge_evidence_weights', 'student_knowledge', 'remediation_tasks')
    `)
    expect(forbiddenTables.rows).toEqual([])

    const nullable = await database.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'stage_exam_item_answer_keys' AND is_nullable = 'YES'
    `)
    expect(nullable.rows).toEqual([])

    const constraintTypes = await database.query<{ contype: string; count: number }>(`
      SELECT contype, count(*)::int AS count FROM pg_constraint
      WHERE conrelid IN (
        'stage_exam_versions'::regclass, 'stage_exam_items'::regclass,
        'stage_exam_item_options'::regclass, 'stage_exam_item_answer_keys'::regclass,
        'stage_attempts'::regclass, 'idempotency_records'::regclass
      )
      GROUP BY contype
    `)
    const byType = Object.fromEntries(constraintTypes.rows.map(({ contype, count }) => [contype, count]))
    expect(byType.f).toBeGreaterThanOrEqual(7)
    expect(byType.c).toBeGreaterThanOrEqual(12)
    expect(byType.u).toBeGreaterThanOrEqual(8)

    const indexes = await database.query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
        AND indexname IN (
          'stage_exam_versions_available_idx', 'stage_exam_items_version_idx',
          'stage_exam_item_options_item_idx', 'stage_exam_item_answer_keys_option_idx',
          'stage_attempts_one_open_exam_idx', 'stage_attempts_student_created_idx',
          'stage_attempts_expiry_idx', 'idempotency_records_expiry_idx',
          'idempotency_records_in_progress_idx'
        )
    `)
    expect(indexes.rows).toHaveLength(9)
  })
})
