import { PGlite } from '@electric-sql/pglite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations, type MigrationDatabase } from '../src/migrate.js'
import { seedContentItems } from '../src/seed-content.js'
import { parseContentLines } from '../src/content/schema.js'
import { importContentItems, publishKnowledgePoint, readContentDirectory, readCoverage, validateContent } from '../src/content/pipeline.js'
import { readKnowledgePoints } from '../src/content/knowledgePoints.js'

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

const freshDatabase = async () => {
  const database = new PGlite()
  databases.push(database)
  await runMigrations(asMigrationDatabase(database))
  return database
}

const line = (over: Record<string, unknown> = {}) => JSON.stringify({
  itemKind: 'mcq',
  contentVersion: 'mcq-test-001',
  knowledgePointRef: 'vocabulary.context',
  skillRef: 'vocabulary',
  payload: { sentence: 'I ___ a book.', choices: ['read', 'eat', 'run', 'sing'], answer: 'read', explanation: '本は read します。' },
  ...over,
})

const twelveItems = Array.from({ length: 12 }, (_, index) => JSON.parse(line({ contentVersion: `mcq-bulk-${index}` })))

afterEach(async () => {
  await Promise.all(databases.map((database) => database.close()))
  databases.length = 0
})

describe('content file validation', () => {
  it('refuses an answer that is not among the choices', () => {
    const parsed = parseContentLines('t.jsonl', line({ payload: { sentence: 'a ___ b', choices: ['x', 'y'], answer: 'z', explanation: 'e' } }))
    expect(parsed.items).toEqual([])
    expect(parsed.failures[0]!.message).toContain('not one of the choices')
  })

  it('refuses duplicate choices, which make two buttons indistinguishable', () => {
    const parsed = parseContentLines('t.jsonl', line({ payload: { sentence: 'a ___ b', choices: ['x', 'x'], answer: 'x', explanation: 'e' } }))
    expect(parsed.failures[0]!.message).toContain('duplicate')
  })

  it('refuses a word order answer that does not use exactly the given blocks', () => {
    // これを通すと「絶対に正解できない問題」が公開まで進みます。
    const parsed = parseContentLines('t.jsonl', JSON.stringify({
      itemKind: 'word_order', contentVersion: 'wo-x', knowledgePointRef: 'grammar.word_order', skillRef: 'grammar',
      payload: { japanese: 'テスト', blocks: ['I', 'run'], answers: [['I', 'run', 'fast']], explanation: 'e' },
    }))
    expect(parsed.failures[0]!.message).toContain('does not use exactly the given blocks')
  })

  it('refuses an unknown field rather than dropping it silently', () => {
    const parsed = parseContentLines('t.jsonl', line({ audioUrl: 'https://example.invalid/a.mp3' }))
    expect(parsed.failures).toHaveLength(1)
  })

  it('reports a repeated content_version, which is the live unique key', () => {
    const parsed = parseContentLines('t.jsonl', `${line()}\n${line()}`)
    expect(validateContent(parsed.items, parsed.failures).duplicateVersions).toEqual(['mcq-test-001'])
  })

  it('accepts the checked-in item bank', async () => {
    const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../../../content/items')
    const { items, failures } = await readContentDirectory(directory)
    const report = validateContent(items, failures)
    expect(report.failures).toEqual([])
    expect(report.duplicateVersions).toEqual([])
    expect(report.itemCount).toBeGreaterThanOrEqual(12)
  })
})

describe('content import', () => {
  it('imports as in_review, never published', async () => {
    const database = await freshDatabase()
    await importContentItems(database, twelveItems)
    const rows = await database.query<{ status: string; count: number }>(
      'SELECT status, count(*)::int AS count FROM content_items GROUP BY status',
    )
    expect(rows.rows).toEqual([{ status: 'in_review', count: 12 }])
  })

  it('refreshes an existing item instead of duplicating it', async () => {
    const database = await freshDatabase()
    await importContentItems(database, twelveItems)
    const edited = twelveItems.map((item, index) => index === 0
      ? { ...item, payload: { ...item.payload, sentence: 'I ___ a letter.' } }
      : item)
    const second = await importContentItems(database, edited)
    expect(second).toEqual({ inserted: 0, updated: 12 })
    const total = await database.query<{ count: number }>('SELECT count(*)::int AS count FROM content_items')
    expect(total.rows[0]!.count).toBe(12)
    const changed = await database.query<{ sentence: string }>(
      "SELECT payload->>'sentence' AS sentence FROM content_items WHERE content_version = 'mcq-bulk-0'",
    )
    expect(changed.rows[0]!.sentence).toBe('I ___ a letter.')
  })
})

