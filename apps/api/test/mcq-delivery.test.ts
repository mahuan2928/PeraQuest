import { PGlite } from '@electric-sql/pglite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Pool } from 'pg'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations, type MigrationDatabase } from '../src/migrate.js'
import { PostgresStudentRepository } from '../src/repository.js'
import { importContentItems, publishKnowledgePoint, readContentDirectory } from '../src/content/pipeline.js'

const databases: PGlite[] = []
const STUDENT = '00000000-0000-0000-0000-0000000000c9'

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
    "INSERT INTO users (id, role, birth_month, is_minor) VALUES ($1, 'student', '2012-04-01', true)", [STUDENT],
  )
  const { items } = await readContentDirectory(resolve(dirname(fileURLToPath(import.meta.url)), '../../../content/items'))
  await importContentItems(database, items.map((entry) => entry.item))
  await publishKnowledgePoint(database, 'vocabulary.context', '教研 レビュー担当')
  const client = { query: database.query.bind(database), release: () => undefined }
  const pool = { query: database.query.bind(database), connect: async () => client } as unknown as Pool
  return { database, repository: new PostgresStudentRepository(pool) }
}

afterEach(async () => {
  await Promise.all(databases.map((database) => database.close()))
  databases.length = 0
})

describe('a published mcq item actually reaches a learner', () => {
  it('is served in the daily session with its choices and without its answer', async () => {
    const { repository } = await setup()
    const started = await repository.startDailySession(STUDENT)
    expect(started).not.toBeNull()
    const mcq = started!.items.filter((item) => item.itemKind === 'mcq')
    // 公開できたことと、届くことは別です。ここで見ているのは後者です。
    expect(mcq.length).toBeGreaterThan(0)
    expect(mcq[0]!.prompt).toHaveProperty('sentence')
    expect(mcq[0]!.prompt).toHaveProperty('choices')
    // 正解と解説は出題時に送りません。
    expect(mcq[0]!.prompt).not.toHaveProperty('answer')
    expect(mcq[0]!.prompt).not.toHaveProperty('explanation')
  })

  it('still arrives on day one when the intake cap alone cannot fill the session', async () => {
    const { database, repository } = await setup()
    const { seedContentItems } = await import('../src/seed-content.js')
    await seedContentItems(database, { publishForDemo: true })
    const started = await repository.startDailySession(STUDENT)
    // 新規投入の上限は 1 日 3 ポイントで、名前順だと grammar.* が先に入ります。
    // その 3 点では 10 題しか組めないので、12 題の下限が勝って語彙が入ります（B-2 の経路）。
    const points = [...new Set(started!.items.map((item) => item.knowledgePointRef))]
    expect(points.length).toBeGreaterThan(3)
    expect(started!.items.some((item) => item.itemKind === 'mcq')).toBe(true)
  })

  it('grades a chosen answer on the server', async () => {
    const { database, repository } = await setup()
    const started = await repository.startDailySession(STUDENT)
    const item = started!.items.find((entry) => entry.itemKind === 'mcq')!
    const answer = await database.query<{ answer: string }>(
      "SELECT payload->>'answer' AS answer FROM content_items WHERE id = $1", [item.contentItemId],
    )
    const right = await repository.submitDailyAnswer({
      studentId: STUDENT, sessionId: started!.session.sessionId, contentItemId: item.contentItemId,
      response: answer.rows[0]!.answer, timedOut: false,
    })
    expect(right!.correct).toBe(true)

    const other = started!.items.find((entry) => entry.itemKind === 'mcq' && entry.contentItemId !== item.contentItemId)!
    const otherAnswer = await database.query<{ answer: string; wrong: string }>(
      `SELECT payload->>'answer' AS answer,
              (SELECT c FROM jsonb_array_elements_text(payload->'choices') AS c WHERE c <> payload->>'answer' LIMIT 1) AS wrong
       FROM content_items WHERE id = $1`, [other.contentItemId],
    )
    const wrong = await repository.submitDailyAnswer({
      studentId: STUDENT, sessionId: started!.session.sessionId, contentItemId: other.contentItemId,
      response: otherAnswer.rows[0]!.wrong, timedOut: false,
    })
    expect(wrong!.correct).toBe(false)
    expect(wrong!.explanation.length).toBeGreaterThan(0)
  })
})
