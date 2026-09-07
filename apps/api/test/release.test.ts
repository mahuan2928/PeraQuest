import { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it } from 'vitest'
import { contentItemsDirectory, runRelease } from '../src/release.js'
import { readContentDirectory } from '../src/content/pipeline.js'
import { PostgresStudentRepository } from '../src/repository.js'
import type { Pool } from 'pg'

const databases: PGlite[] = []
const STUDENT = '00000000-0000-0000-0000-0000000000d7'

const asDatabase = (database: PGlite) => ({
  query: async <Row extends Record<string, unknown>>(sql: string, parameters?: unknown[]) => {
    if (parameters === undefined && sql.split(';').filter((statement) => statement.trim().length > 0).length > 1) {
      const results = await database.exec(sql)
      return { rows: (results.at(-1)?.rows ?? []) as Row[] }
    }
    return { rows: (await database.query<Row>(sql, parameters)).rows }
  },
})

const release = async () => {
  const database = new PGlite()
  databases.push(database)
  const lines: string[] = []
  await runRelease(asDatabase(database), (line) => lines.push(line))
  return { database, lines }
}

afterEach(async () => {
  await Promise.all(databases.map((database) => database.close()))
  databases.length = 0
})

describe('the release command that runs on every deploy', () => {
  it('migrates, seeds, imports and publishes from an empty database', async () => {
    const { database, lines } = await release()
    expect(lines.join('\n')).toContain('publish vocabulary.context: published')
    const published = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM content_items WHERE status = 'published'",
    )
    // 題数は増え続けるので、数字を焼き込まずに「デモ 14 題 + 題庫ファイルの全題」を数えます。
    // 固定値にすると、題を足すたびにこのテストが落ちます。
    const { items } = await readContentDirectory(contentItemsDirectory)
    expect(published.rows[0]!.count).toBe(14 + items.length)
  })

  it('is safe to run again, which it will be on the next deploy', async () => {
    const database = new PGlite()
    databases.push(database)
    const first: string[] = []
    const second: string[] = []
    await runRelease(asDatabase(database), (line) => first.push(line))
    await runRelease(asDatabase(database), (line) => second.push(line))
    const live = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM content_items WHERE status <> 'retired'",
    )
    // 2 回目で題数が増えないこと。0025 の一意キーが効いている証拠です。
    const { items } = await readContentDirectory(contentItemsDirectory)
    expect(live.rows[0]!.count).toBe(14 + items.length)
    expect(second.join('\n')).toContain('already up to date')
    expect(second.join('\n')).toContain('publish vocabulary.context: nothing_to_publish')
  })

  it('leaves a database a learner can actually start a session against', async () => {
    const { database } = await release()
    await database.query(
      "INSERT INTO users (id, role, birth_month, is_minor) VALUES ($1, 'student', '2012-04-01', true)", [STUDENT],
    )
    const client = { query: database.query.bind(database), release: () => undefined }
    const pool = { query: database.query.bind(database), connect: async () => client } as unknown as Pool
    const started = await new PostgresStudentRepository(pool).startDailySession(STUDENT)
    // リリースが通っただけでは足りません。学習者が今日の学習を始められることまで見ます。
    expect(started).not.toBeNull()
    expect(started!.items.length).toBeGreaterThanOrEqual(12)
    expect(started!.items.some((item) => item.itemKind === 'mcq')).toBe(true)
  })

  it('records the demo bank as unreviewed rather than inventing a reviewer', async () => {
    const { database } = await release()
    const reviewers = await database.query<{ reviewer: string }>(
      "SELECT DISTINCT reviewer FROM content_items WHERE status = 'published'",
    )
    // 台帳に本物の人名を書いてよいのは、実際にその人が読んだときだけです。
    expect(reviewers.rows).toEqual([{ reviewer: 'unreviewed-demo-seed' }])
  })
})