describe('publishing a knowledge point', () => {
  it('refuses a point too thin for the eight-answer window', async () => {
    const database = await freshDatabase()
    await importContentItems(database, twelveItems.slice(0, 7))
    const result = await publishKnowledgePoint(database, 'vocabulary.context', '教研 レビュー担当')
    expect(result).toEqual({ status: 'too_few', available: 7, required: 8 })
    const published = await database.query('SELECT 1 FROM content_items WHERE status = $1', ['published'])
    expect(published.rows).toEqual([])
  })

  it('says nothing happened instead of reporting a publish of zero items', async () => {
    const database = await freshDatabase()
    await importContentItems(database, twelveItems)
    await publishKnowledgePoint(database, 'vocabulary.context', 'r')
    // 2 回目は公開するものがありません。0 件を「公開しました」と返すのは、
    // B-3 で避けた「静かに成功に見える」形と同じです。
    expect(await publishKnowledgePoint(database, 'vocabulary.context', 'r')).toEqual({ status: 'nothing_to_publish' })
  })

  it('publishes the whole point at once and records who reviewed it', async () => {
    const database = await freshDatabase()
    await importContentItems(database, twelveItems)
    const result = await publishKnowledgePoint(database, 'vocabulary.context', '教研 レビュー担当')
    expect(result).toEqual({ status: 'published', count: 12 })
    const rows = await database.query<{ reviewer: string; reviewed_at: Date | null }>(
      "SELECT reviewer, reviewed_at FROM content_items WHERE status = 'published'",
    )
    expect(rows.rows).toHaveLength(12)
    expect(rows.rows.every((row) => row.reviewer === '教研 レビュー担当' && row.reviewed_at !== null)).toBe(true)
  })
})

describe('coverage', () => {
  it('reports the shortfall per knowledge point, not the total', async () => {
    const database = await freshDatabase()
    await importContentItems(database, twelveItems)
    await publishKnowledgePoint(database, 'vocabulary.context', 'r')
    await importContentItems(database, [JSON.parse(line({ contentVersion: 'thin-1', knowledgePointRef: 'grammar.article' }))])
    const rows = await readCoverage(database, await readKnowledgePoints())
    // 合計は 13 題ありますが、薄いポイントは 1 題です。窓を壊すのはこちらです。
    expect(rows.find((row) => row.knowledgePointRef === 'grammar.article'))
      .toMatchObject({ published: 0, inReview: 1, shortfallToMinimum: 8 })
    expect(rows.find((row) => row.knowledgePointRef === 'vocabulary.context')).toMatchObject({
      published: 12, shortfallToMinimum: 0, shortfallToRecommended: 0,
    })
    // 1 題も無い点も行として出ます。これが無いと「30 点中 29 点が未着手」を言えません。
    const untouched = rows.find((row) => row.knowledgePointRef === 'grammar.be_present')
    expect(untouched).toMatchObject({ published: 0, inReview: 0, shortfallToMinimum: 8, status: 'first-30' })
  })
})

describe('the duplicate seed that 0025 closes', () => {
  it('keeps one live row when the seed is run twice', async () => {
    const database = await freshDatabase()
    await seedContentItems(database)
    await seedContentItems(database)
    const live = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM content_items WHERE status <> 'retired'",
    )
    // 0025 の前は 14 → 28 に増えていました。窓の中に同じ問題が 2 回出る原因です。
    expect(live.rows[0]!.count).toBe(14)
  })
})
