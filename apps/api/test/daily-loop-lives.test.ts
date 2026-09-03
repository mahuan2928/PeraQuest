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

const STUDENT = '00000000-0000-0000-0000-0000000000a1'

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

const lives = async (database: PGlite) => {
  const result = await database.query<{ lives: number }>('SELECT lives FROM student_lives WHERE student_id = $1', [STUDENT])
  return result.rows[0]?.lives ?? null
}

const backdateAnchor = (database: PGlite, minutes: number) =>
  database.query(
    `UPDATE student_lives SET refill_anchor_at = CURRENT_TIMESTAMP - make_interval(mins => $2) WHERE student_id = $1`,
    [STUDENT, minutes],
  )

const createSession = (database: PGlite, date: string, target = 12, status = 'open') =>
  database.query<{ id: string }>(
    'INSERT INTO daily_sessions (student_id, session_date, target_count, status) VALUES ($1, $2, $3, $4) RETURNING id',
    [STUDENT, date, target, status],
  )

describe('daily loop and lives', () => {
  afterEach(async () => {
    await Promise.all(databases.map((database) => database.close()))
    databases.length = 0
  })

  it('starts a learner at five lives and spends one per wrong answer', async () => {
    const database = await freshDatabase()
    await database.query('SELECT spend_life($1, $2)', [STUDENT, 'answer-1'])
    expect(await lives(database)).toBe(4)
    await database.query('SELECT spend_life($1, $2)', [STUDENT, 'answer-2'])
    expect(await lives(database)).toBe(3)
  })

  it('never deducts twice for the same answer', async () => {
    const database = await freshDatabase()
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await database.query('SELECT spend_life($1, $2)', [STUDENT, 'answer-1'])
    }
    expect(await lives(database)).toBe(4)
    const ledger = await database.query<{ count: string }>(
      "SELECT count(*) AS count FROM life_ledger WHERE reason = 'wrong_answer'",
    )
    expect(Number(ledger.rows[0]?.count)).toBe(1)
  })

  it('stops at zero and reports no lives left', async () => {
    const database = await freshDatabase()
    for (let index = 0; index < 5; index += 1) {
      await database.query('SELECT spend_life($1, $2)', [STUDENT, `answer-${index}`])
    }
    expect(await lives(database)).toBe(0)
    const blocked = await database.query<{ spend_life: number }>('SELECT spend_life($1, $2)', [STUDENT, 'answer-extra'])
    expect(blocked.rows[0]?.spend_life).toBe(0)
    expect(await lives(database)).toBe(0)
  })

  it('recovers one life every thirty minutes', async () => {
    const database = await freshDatabase()
    for (let index = 0; index < 3; index += 1) {
      await database.query('SELECT spend_life($1, $2)', [STUDENT, `answer-${index}`])
    }
    expect(await lives(database)).toBe(2)

    await backdateAnchor(database, 29)
    await database.query('SELECT settle_life_refill($1)', [STUDENT])
    expect(await lives(database)).toBe(2)

    await backdateAnchor(database, 65)
    await database.query('SELECT settle_life_refill($1)', [STUDENT])
    expect(await lives(database)).toBe(4)
  })

  it('keeps the remainder so repeated checks do not delay recovery', async () => {
    const database = await freshDatabase()
    await database.query('SELECT spend_life($1, $2)', [STUDENT, 'answer-1'])
    await backdateAnchor(database, 59)
    await database.query('SELECT settle_life_refill($1)', [STUDENT])
    expect(await lives(database)).toBe(5)

    // 5 に戻った後は時計を止め、余りが次の消費に持ち越されないことを確認します。
    await database.query('SELECT spend_life($1, $2)', [STUDENT, 'answer-2'])
    await database.query('SELECT settle_life_refill($1)', [STUDENT])
    expect(await lives(database)).toBe(4)
  })

  it('never recovers past five', async () => {
    const database = await freshDatabase()
    await database.query('SELECT spend_life($1, $2)', [STUDENT, 'answer-1'])
    await backdateAnchor(database, 600)
    await database.query('SELECT settle_life_refill($1)', [STUDENT])
    expect(await lives(database)).toBe(5)
  })

  it('records every change in an append-only ledger', async () => {
    const database = await freshDatabase()
    await database.query('SELECT spend_life($1, $2)', [STUDENT, 'answer-1'])
    await expect(
      database.query("UPDATE life_ledger SET delta = 0 WHERE student_id = $1", [STUDENT]),
    ).rejects.toThrowError(/append-only/)
    await expect(
      database.query('DELETE FROM life_ledger WHERE student_id = $1', [STUDENT]),
    ).rejects.toThrowError(/append-only/)
  })

  it('allows one session a day and keeps a level between twelve and twenty items', async () => {
    const database = await freshDatabase()
    await createSession(database, '2026-09-03')
    await expect(createSession(database, '2026-09-03')).rejects.toThrowError(/duplicate key/)
    // 1 日 19 問が目標。3 か月で英検 3 級を一周するのに必要な量です。
    await createSession(database, '2026-09-04', 19)
    await expect(createSession(database, '2026-09-05', 11)).rejects.toThrowError(/target_count/)
    await expect(createSession(database, '2026-09-06', 21)).rejects.toThrowError(/target_count/)
  })

  it('treats a timeout as skipped rather than a knowledge error', async () => {
    const database = await freshDatabase()
    const session = await createSession(database, '2026-09-03')
    const sessionId = session.rows[0]!.id
    const item = await database.query<{ id: string }>(
      `INSERT INTO content_items (item_kind, knowledge_point_ref, skill_ref, payload)
       VALUES ('article', 'grammar.article', 'grammar', '{}'::jsonb) RETURNING id`,
    )
    const itemId = item.rows[0]!.id
    await expect(
      database.query(
        `INSERT INTO daily_answers (session_id, student_id, content_item_id, knowledge_point_ref, outcome, timed_out, earned_score, max_score, occurred_at)
         VALUES ($1, $2, $3, 'grammar.article', 'incorrect', true, 0, 1, CURRENT_TIMESTAMP)`,
        [sessionId, STUDENT, itemId],
      ),
    ).rejects.toThrowError(/daily_answers_timed_out_is_skipped_chk/)

    await database.query(
      `INSERT INTO daily_answers (session_id, student_id, content_item_id, knowledge_point_ref, outcome, timed_out, earned_score, max_score, occurred_at)
       VALUES ($1, $2, $3, 'grammar.article', 'skipped', true, 0, 1, CURRENT_TIMESTAMP)`,
      [sessionId, STUDENT, itemId],
    )
    const stored = await database.query<{ count: string }>('SELECT count(*) AS count FROM daily_answers')
    expect(Number(stored.rows[0]?.count)).toBe(1)
  })

  it('caps reviews at twenty for a new learner and sixty once established', async () => {
    const database = await freshDatabase()
    const cap = async () => {
      const result = await database.query<{ daily_review_cap: number }>('SELECT daily_review_cap($1)', [STUDENT])
      return result.rows[0]?.daily_review_cap
    }
    expect(await cap()).toBe(20)
    for (let day = 1; day <= 7; day += 1) {
      await createSession(database, `2026-08-${String(day).padStart(2, '0')}`, 12, 'completed')
    }
    expect(await cap()).toBe(60)
  })
})
