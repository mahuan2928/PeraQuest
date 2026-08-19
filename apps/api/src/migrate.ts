import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

interface QueryResultLike<Row> {
  rows: Row[]
}

export interface MigrationDatabase {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, parameters?: unknown[]): Promise<QueryResultLike<Row>>
}

interface AppliedMigration extends Record<string, unknown> {
  name: string
  checksum: string
}

const defaultMigrationDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations')

export const runMigrations = async (database: MigrationDatabase, migrationDirectory = defaultMigrationDirectory): Promise<string[]> => {
  await database.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  const appliedResult = await database.query<AppliedMigration>('SELECT name, checksum FROM schema_migrations')
  const applied = new Map(appliedResult.rows.map((migration) => [migration.name, migration.checksum]))
  const migrationNames = (await readdir(migrationDirectory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort()
  const completed: string[] = []

  for (const name of migrationNames) {
    const sql = await readFile(resolve(migrationDirectory, name), 'utf8')
    const checksum = createHash('sha256').update(sql).digest('hex')
    const existingChecksum = applied.get(name)
    if (existingChecksum && existingChecksum !== checksum) throw new Error(`Applied migration ${name} has changed`)
    if (existingChecksum) continue

    await database.query('BEGIN')
    try {
      await database.query(sql)
      await database.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum])
      await database.query('COMMIT')
      completed.push(name)
    } catch (error) {
      await database.query('ROLLBACK')
      throw error
    }
  }

  return completed
}

const main = async (): Promise<void> => {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required')
  const client = new Client({ connectionString })
  await client.connect()
  try {
    const completed = await runMigrations(client)
    console.log(completed.length === 0 ? 'Database is up to date' : `Applied migrations: ${completed.join(', ')}`)
  } finally {
    await client.end()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
