import { PGlite } from '@electric-sql/pglite'
import type { Pool } from 'pg'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations, type MigrationDatabase } from '../src/migrate.js'
import { PostgresStudentRepository } from '../src/repository.js'
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

const setup = async () => {
  const database = new PGlite()
  databases.push(database)
  await runMigrations(asMigrationDatabase(database))
  await database.query(
    "INSERT INTO users (id, role, birth_month, is_minor) VALUES ($1, 'student', '2012-04-01', true)",
    [STUDENT],
  )
  const client = { query: database.query.bind(database), release: () => undefined }
  const pool = { query: database.query.bind(database), connect: async () => client } as unknown as Pool
  return { database, repository: new PostgresStudentRepository(pool) }
}

const inDays = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)

describe('exam date', () => {
  afterEach(async () => {
    await Promise.all(databases.map((database) => database.close()))
    databases.length = 0
  })

  it('is unset until someone provides it', async () => {
    const { repository } = await setup()
    expect(await repository.getExamDate(STUDENT)).toEqual({ examDate: null, daysRemaining: null })
  })

  it('reports how many days are left once it is set', async () => {
    const { repository } = await setup()
    const saved = await repository.setExamDate(STUDENT, inDays(40))
    expect(saved!.examDate).toBe(inDays(40))
    expect(saved!.daysRemaining).toBeGreaterThanOrEqual(39)
    expect(saved!.daysRemaining).toBeLessThanOrEqual(40)
  })

  it('can be cleared again', async () => {
    const { repository } = await setup()
    await repository.setExamDate(STUDENT, inDays(40))
    expect((await repository.setExamDate(STUDENT, null))!.examDate).toBeNull()
  })

  it('refuses a student who does not exist', async () => {
    const { repository } = await setup()
    expect(await repository.setExamDate('00000000-0000-0000-0000-0000000000ff', inDays(10))).toBeNull()
  })

  it('shortens the review interval once the exam is close', async () => {
    const { database, repository } = await setup()
    const history = Array.from({ length: 8 }, (_, index) => ({
      correct: true,
      at: new Date(Date.UTC(2026, 0, 1 + index * 30)).toISOString(),
    }))
    await recordAnswers(database, STUDENT, KP, history)
    const spacing = async () => {
      const row = await database.query<{ due_at: Date; last_occurred_at: Date }>(
        'SELECT due_at, last_occurred_at FROM student_knowledge WHERE student_id = $1 AND knowledge_point_ref = $2',
        [STUDENT, KP],
      )
      return (row.rows[0]!.due_at.getTime() - row.rows[0]!.last_occurred_at.getTime()) / 86400000
    }
    const withoutExam = await spacing()

    await repository.setExamDate(STUDENT, inDays(8))
    await recordAnswers(database, STUDENT, KP, [{ correct: true, at: new Date().toISOString() }])
    const withExam = await spacing()

    // 試験まで 8 日なら間隔は 4 日に詰まります（ceil(8/2)）。
    expect(withExam).toBeLessThan(withoutExam)
    expect(withExam).toBeLessThanOrEqual(4)
  })
})
