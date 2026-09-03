import { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations, type MigrationDatabase } from '../src/migrate.js'

const databases: PGlite[] = []
const STUDENT = '00000000-0000-0000-0000-0000000000a1'

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
    "INSERT INTO users (id, role, birth_month, is_minor) VALUES ($1, 'student', '2012-04-01', true)",
    [STUDENT],
  )
  return database
}

/**
 * 日数は今日からの相対で指定します（0 = 今日）。
 * recordAnswers は status を触らないので、連続日数の検証にはセッションを直接置きます。
 */
const study = async (database: PGlite, daysAgo: number[], status = 'completed') => {
  for (const days of daysAgo) {
    await database.query(
      `INSERT INTO daily_sessions (student_id, session_date, target_count, status)
       VALUES ($1, ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo')::date - $2::int), 12, $3)`,
      [STUDENT, days, status],
    )
  }
}

const streak = async (database: PGlite) => {
  const result = await database.query<{ current_days: number; freeze_available: boolean; last_study_date: string | null }>(
    'SELECT current_days, freeze_available, last_study_date::text FROM daily_streak($1)', [STUDENT],
  )
  const row = result.rows[0]!
  return { days: Number(row.current_days), freezeAvailable: row.freeze_available, lastStudyDate: row.last_study_date }
}

describe('daily streak', () => {
  afterEach(async () => {
    await Promise.all(databases.map((database) => database.close()))
    databases.length = 0
  })

  it('is zero with no completed session', async () => {
    const database = await freshDatabase()
    expect(await streak(database)).toMatchObject({ days: 0, freezeAvailable: true, lastStudyDate: null })
  })

  it('counts consecutive days ending today', async () => {
    const database = await freshDatabase()
    await study(database, [0, 1, 2])
    expect((await streak(database)).days).toBe(3)
  })

  it('does not break just because today is not done yet', async () => {
    const database = await freshDatabase()
    await study(database, [1, 2, 3])
    // 今日はまだ終わっていません。途切れさせずに、今日ぶんは数えません。
    expect((await streak(database)).days).toBe(3)
  })

  it('does not count a session that was started but never completed', async () => {
    const database = await freshDatabase()
    await study(database, [0, 2])
    await study(database, [1], 'open')
    // 1 日前は未完了なので freeze で埋まり、日数は 2 のままです。
    expect((await streak(database)).days).toBe(2)
  })

  it('covers a single missed day with the freeze', async () => {
    const database = await freshDatabase()
    await study(database, [0, 1, 3, 4])
    expect(await streak(database)).toMatchObject({ days: 4, freezeAvailable: false })
  })

  it('treats two adjacent missed days the same way whatever the calendar says', async () => {
    const database = await freshDatabase()
    // 隣り合う 2 日の欠け。暦の週で数えていると、週境をまたぐかどうかで結果が変わります。
    await study(database, [0, 3, 4, 5])
    expect((await streak(database)).days).toBe(1)
  })

  it('lets the freeze come back after seven days', async () => {
    const database = await freshDatabase()
    // 2 日前と 10 日前がそれぞれ欠け。間隔が 8 日あるので両方とも埋まります。
    await study(database, [0, 1, 3, 4, 5, 6, 7, 8, 9, 11, 12])
    expect((await streak(database)).days).toBe(11)
  })

  it('stops at a second miss inside the same seven days', async () => {
    const database = await freshDatabase()
    // 2 日前と 5 日前が欠け。間隔は 3 日しかないので、2 つめは埋まりません。
    await study(database, [0, 1, 3, 4, 6, 7, 8])
    expect((await streak(database)).days).toBe(4)
  })

  it('reports the freeze as spent until seven days have passed', async () => {
    const database = await freshDatabase()
    await study(database, [0, 2, 3])
    expect(await streak(database)).toMatchObject({ freezeAvailable: false })
  })

  it('reports the freeze as available again once the gap is old enough', async () => {
    const database = await freshDatabase()
    // 欠けは 9 日前だけ。今日からは 7 日以上あいているので、また使えます。
    await study(database, [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11])
    expect(await streak(database)).toMatchObject({ days: 11, freezeAvailable: true })
  })
})
