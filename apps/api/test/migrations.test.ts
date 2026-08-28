import { PGlite } from '@electric-sql/pglite'
import type { Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations, type MigrationDatabase } from '../src/migrate.js'
import { PostgresAuthUserResolver, PostgresStudentRepository } from '../src/repository.js'
import { buildApp } from '../src/app.js'

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

describe('database migrations', () => {
  beforeEach(() => { vi.stubEnv('ALLOW_LEGACY_TEST_HEADERS', 'true') })

  afterEach(async () => {
    await Promise.all(databases.map((database) => database.close()))
    databases.length = 0
  })

  it('applies the schema to an empty PostgreSQL database and is idempotent', async () => {
    const database = new PGlite()
    databases.push(database)
    const adapter = asMigrationDatabase(database)

    await expect(runMigrations(adapter)).resolves.toEqual([
      '0001_identity_guardian_consent.sql',
      '0002_one_time_trial.sql',
      '0004_learning_p1_1_idempotency.sql',
      '0005_learning_audit.sql',
      '0006_learning_p1_3_1_stage_attempt_snapshot.sql',
    ])
    await expect(runMigrations(adapter)).resolves.toEqual([])

    const tables = await database.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `)
    expect(tables.rows.map(({ table_name }) => table_name)).toEqual([
      'auth_identities',
      'consent_records',
      'guardian_links',
      'idempotency_records',
      'learning_audit_events',
      'line_links',
      'schema_migrations',
      'stage_attempt_answer_key_snapshots',
      'stage_attempt_answers',
      'stage_attempt_item_option_snapshots',
      'stage_attempt_item_snapshots',
      'stage_attempt_start_idempotency',
      'stage_attempts',
      'stage_exam_item_answer_keys',
      'stage_exam_item_options',
      'stage_exam_items',
      'stage_exam_version_retirements',
      'stage_exam_versions',
      'stage_exams',
      'subscription_entitlements',
      'trial_attempts',
      'trial_redemptions',
      'user_devices',
      'users',
    ])
  })

  it('resolves only active users in the configured provider namespace', async () => {
    const database = new PGlite()
    databases.push(database)
    await runMigrations(asMigrationDatabase(database))
    await database.query(`INSERT INTO users (id, role, birth_month, is_minor, deleted_at) VALUES
      ('00000000-0000-0000-0000-000000000041', 'student', '2012-04-01', true, NULL),
      ('00000000-0000-0000-0000-000000000042', 'student', '2012-05-01', true, now()),
      ('00000000-0000-0000-0000-000000000043', 'guardian', NULL, false, NULL)`)
    await database.query(`INSERT INTO auth_identities (id, user_id, provider, provider_subject) VALUES
      ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000041', 'email_magic_link', 'active-sub'),
      ('00000000-0000-0000-0000-000000000052', '00000000-0000-0000-0000-000000000042', 'email_magic_link', 'deleted-sub'),
      ('00000000-0000-0000-0000-000000000053', '00000000-0000-0000-0000-000000000043', 'google', 'other-provider-sub')`)
    const pool = { query: database.query.bind(database) } as unknown as Pool
    const resolver = new PostgresAuthUserResolver(pool, 'email_magic_link')

    await expect(resolver.resolve('https://issuer.test', 'active-sub')).resolves.toEqual({ id: '00000000-0000-0000-0000-000000000041', role: 'student' })
    await expect(resolver.resolve('https://issuer.test', 'missing-sub')).resolves.toBeNull()
    await expect(resolver.resolve('https://issuer.test', 'deleted-sub')).resolves.toBeNull()
    await expect(resolver.resolve('https://issuer.test', 'other-provider-sub')).resolves.toBeNull()
  })

  it('stores only minimal redemption and short-lived trial state, not durable answers or scores', async () => {
    const database = new PGlite()
    databases.push(database)
    await runMigrations(asMigrationDatabase(database))
    const redemptionColumns = await database.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'trial_redemptions' ORDER BY column_name")
    expect(redemptionColumns.rows.map(({ column_name }) => column_name)).toEqual(['redeemed_at', 'student_id'])
    const attemptColumns = await database.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'trial_attempts' ORDER BY column_name")
    expect(attemptColumns.rows.map(({ column_name }) => column_name)).not.toContain('answers')

    const durableKnowledgeTables = await database.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('knowledge_evidence', 'student_knowledge', 'remediation_tasks', 'unlock_states')
    `)
    expect(durableKnowledgeTables.rows).toEqual([])
  })

  it('enforces one-time redemption atomically through the PostgreSQL repository', async () => {
    const database = new PGlite()
    databases.push(database)
    await runMigrations(asMigrationDatabase(database))
    const client = { query: database.query.bind(database), release: () => undefined }
    const pool = { query: database.query.bind(database), connect: async () => client } as unknown as Pool
    const repository = new PostgresStudentRepository(pool)
    await repository.create({ id: '00000000-0000-0000-0000-000000000001', birthMonth: '2012-04', isMinor: true, guardianLinkStatus: 'pending', guardianId: null })
    const results = await Promise.all([
      repository.startTrial('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', new Date(Date.now() + 60_000)),
      repository.startTrial('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', new Date(Date.now() + 60_000)),
    ])
    expect(results.map(({ status }) => status).sort()).toEqual(['created', 'redeemed'])
  })

  it('persists the consenting guardian on consent records and rejects cross-user impersonation', async () => {
    vi.stubEnv('CONSENT_VERSION_REQUIRED', 'v1')
    const database = new PGlite()
    databases.push(database)
    await runMigrations(asMigrationDatabase(database))
    const studentA = '00000000-0000-0000-0000-000000000011'
    const studentB = '00000000-0000-0000-0000-000000000012'
    const guardianA = '00000000-0000-0000-0000-000000000021'
    const guardianB = '00000000-0000-0000-0000-000000000022'
    await database.query(`INSERT INTO users (id, role, birth_month, is_minor) VALUES
      ('${studentA}', 'student', '2012-04-01', true),
      ('${studentB}', 'student', '2012-05-01', true),
      ('${guardianA}', 'guardian', NULL, false),
      ('${guardianB}', 'guardian', NULL, false)`)
    await database.query(`INSERT INTO guardian_links (id, student_id, guardian_id, status) VALUES
      ('00000000-0000-0000-0000-000000000031', '${studentA}', '${guardianA}', 'verified'),
      ('00000000-0000-0000-0000-000000000032', '${studentB}', '${guardianB}', 'verified')`)
    const pool = { query: database.query.bind(database), connect: async () => ({ query: database.query.bind(database), release: () => undefined }) } as unknown as Pool
    const app = buildApp({ repository: new PostgresStudentRepository(pool) })
    const rejected = await app.inject({ method: 'PUT', url: '/v1/me/consents/voice-processing', headers: { 'x-student-id': studentB, 'x-guardian-id': guardianA }, payload: { status: 'granted', version: 'v1' } })
    expect(rejected.statusCode).toBe(403)
    expect(rejected.json()).toEqual({ code: 'GUARDIAN_AUTH_REQUIRED' })
    const accepted = await app.inject({ method: 'PUT', url: '/v1/me/consents/voice-processing', headers: { 'x-student-id': studentA, 'x-guardian-id': guardianA }, payload: { status: 'granted', version: 'v1' } })
    expect(accepted.statusCode).toBe(200)
    const records = await database.query<{ guardian_id: string; student_id: string }>
      ('SELECT guardian_id, student_id FROM consent_records WHERE student_id = $1', [studentA])
    expect(records.rows).toEqual([{ guardian_id: guardianA, student_id: studentA }])
    const rejectedRecords = await database.query('SELECT 1 FROM consent_records WHERE student_id = $1', [studentB])
    expect(rejectedRecords.rows).toEqual([])
    await app.close()
  })

  it('enforces one active guardian link for a student', async () => {
    const database = new PGlite()
    databases.push(database)
    await runMigrations(asMigrationDatabase(database))
    await database.query("INSERT INTO users (id, role, birth_month, is_minor) VALUES ('00000000-0000-0000-0000-000000000001', 'student', '2012-04-01', true)")
    await database.query("INSERT INTO guardian_links (id, student_id) VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001')")
    await expect(database.query("INSERT INTO guardian_links (id, student_id) VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001')")).rejects.toThrow()
  })
})
