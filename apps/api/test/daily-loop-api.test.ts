import { PGlite } from '@electric-sql/pglite'
import type { Pool } from 'pg'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations, type MigrationDatabase } from '../src/migrate.js'
import { PostgresStudentRepository } from '../src/repository.js'
import { seedContentItems } from '../src/seed-content.js'

const databases: PGlite[] = []
const STUDENT = '00000000-0000-0000-0000-0000000000b1'

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

const setup = async () => {
  const database = new PGlite()
  databases.push(database)
  await runMigrations(asMigrationDatabase(database))
  await database.query(
    "INSERT INTO users (id, role, birth_month, is_minor) VALUES ($1, 'student', '2012-04-01', true)",
    [STUDENT],
  )
  await seedContentItems(database, { publishForDemo: true })
  const client = { query: database.query.bind(database), release: () => undefined }
  const pool = { query: database.query.bind(database), connect: async () => client } as unknown as Pool
  return { database, repository: new PostgresStudentRepository(pool) }
}

describe('daily loop repository', () => {
  afterEach(async () => {
    await Promise.all(databases.map((database) => database.close()))
    databases.length = 0
  })

  it('reports full lives and no session before the first level', async () => {
    const { repository } = await setup()
    const plan = await repository.getDailyPlan(STUDENT)
    expect(plan).toMatchObject({ lives: 5, maxLives: 5, nextLifeAt: null, reviewCap: 20, session: null })
  })

  it('fills the level with what the bank can offer and never sends the answers', async () => {
    const { database, repository } = await setup()
    const published = await database.query<{ count: string }>(
      "SELECT count(*) AS count FROM content_items WHERE status = 'published'",
    )
    const available = Number(published.rows[0]!.count)
    const started = await repository.startDailySession(STUDENT)
    expect(started).not.toBeNull()
    // 1 日の目標は 19 問。題庫がそこまで無い間は、公開済みの数だけで組みます。
    expect(started!.session.targetCount).toBe(Math.min(19, available))
    expect(started!.items).toHaveLength(Math.min(19, available))
    for (const item of started!.items) {
      const serialised = JSON.stringify(item.prompt)
      expect(serialised).not.toContain('"answer"')
      expect(serialised).not.toContain('"answers"')
      expect(serialised).not.toContain('explanation')
      expect(serialised).not.toContain('naturalEnglish')
    }
  })

  it('returns the same session for a second start on the same day', async () => {
    const { repository } = await setup()
    const first = await repository.startDailySession(STUDENT)
    const second = await repository.startDailySession(STUDENT)
    expect(second!.session.sessionId).toBe(first!.session.sessionId)
  })

  it('grades a word order answer and accepts an equivalent order', async () => {
    const { database, repository } = await setup()
    const started = await repository.startDailySession(STUDENT)
    const item = started!.items.find((entry) => entry.itemKind === 'word_order' && (entry.prompt.blocks as string[]).includes('yesterday'))!
    const stored = await database.query<{ payload: { answers: string[][] } }>(
      'SELECT payload FROM content_items WHERE id = $1', [item.contentItemId],
    )
    const [first, second] = stored.rows[0]!.payload.answers
    const result = await repository.submitDailyAnswer({
      studentId: STUDENT, sessionId: started!.session.sessionId, contentItemId: item.contentItemId,
      response: second ?? first!, timedOut: false,
    })
    expect(result!.correct).toBe(true)
    expect(result!.lives).toBe(5)
    expect(result!.explanation).not.toBe('')
  })

  it('spends a life on a wrong answer and only once per item', async () => {
    const { repository } = await setup()
    const started = await repository.startDailySession(STUDENT)
    const item = started!.items[0]!
    const first = await repository.submitDailyAnswer({
      studentId: STUDENT, sessionId: started!.session.sessionId, contentItemId: item.contentItemId,
      response: ['definitely', 'wrong'], timedOut: false,
    })
    expect(first!.correct).toBe(false)
    expect(first!.lives).toBe(4)

    const retry = await repository.submitDailyAnswer({
      studentId: STUDENT, sessionId: started!.session.sessionId, contentItemId: item.contentItemId,
      response: ['definitely', 'wrong'], timedOut: false,
    })
    expect(retry!.lives).toBe(4)
    expect(retry!.session.completedCount).toBe(1)
  })

  it('does not spend a life when the article sensor times out', async () => {
    const { repository } = await setup()
    const started = await repository.startDailySession(STUDENT)
    const item = started!.items.find((entry) => entry.itemKind === 'article')!
    const result = await repository.submitDailyAnswer({
      studentId: STUDENT, sessionId: started!.session.sessionId, contentItemId: item.contentItemId,
      response: null, timedOut: true,
    })
    expect(result!.correct).toBe(false)
    expect(result!.timedOut).toBe(true)
    expect(result!.lives).toBe(5)
  })

  it('completes the session once every item is answered', async () => {
    const { repository } = await setup()
    const started = await repository.startDailySession(STUDENT)
    let last = null
    for (const item of started!.items) {
      last = await repository.submitDailyAnswer({
        studentId: STUDENT, sessionId: started!.session.sessionId, contentItemId: item.contentItemId,
        response: null, timedOut: true,
      })
    }
    expect(last!.session.completedCount).toBe(started!.items.length)
    expect(last!.session.status).toBe('completed')
  })

  it('refuses an answer for someone else’s session', async () => {
    const { database, repository } = await setup()
    const started = await repository.startDailySession(STUDENT)
    await database.query(
      "INSERT INTO users (id, role, birth_month, is_minor) VALUES ('00000000-0000-0000-0000-0000000000b2', 'student', '2011-04-01', true)",
    )
    const result = await repository.submitDailyAnswer({
      studentId: '00000000-0000-0000-0000-0000000000b2',
      sessionId: started!.session.sessionId,
      contentItemId: started!.items[0]!.contentItemId,
      response: null, timedOut: true,
    })
    expect(result).toBeNull()
  })

  it('will not start a level when the bank has no published items', async () => {
    const database = new PGlite()
    databases.push(database)
    await runMigrations(asMigrationDatabase(database))
    await database.query(
      "INSERT INTO users (id, role, birth_month, is_minor) VALUES ($1, 'student', '2012-04-01', true)", [STUDENT],
    )
    await seedContentItems(database) // in_review のまま
    const client = { query: database.query.bind(database), release: () => undefined }
    const repository = new PostgresStudentRepository({ query: database.query.bind(database), connect: async () => client } as unknown as Pool)
    expect(await repository.startDailySession(STUDENT)).toBeNull()
  })

  it('grants XP and coins once when the level is completed', async () => {
    const { database, repository } = await setup()
    const started = await repository.startDailySession(STUDENT)
    let last = null
    for (const item of started!.items) {
      last = await repository.submitDailyAnswer({
        studentId: STUDENT, sessionId: started!.session.sessionId, contentItemId: item.contentItemId,
        response: null, timedOut: true,
      })
    }
    expect(last!.session.status).toBe('completed')
    expect(last!.rewards).toMatchObject({ xpAwarded: 30, activityCoinsAwarded: 10, badgesAwarded: ['daily_session_cleared'] })

    const state = await database.query<{ total_xp: number; activity_coins: number }>(
      'SELECT total_xp, activity_coins FROM student_game_state WHERE student_id = $1', [STUDENT],
    )
    expect(state.rows[0]).toMatchObject({ total_xp: 30, activity_coins: 10 })

    const ledger = await database.query<{ count: string }>(
      "SELECT count(*) AS count FROM game_reward_ledger WHERE source_type = 'daily_session'",
    )
    expect(Number(ledger.rows[0]?.count)).toBe(1)
  })

  it('advances mastery and the review date as answers come in', async () => {
    const { database, repository } = await setup()
    const started = await repository.startDailySession(STUDENT)
    const item = started!.items.find((entry) => entry.itemKind === 'word_order')!
    const stored = await database.query<{ payload: { answers: string[][] } }>(
      'SELECT payload FROM content_items WHERE id = $1', [item.contentItemId],
    )
    await repository.submitDailyAnswer({
      studentId: STUDENT, sessionId: started!.session.sessionId, contentItemId: item.contentItemId,
      response: stored.rows[0]!.payload.answers[0]!, timedOut: false,
    })
    const knowledge = await database.query<{ mastery_score: string; due_at: Date; raw_attempt_total: string }>(
      'SELECT mastery_score, due_at, raw_attempt_total FROM student_knowledge WHERE student_id = $1 AND knowledge_point_ref = $2',
      [STUDENT, item.knowledgePointRef],
    )
    expect(knowledge.rows).toHaveLength(1)
    expect(Number(knowledge.rows[0]!.mastery_score)).toBe(1)
    expect(Number(knowledge.rows[0]!.raw_attempt_total)).toBe(1)
    // 1 回正解しただけでは判定しません（窓は 4 回から）。翌日また出ます。
    const dueAt = knowledge.rows[0]!.due_at.getTime()
    expect(dueAt).toBeGreaterThan(Date.now())
    expect(dueAt).toBeLessThan(Date.now() + 2 * 24 * 60 * 60 * 1000)
  })

  it('keeps a timed-out answer out of the mastery calculation', async () => {
    const { database, repository } = await setup()
    const started = await repository.startDailySession(STUDENT)
    const item = started!.items.find((entry) => entry.itemKind === 'article')!
    await repository.submitDailyAnswer({
      studentId: STUDENT, sessionId: started!.session.sessionId, contentItemId: item.contentItemId,
      response: null, timedOut: true,
    })
    const knowledge = await database.query(
      'SELECT 1 FROM student_knowledge WHERE student_id = $1 AND knowledge_point_ref = $2',
      [STUDENT, item.knowledgePointRef],
    )
    expect(knowledge.rows).toHaveLength(0)
  })

  it('does not pay the reward twice when the last answer is retried', async () => {
    const { database, repository } = await setup()
    const started = await repository.startDailySession(STUDENT)
    for (const item of started!.items) {
      await repository.submitDailyAnswer({
        studentId: STUDENT, sessionId: started!.session.sessionId, contentItemId: item.contentItemId,
        response: null, timedOut: true,
      })
    }
    const retry = await repository.submitDailyAnswer({
      studentId: STUDENT, sessionId: started!.session.sessionId,
      contentItemId: started!.items.at(-1)!.contentItemId, response: null, timedOut: true,
    })
    expect(retry!.rewards).toBeUndefined()
    const state = await database.query<{ total_xp: number }>(
      'SELECT total_xp FROM student_game_state WHERE student_id = $1', [STUDENT],
    )
    expect(state.rows[0]?.total_xp).toBe(30)
  })

  it('does not stop the session when lives run out, and offers a hint instead', async () => {
    const { database, repository } = await setup()
    const started = await repository.startDailySession(STUDENT)
    const wrong = ['definitely', 'wrong']

    // わざと 5 問間違えて体力を使い切ります。
    for (const item of started!.items.slice(0, 5)) {
      await repository.submitDailyAnswer({
        studentId: STUDENT, sessionId: started!.session.sessionId, contentItemId: item.contentItemId,
        response: wrong, timedOut: false,
      })
    }
    const plan = await repository.getDailyPlan(STUDENT)
    expect(plan.lives).toBe(0)
    expect(plan.supportMode).toBe(true)

    // 締め出さずに、続きの問題に答えられます。
    const sixth = started!.items[5]!
    const answered = await repository.submitDailyAnswer({
      studentId: STUDENT, sessionId: started!.session.sessionId, contentItemId: sixth.contentItemId,
      response: null, timedOut: true,
    })
    expect(answered).not.toBeNull()
    expect(answered!.supportMode).toBe(true)
    expect(answered!.session.completedCount).toBe(6)

    // ヒントは体力が尽きているときだけ、正解そのものは伏せて返します。
    const hint = await repository.getDailyHint(STUDENT, started!.session.sessionId, started!.items[6]!.contentItemId)
    expect(hint).not.toBeNull()
    expect(hint!.hint.length).toBeGreaterThan(0)
    const stored = await database.query<{ payload: Record<string, unknown> }>(
      'SELECT payload FROM content_items WHERE id = $1', [started!.items[6]!.contentItemId],
    )
    const answer = stored.rows[0]!.payload.answer
    if (typeof answer === 'string') expect(hint!.hint).not.toContain(answer)
  })

  it('withholds the hint while the learner still has lives', async () => {
    const { repository } = await setup()
    const started = await repository.startDailySession(STUDENT)
    const hint = await repository.getDailyHint(STUDENT, started!.session.sessionId, started!.items[0]!.contentItemId)
    expect(hint).toBeNull()
  })

})
