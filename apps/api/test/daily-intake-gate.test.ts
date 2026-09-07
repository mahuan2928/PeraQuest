import { PGlite } from '@electric-sql/pglite'
import type { Pool } from 'pg'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations, type MigrationDatabase } from '../src/migrate.js'
import { PostgresStudentRepository } from '../src/repository.js'

const databases: PGlite[] = []
const STUDENT = '00000000-0000-0000-0000-0000000000f1'

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

/** 上限を試すには題庫が上限より大きい必要があるので、ここでは広い題庫を作ります。 */
const publishItems = async (database: PGlite, knowledgePoints: number, perPoint: number) => {
  for (let point = 0; point < knowledgePoints; point += 1) {
    for (let index = 0; index < perPoint; index += 1) {
      await database.query(
        `INSERT INTO content_items
           (item_kind, knowledge_point_ref, skill_ref, payload, status,
            dataset_version, content_version, source_name, source_url, license_name, license_scope,
            commercial_allowed, attribution_text, attribution_location, author, reviewer, reviewed_at, evidence_link)
         VALUES ('mcq', $1, 'grammar', '{}'::jsonb, 'published',
                 'cefr-j-vocabulary-profile-v1.5', $2,
                 'Open Language Profiles: CEFR-J Vocabulary Profile',
                 'https://github.com/openlanguageprofiles/olp-en-cefrj',
                 'CEFR-J Vocabulary Profile v1.5 licence', 'commercial app use with attribution',
                 true, 'CEFR-J Vocabulary Profile v1.5 (Tono, Y.)', '/credits', 'test', 'test', now(),
                 'https://example.invalid/licence')`,
        [`grammar.point_${String(point).padStart(2, '0')}`, `test-${point}-${index}`],
      )
    }
  }
}

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

describe('new knowledge point intake', () => {
  afterEach(async () => {
    await Promise.all(databases.map((database) => database.close()))
    databases.length = 0
  })

  it('admits at most three new knowledge points in a day', async () => {
    const { database, repository } = await setup()
    // 10 ポイント × 8 問 = 80 問。19 問の枠は埋まるので、絞っているのは上限だけです。
    await publishItems(database, 10, 8)
    const started = await repository.startDailySession(STUDENT)
    expect(started).not.toBeNull()
    expect(started!.items.length).toBe(19)
    const points = new Set(started!.items.map((item) => item.knowledgePointRef))
    expect(points.size).toBe(3)
  })

  it('lets the daily minimum win when the bank is too small to pace', async () => {
    const { database, repository } = await setup()
    // 4 ポイント × 3 問 = 12 問。上限 3 のままだと 9 問しか組めないので、下限が勝ちます。
    await publishItems(database, 4, 3)
    const started = await repository.startDailySession(STUDENT)
    expect(started).not.toBeNull()
    expect(started!.items.length).toBeGreaterThanOrEqual(12)
    expect(new Set(started!.items.map((item) => item.knowledgePointRef)).size).toBe(4)
  })

  it('admits nothing new while the overdue backlog is more than one and a half days deep', async () => {
    const { database, repository } = await setup()
    await publishItems(database, 40, 1)
    // 29 ポイントが期限切れ（19 × 1.5 = 28.5 を超える）。新規はゼロになるはずです。
    for (let point = 0; point < 29; point += 1) {
      const reference = `grammar.point_${String(point).padStart(2, '0')}`
      const item = await database.query<{ id: string }>(
        'SELECT id FROM content_items WHERE knowledge_point_ref = $1', [reference],
      )
      const session = await database.query<{ id: string }>(
        `INSERT INTO daily_sessions (student_id, session_date, target_count)
         VALUES ($1, (CURRENT_DATE - 30), 12) ON CONFLICT (student_id, session_date)
         DO UPDATE SET updated_at = CURRENT_TIMESTAMP RETURNING id`, [STUDENT],
      )
      await database.query(
        `INSERT INTO daily_answers (session_id, student_id, content_item_id, knowledge_point_ref,
           outcome, timed_out, earned_score, max_score, occurred_at)
         VALUES ($1, $2, $3, $4, 'correct', false, 1, 1, CURRENT_TIMESTAMP - interval '30 days')`,
        [session.rows[0]!.id, STUDENT, item.rows[0]!.id, reference],
      )
      await database.query('SELECT apply_daily_session_mastery_due($1, $2)', [session.rows[0]!.id, STUDENT])
    }

    const started = await repository.startDailySession(STUDENT)
    expect(started).not.toBeNull()
    const seen = new Set(
      (await database.query<{ knowledge_point_ref: string }>(
        'SELECT knowledge_point_ref FROM student_knowledge WHERE student_id = $1', [STUDENT],
      )).rows.map((row) => row.knowledge_point_ref),
    )
    const introduced = started!.items.filter((item) => !seen.has(item.knowledgePointRef))
    expect(introduced).toEqual([])
  })
})

describe('how a day is spread across knowledge points', () => {
  it('rotates through the admitted points instead of exhausting one', async () => {
    const { database, repository } = await setup()
    // 3 ポイント × 12 問。上限どおり 3 点が入りますが、
    // 1 点から 12 問続けて出すと、8 回の窓が 1 日で埋まってしまいます。
    await publishItems(database, 3, 12)
    const started = await repository.startDailySession(STUDENT)
    const perPoint = new Map<string, number>()
    for (const item of started!.items) {
      perPoint.set(item.knowledgePointRef, (perPoint.get(item.knowledgePointRef) ?? 0) + 1)
    }
    expect(perPoint.size).toBe(3)
    // 19 問を 3 点で回すので、どの点も 7 問を超えません。
    expect(Math.max(...perPoint.values())).toBeLessThanOrEqual(7)
    expect(Math.min(...perPoint.values())).toBeGreaterThanOrEqual(6)
  })
})
