import { PGlite } from '@electric-sql/pglite'
import type { Pool } from 'pg'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../src/migrate.js'
import { PostgresStudentRepository } from '../src/repository.js'
import { runRelease } from '../src/release.js'

const databases: PGlite[] = []
const STUDENT = '00000000-0000-0000-0000-0000000000f9'

const asDatabase = (database: PGlite) => ({
  query: async <Row extends Record<string, unknown>>(sql: string, parameters?: unknown[]) => {
    if (parameters === undefined && sql.split(';').filter((statement) => statement.trim().length > 0).length > 1) {
      const results = await database.exec(sql)
      return { rows: (results.at(-1)?.rows ?? []) as Row[] }
    }
    return { rows: (await database.query<Row>(sql, parameters)).rows }
  },
})

const setup = async ({ withContent = true } = {}) => {
  const database = new PGlite()
  databases.push(database)
  if (withContent) await runRelease(asDatabase(database), () => undefined)
  else await runMigrations(asDatabase(database))
  await database.query(
    "INSERT INTO users (id, role, birth_month, is_minor) VALUES ($1, 'student', '2012-04-01', true)", [STUDENT],
  )
  const client = { query: database.query.bind(database), release: () => undefined }
  const pool = { query: database.query.bind(database), connect: async () => client } as unknown as Pool
  return { database, repository: new PostgresStudentRepository(pool) }
}

const setExamDate = (database: PGlite, offsetDays: number) => database.query(
  `UPDATE users SET exam_date = ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo')::date + $2::int) WHERE id = $1`,
  [STUDENT, offsetDays],
)

afterEach(async () => {
  await Promise.all(databases.map((database) => database.close()))
  databases.length = 0
})

describe('the study plan', () => {
  it('counts what can be taught today, not the whole syllabus', async () => {
    const { repository } = await setup()
    const plan = await repository.getStudyPlan(STUDENT)
    // 範囲は 56 点ありますが、題庫が届いているのはその一部だけです。
    // 母数を範囲にすると、守れない約束を数字で見せることになります。
    expect(plan.teachablePoints).toBeGreaterThan(0)
    expect(plan.teachablePoints).toBeLessThan(plan.scopePoints)
    expect(plan.startedPoints).toBe(0)
    expect(plan.steadyPoints).toBe(0)
  })

  it('has no exam date for a new learner, which is the ordinary case', async () => {
    const { repository } = await setup()
    const plan = await repository.getStudyPlan(STUDENT)
    expect(plan.examDate).toBeNull()
    expect(plan.daysRemaining).toBeNull()
  })

  it('counts the days left when an exam date is set', async () => {
    const { database, repository } = await setup()
    await setExamDate(database, 30)
    expect((await repository.getStudyPlan(STUDENT)).daysRemaining).toBe(30)
  })

  it('reports zero on the day of the exam rather than hiding it', async () => {
    const { database, repository } = await setup()
    await setExamDate(database, 0)
    expect((await repository.getStudyPlan(STUDENT)).daysRemaining).toBe(0)
  })

  it('reports a past exam date as negative instead of pretending it is ahead', async () => {
    const { database, repository } = await setup()
    await setExamDate(database, -3)
    // 過ぎた日付を 0 に丸めると、受験が終わったことが画面から消えます。
    expect((await repository.getStudyPlan(STUDENT)).daysRemaining).toBe(-3)
  })

  it('offers nothing to learn when the bank is empty, without dividing by it', async () => {
    const { repository } = await setup({ withContent: false })
    const plan = await repository.getStudyPlan(STUDENT)
    expect(plan.teachablePoints).toBe(0)
    expect(plan.nextPoints).toEqual([])
  })

  it('names the next points in teaching order, not by CEFR-J level', async () => {
    const { repository } = await setup()
    const plan = await repository.getStudyPlan(STUDENT)
    expect(plan.nextPoints.length).toBeGreaterThan(0)
    // 教える順の 1 番は be動詞の現在形です。CEFR-J のレベル順だと受動態が先に来ます。
    expect(plan.nextPoints[0]!.knowledgePointRef).toBe('grammar.be_present')
    expect(plan.nextPoints[0]!.labelJa).not.toBe(plan.nextPoints[0]!.knowledgePointRef)
    expect(plan.nextPoints.length).toBeLessThanOrEqual(3)
  })

  it('stops naming a point once the learner has started it', async () => {
    const { database, repository } = await setup()
    const before = await repository.getStudyPlan(STUDENT)
    const first = before.nextPoints[0]!.knowledgePointRef

    const item = await database.query<{ id: string }>(
      "SELECT id FROM content_items WHERE knowledge_point_ref = $1 AND status = 'published' LIMIT 1", [first],
    )
    const session = await database.query<{ id: string }>(
      `INSERT INTO daily_sessions (student_id, session_date, target_count)
       VALUES ($1, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo')::date, 12) RETURNING id`, [STUDENT],
    )
    await database.query(
      `INSERT INTO daily_answers (session_id, student_id, content_item_id, knowledge_point_ref,
         outcome, timed_out, earned_score, max_score, occurred_at)
       VALUES ($1, $2, $3, $4, 'correct', false, 1, 1, CURRENT_TIMESTAMP)`,
      [session.rows[0]!.id, STUDENT, item.rows[0]!.id, first],
    )
    await database.query('SELECT apply_daily_session_mastery_due($1, $2)', [session.rows[0]!.id, STUDENT])

    const after = await repository.getStudyPlan(STUDENT)
    expect(after.startedPoints).toBe(1)
    expect(after.nextPoints.map((point) => point.knowledgePointRef)).not.toContain(first)
  })
})
