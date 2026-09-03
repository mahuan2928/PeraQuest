import { createHash, randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import type { Pool } from 'pg'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations, type MigrationDatabase } from '../src/migrate.js'
import { PostgresStudentRepository } from '../src/repository.js'
import { seedDemo, DEMO_STAGE_EXAM_ID } from '../src/seed-demo.js'

const databases: PGlite[] = []
const STUDENT = '00000000-0000-0000-0000-0000000000c1'

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
  await seedDemo(asMigrationDatabase(database) as unknown as Parameters<typeof seedDemo>[0])
  await database.query(
    "INSERT INTO users (id, role, birth_month, is_minor) VALUES ($1, 'student', '2012-04-01', true)",
    [STUDENT],
  )
  // 学習監査は、行為者の身元が auth_identities に存在することを要求します。
  await database.query(
    "INSERT INTO auth_identities (id, user_id, provider, provider_subject) VALUES (gen_random_uuid(), $1, 'email_magic_link', 'sub-retake')",
    [STUDENT],
  )
  const client = { query: database.query.bind(database), release: () => undefined }
  const pool = { query: database.query.bind(database), connect: async () => client } as unknown as Pool
  return { database, repository: new PostgresStudentRepository(pool) }
}

const takeExam = async (repository: PostgresStudentRepository, key: string) => {
  const started = await repository.startStageAttempt({
    studentId: STUDENT,
    stageExamId: DEMO_STAGE_EXAM_ID,
    attemptId: randomUUID(),
    idempotencyKey: `start-${key}`,
    requestHash: createHash('sha256').update(`start-${key}`).digest(),
    actorAuthProvider: 'email_magic_link',
    actorProviderSubject: 'sub-retake',
    eventId: randomUUID(),
    requestId: randomUUID(),
  })
  if (started.status !== 'created') throw new Error(`unexpected start: ${started.status}`)
  const submitted = await repository.submitStageAttempt({
    studentId: STUDENT,
    attemptId: started.attempt.attemptId,
    idempotencyKey: `submit-${key}`,
    requestHash: createHash('sha256').update(`submit-${key}`).digest(),
    actorAuthProvider: 'email_magic_link',
    actorProviderSubject: 'sub-retake',
    eventId: randomUUID(),
    requestId: randomUUID(),
    answers: started.attempt.items.map((item) => ({ itemId: item.itemId, selectedOptionId: item.options[0]!.optionId })),
  })
  if (submitted.status !== 'submitted') throw new Error(`unexpected submit: ${submitted.status}`)
  return submitted.result
}

describe('stage attempt retake reward', () => {
  afterEach(async () => {
    await Promise.all(databases.map((database) => database.close()))
    databases.length = 0
  })

  it('pays for the first attempt and nothing for a retake of the same exam', async () => {
    const { database, repository } = await setup()

    const first = await takeExam(repository, 'one')
    expect(first.rewards?.xpAwarded).toBeGreaterThan(0)

    // 同じ試験は毎回同じスナップショットを出すため、覚えて回せば無限に稼げていました。
    const second = await takeExam(repository, 'two')
    expect(second.rewards?.xpAwarded).toBe(0)
    expect(second.rewards?.activityCoinsAwarded).toBe(0)
    expect(second.rewards?.questStepDelta).toBe(0)

    const state = await database.query<{ total_xp: number }>(
      'SELECT total_xp FROM student_game_state WHERE student_id = $1', [STUDENT],
    )
    expect(state.rows[0]?.total_xp).toBe(first.rewards!.xpAwarded)

    // 履歴は追えるよう、0 の行も台帳に残します。
    const ledger = await database.query<{ count: string }>(
      "SELECT count(*) AS count FROM game_reward_ledger WHERE source_type = 'stage_attempt'",
    )
    expect(Number(ledger.rows[0]?.count)).toBe(2)
  })
})
