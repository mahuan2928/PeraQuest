import { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations, type MigrationDatabase } from '../src/migrate.js'

const databases: PGlite[] = []
const STUDENT = '00000000-0000-0000-0000-0000000000b9'

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

const freshDatabase = async () => {
  const database = new PGlite()
  databases.push(database)
  await runMigrations(asMigrationDatabase(database))
  await database.query(
    "INSERT INTO users (id, role, birth_month, is_minor) VALUES ($1, 'student', '2012-04-01', true)", [STUDENT],
  )
  return database
}

/** 純粋な判定。提出時刻を後付けできないので、日数はここで検証します。 */
const decide = async (database: PGlite, daysAgo: number | null, sessions: number) => {
  const result = await database.query<{ allowed: boolean; days_remaining: number; sessions_remaining: number }>(
    `SELECT allowed, days_remaining, sessions_remaining
     FROM calculate_stage_retake_gate(
       CASE WHEN $1::int IS NULL THEN NULL ELSE CURRENT_TIMESTAMP - make_interval(days => $1::int) END,
       $2::int
     )`,
    [daysAgo, sessions],
  )
  const row = result.rows[0]!
  return { allowed: row.allowed, days: Number(row.days_remaining), sessions: Number(row.sessions_remaining) }
}

describe('level check retake gate', () => {
  afterEach(async () => {
    await Promise.all(databases.map((database) => database.close()))
    databases.length = 0
  })

  it('lets the first attempt through', async () => {
    const database = await freshDatabase()
    expect(await decide(database, null, 0)).toMatchObject({ allowed: true })
  })

  it('refuses a retake straight after submitting, and says how far away both routes are', async () => {
    const database = await freshDatabase()
    expect(await decide(database, 0, 0)).toEqual({ allowed: false, days: 7, sessions: 3 })
  })

  it('opens after three completed daily sessions rather than making the learner wait', async () => {
    const database = await freshDatabase()
    // 待つより復習するほうが速い、という順序にするのが目的です。
    expect(await decide(database, 1, 3)).toMatchObject({ allowed: true, sessions: 0 })
  })

  it('still refuses at two sessions and counts what is left', async () => {
    const database = await freshDatabase()
    expect(await decide(database, 1, 2)).toEqual({ allowed: false, days: 6, sessions: 1 })
  })

  it('opens on its own after seven days', async () => {
    const database = await freshDatabase()
    expect(await decide(database, 7, 0)).toMatchObject({ allowed: true, days: 0 })
  })

  it('counts down the days while the learner waits', async () => {
    const database = await freshDatabase()
    expect(await decide(database, 5, 0)).toMatchObject({ allowed: false, days: 2 })
  })

  it('does not count sessions completed before the attempt', async () => {
    const database = await freshDatabase()
    // 表を読む側の検証。提出はできないので、セッションだけ置いて 0 件と数えられることを見ます。
    await database.query(`
      INSERT INTO daily_sessions (student_id, session_date, target_count, status)
      VALUES ($1, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo')::date, 12, 'completed')
    `, [STUDENT])
    const result = await database.query<{ sessions_remaining: number }>(
      'SELECT sessions_remaining FROM stage_retake_gate($1, gen_random_uuid())', [STUDENT],
    )
    // 受験がなければ素通しですが、数え方そのものは動いています。
    expect(Number(result.rows[0]!.sessions_remaining)).toBe(2)
  })
})
