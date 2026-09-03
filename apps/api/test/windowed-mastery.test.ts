import { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations, type MigrationDatabase } from '../src/migrate.js'
import { recordAnswers } from './support/knowledgeHistory.js'

const databases: PGlite[] = []
const STUDENT = '00000000-0000-0000-0000-0000000000d1'
const KP = 'grammar.past_tense'

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

const projection = async (database: PGlite, knowledgePointRef = KP) => {
  const result = await database.query<{
    window_correct: number; window_size: number; ladder_step: number
    mastery_score: string; state: string; due_at: Date; last_occurred_at: Date
    raw_attempt_total: string
  }>(
    `SELECT window_correct, window_size, ladder_step, mastery_score::text, state, due_at, last_occurred_at,
            raw_attempt_total::text
     FROM student_knowledge WHERE student_id = $1 AND knowledge_point_ref = $2`,
    [STUDENT, knowledgePointRef],
  )
  return result.rows[0]!
}

/** n 日間隔で正解を積む。段位を上げるための素直な履歴。 */
const steadyCorrect = (count: number, startDay = 1, gapDays = 30) =>
  Array.from({ length: count }, (_, index) => ({
    correct: true,
    at: new Date(Date.UTC(2026, 0, startDay + index * gapDays)).toISOString(),
  }))

describe('windowed mastery and the interval ladder', () => {
  afterEach(async () => {
    await Promise.all(databases.map((database) => database.close()))
    databases.length = 0
  })

  it('claims nothing until there are four answers', async () => {
    const database = await freshDatabase()
    await recordAnswers(database, STUDENT, KP, steadyCorrect(3))
    const row = await projection(database)
    expect(row.window_size).toBe(3)
    expect(row.state).toBe('unassessed')
  })

  it('only counts the last eight answers, so an early run of failures stops following the learner', async () => {
    const database = await freshDatabase()
    // 最初の 8 回を 2 正解（生涯比率だと 0.20 から始まる子）。
    await recordAnswers(database, STUDENT, KP, [
      ...Array.from({ length: 6 }, (_, i) => ({ correct: false, at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() })),
      ...Array.from({ length: 2 }, (_, i) => ({ correct: true, at: new Date(Date.UTC(2026, 0, 7 + i)).toISOString() })),
    ])
    expect((await projection(database)).state).toBe('learning')

    // そのあと 8 回連続で正解すると、窓は入れ替わって満点になります。
    // 旧モデルでは 0.80 に届くまで 30 連続正解が必要でした。
    await recordAnswers(database, STUDENT, KP, steadyCorrect(8, 10))
    const row = await projection(database)
    expect(row.window_size).toBe(8)
    expect(row.window_correct).toBe(8)
    expect(row.mastery_score).toBe('1.000000')
    expect(row.state).toBe('mastered')
    // 生涯の累計はそのまま残ります（保護者向けの積み上げグラフが要る）。
    expect(Number(row.raw_attempt_total)).toBe(16)
  })

  it('will not call it mastered on accuracy alone without a survived interval', async () => {
    const database = await freshDatabase()
    // 8 連続正解だが、毎日連続で解いているので段位が上がらない。
    await recordAnswers(database, STUDENT, KP, steadyCorrect(8, 1, 1))
    const row = await projection(database)
    expect(row.window_correct).toBe(8)
    expect(row.ladder_step).toBeLessThan(3)
    expect(row.state).toBe('review')
  })

  it('recomputes the ladder step from history, matching what is stored', async () => {
    const database = await freshDatabase()
    await recordAnswers(database, STUDENT, KP, [
      ...steadyCorrect(5, 1, 3),
      { correct: false, at: '2026-02-01T00:00:00Z' },
      ...steadyCorrect(4, 40, 20),
    ])
    const stored = await projection(database)
    const recomputed = await database.query<{ calculate_knowledge_ladder_step: number }>(
      'SELECT calculate_knowledge_ladder_step($1, $2)', [STUDENT, KP],
    )
    expect(recomputed.rows[0]!.calculate_knowledge_ladder_step).toBe(stored.ladder_step)
  })

  it('drops two steps on a wrong answer and resets after two in a row', async () => {
    const database = await freshDatabase()
    await recordAnswers(database, STUDENT, KP, steadyCorrect(5))
    const climbed = await projection(database)
    expect(climbed.ladder_step).toBeGreaterThanOrEqual(3)

    await recordAnswers(database, STUDENT, KP, [
      { correct: false, at: '2026-07-01T00:00:00Z' },
      { correct: false, at: '2026-07-02T00:00:00Z' },
    ])
    expect((await projection(database)).ladder_step).toBe(0)
  })

  it('leaves the interval alone when no exam date is known', async () => {
    const database = await freshDatabase()
    await recordAnswers(database, STUDENT, KP, steadyCorrect(8))
    const row = await projection(database)
    const days = Math.round((row.due_at.getTime() - row.last_occurred_at.getTime()) / 86400000)
    expect(days).toBeGreaterThan(7)
  })

  it('tightens the interval as the exam approaches and never schedules past it', async () => {
    const database = await freshDatabase()
    await recordAnswers(database, STUDENT, KP, steadyCorrect(8))
    const before = await projection(database)

    // 受験日を 10 日後に置くと、間隔は半分に詰まり、試験の 3 日前で打ち止めになります。
    const examDate = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)
    await database.query('UPDATE users SET exam_date = $2::date WHERE id = $1', [STUDENT, examDate])
    await recordAnswers(database, STUDENT, KP, [{ correct: true, at: new Date().toISOString() }])
    const after = await projection(database)

    // 比べるのは間隔の長さです。作答が増えると起点が動くので、絶対日付では比較できません。
    const daysBefore = (before.due_at.getTime() - before.last_occurred_at.getTime()) / 86400000
    const daysAfter = (after.due_at.getTime() - after.last_occurred_at.getTime()) / 86400000
    expect(daysAfter).toBeLessThan(daysBefore)
    // 試験の 3 日前より後ろには積まれません。
    expect(after.due_at.getTime()).toBeLessThanOrEqual(new Date(`${examDate}T00:00:00Z`).getTime() - 3 * 86400000)
  })
})
