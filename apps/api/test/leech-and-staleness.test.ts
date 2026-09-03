import { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations, type MigrationDatabase } from '../src/migrate.js'
import { recordAnswers } from './support/knowledgeHistory.js'

const databases: PGlite[] = []
const STUDENT = '00000000-0000-0000-0000-0000000000e1'
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

const projection = async (database: PGlite) => {
  const result = await database.query<{ state: string; leech: boolean; due_at: Date; last_occurred_at: Date }>(
    'SELECT state, leech, due_at, last_occurred_at FROM student_knowledge WHERE student_id = $1 AND knowledge_point_ref = $2',
    [STUDENT, KP],
  )
  return result.rows[0]!
}

/** 実際の時刻からの相対日数。鮮度は now() の関数なので固定日付では書けません。 */
const daysAgo = (days: number, hourOffset = 0) =>
  new Date(Date.now() - days * 86_400_000 + hourOffset * 3_600_000).toISOString()

/** 8 回連続正解で mastered を作る。段位を上げるため間隔を空けます。 */
const masteredHistory = (lastDaysAgo: number) =>
  Array.from({ length: 8 }, (_, index) => ({
    correct: true,
    at: daysAgo(lastDaysAgo + (7 - index) * 31),
  }))

describe('leech', () => {
  afterEach(async () => {
    await Promise.all(databases.map((database) => database.close()))
    databases.length = 0
  })

  it('marks a point where three consecutive study days produced no correct answer', async () => {
    const database = await freshDatabase()
    await recordAnswers(database, STUDENT, KP, [
      { correct: true, at: daysAgo(10) },
      { correct: false, at: daysAgo(3) },
      { correct: false, at: daysAgo(2) },
      { correct: false, at: daysAgo(1) },
    ])
    const row = await projection(database)
    expect(row.leech).toBe(true)
  })

  it('does not mark three wrong answers inside a single sitting', async () => {
    const database = await freshDatabase()
    // 同じ日の 3 連続は「3 回の失敗」ではなく「1 回の悪い日」です。
    await recordAnswers(database, STUDENT, KP, [
      { correct: true, at: daysAgo(10) },
      { correct: false, at: daysAgo(1, 0) },
      { correct: false, at: daysAgo(1, 1) },
      { correct: false, at: daysAgo(1, 2) },
    ])
    const row = await projection(database)
    expect(row.leech).toBe(false)
  })

  it('clears once any day produces a correct answer', async () => {
    const database = await freshDatabase()
    await recordAnswers(database, STUDENT, KP, [
      { correct: false, at: daysAgo(4) },
      { correct: false, at: daysAgo(3) },
      { correct: false, at: daysAgo(2) },
      { correct: true, at: daysAgo(1) },
    ])
    expect((await projection(database)).leech).toBe(false)
  })

  it('widens the interval instead of drilling the point again tomorrow', async () => {
    const database = await freshDatabase()
    await recordAnswers(database, STUDENT, KP, [
      { correct: true, at: daysAgo(10) },
      { correct: false, at: daysAgo(3) },
      { correct: false, at: daysAgo(2) },
      { correct: false, at: daysAgo(1) },
    ])
    const row = await projection(database)
    expect(row.state).toBe('learning')
    // learning の上限は段位 1 = 1 日。leech の下限 3 日が勝ちます。
    const gapDays = (row.due_at.getTime() - row.last_occurred_at.getTime()) / 86_400_000
    expect(gapDays).toBeCloseTo(3, 3)
  })
})

describe('evidence staleness', () => {
  afterEach(async () => {
    await Promise.all(databases.map((database) => database.close()))
    databases.length = 0
  })

  it('reports a mastered point as review once its evidence is 45 days old', async () => {
    const database = await freshDatabase()
    await recordAnswers(database, STUDENT, KP, masteredHistory(50))
    const stored = await projection(database)
    expect(stored.state).toBe('mastered')

    // 何も書き足さずに読むだけ。ここで作答を挿すと、被せではなく畳み込みを試すことになります。
    const read = await database.query<{ state: string; due_at: Date }>(`
      SELECT knowledge_effective_state(sk.state, sk.last_occurred_at, u.exam_date) AS state,
             knowledge_effective_due_at(sk.due_at, sk.state, sk.last_occurred_at, u.exam_date) AS due_at
      FROM student_knowledge sk JOIN users u ON u.id = sk.student_id
      WHERE sk.student_id = $1
    `, [STUDENT])
    expect(read.rows[0]!.state).toBe('review')
    expect(read.rows[0]!.due_at.getTime()).toBeLessThanOrEqual(Date.now() + 1000)
  })

  it('leaves a mastered point alone at forty days', async () => {
    const database = await freshDatabase()
    await recordAnswers(database, STUDENT, KP, masteredHistory(40))
    const read = await database.query<{ state: string }>(`
      SELECT knowledge_effective_state(sk.state, sk.last_occurred_at, u.exam_date) AS state
      FROM student_knowledge sk JOIN users u ON u.id = sk.student_id WHERE sk.student_id = $1
    `, [STUDENT])
    expect(read.rows[0]!.state).toBe('mastered')
  })

  it('tightens to fourteen days once the exam is two weeks out', async () => {
    const database = await freshDatabase()
    await recordAnswers(database, STUDENT, KP, masteredHistory(20))
    await database.query(
      "UPDATE users SET exam_date = ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo')::date + 10) WHERE id = $1",
      [STUDENT],
    )
    const read = await database.query<{ state: string }>(`
      SELECT knowledge_effective_state(sk.state, sk.last_occurred_at, u.exam_date) AS state
      FROM student_knowledge sk JOIN users u ON u.id = sk.student_id WHERE sk.student_id = $1
    `, [STUDENT])
    // 20 日前の証拠は普段なら十分新しいのに、本番が近いと信用しません。
    expect(read.rows[0]!.state).toBe('review')
  })

  it('does not touch a point that never claimed mastery', async () => {
    const database = await freshDatabase()
    await recordAnswers(database, STUDENT, KP, [
      { correct: true, at: daysAgo(200) },
      { correct: false, at: daysAgo(199) },
      { correct: true, at: daysAgo(198) },
      { correct: false, at: daysAgo(197) },
    ])
    const read = await database.query<{ state: string; stored: string }>(`
      SELECT knowledge_effective_state(sk.state, sk.last_occurred_at, u.exam_date) AS state, sk.state AS stored
      FROM student_knowledge sk JOIN users u ON u.id = sk.student_id WHERE sk.student_id = $1
    `, [STUDENT])
    expect(read.rows[0]!.state).toBe(read.rows[0]!.stored)
  })
})
