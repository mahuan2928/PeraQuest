import { PGlite } from '@electric-sql/pglite'
import type { Pool } from 'pg'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations, type MigrationDatabase } from '../src/migrate.js'
import { PostgresStudentRepository } from '../src/repository.js'

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
  afterEach(async () => {
    await Promise.all(databases.map((database) => database.close()))
    databases.length = 0
  })

  it('applies the schema to an empty PostgreSQL database and is idempotent', async () => {
    const database = new PGlite()
    databases.push(database)
    const adapter = asMigrationDatabase(database)

    await expect(runMigrations(adapter)).resolves.toEqual(['0001_identity_guardian_consent.sql', '0002_one_time_trial.sql'])
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
      'line_links',
      'schema_migrations',
      'subscription_entitlements',
      'trial_attempts',
      'trial_redemptions',
      'user_devices',
      'users',
    ])
  })

  it('stores only minimal redemption and short-lived trial state, not durable answers or scores', async () => {
    const database = new PGlite()
    databases.push(database)
    await runMigrations(asMigrationDatabase(database))
    const redemptionColumns = await database.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'trial_redemptions' ORDER BY column_name")
    expect(redemptionColumns.rows.map(({ column_name }) => column_name)).toEqual(['redeemed_at', 'student_id'])
    const attemptColumns = await database.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'trial_attempts' ORDER BY column_name")
    expect(attemptColumns.rows.map(({ column_name }) => column_name)).not.toContain('answers')
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

  it('enforces one active guardian link for a student', async () => {
    const database = new PGlite()
    databases.push(database)
    await runMigrations(asMigrationDatabase(database))
    await database.query("INSERT INTO users (id, role, birth_month, is_minor) VALUES ('00000000-0000-0000-0000-000000000001', 'student', '2012-04-01', true)")
    await database.query("INSERT INTO guardian_links (id, student_id) VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001')")
    await expect(database.query("INSERT INTO guardian_links (id, student_id) VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001')")).rejects.toThrow()
  })
})
