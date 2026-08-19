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

describe('database migrations', () => {
  afterEach(async () => {
    await Promise.all(databases.map((database) => database.close()))
    databases.length = 0
  })

  it('applies the schema to an empty PostgreSQL database and is idempotent', async () => {
    const database = new PGlite()
    databases.push(database)
    const adapter = asMigrationDatabase(database)

    await expect(runMigrations(adapter)).resolves.toEqual(['0001_identity_guardian_consent.sql'])
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
      'user_devices',
      'users',
    ])
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
