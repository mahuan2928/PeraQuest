import { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations, type MigrationDatabase } from '../src/migrate.js'
import { seedContentItems } from '../src/seed-content.js'

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

// PRD 3.4 の発布台帳。公開にはこの 13 項目がすべて必要です。
const completeLedger = {
  dataset_version: 'cefr-j-vocabulary-profile-v1.5',
  content_version: '2026-09-03.1',
  source_name: 'Open Language Profiles: CEFR-J Vocabulary Profile',
  source_url: 'https://github.com/openlanguageprofiles/olp-en-cefrj',
  license_name: 'CEFR-J Vocabulary Profile v1.5 licence',
  license_scope: 'commercial app use with attribution',
  commercial_allowed: true,
  attribution_text: 'CEFR-J Vocabulary Profile v1.5 (Tono, Y.)',
  attribution_location: '/credits',
  author: 'peraquest-content',
  reviewer: 'jp-native-reviewer',
  reviewed_at: '2026-09-03T00:00:00Z',
  evidence_link: 'https://example.invalid/licence-evidence/cefr-j-v1.5',
}

const insertItem = async (
  database: PGlite,
  overrides: Record<string, unknown> = {},
  status = 'draft',
) => {
  const row = {
    item_kind: 'word_order',
    knowledge_point_ref: 'grammar.past_tense',
    skill_ref: 'grammar',
    payload: JSON.stringify({ blocks: ['I', 'finished', 'my', 'homework'] }),
    status,
    ...overrides,
  } as Record<string, unknown>
  const columns = Object.keys(row)
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ')
  const result = await database.query<{ id: string }>(
    `INSERT INTO content_items (${columns.join(', ')}) VALUES (${placeholders}) RETURNING id`,
    columns.map((column) => row[column]),
  )
  return result.rows[0]!.id
}

describe('content item publication ledger', () => {
  afterEach(async () => {
    await Promise.all(databases.map((database) => database.close()))
    databases.length = 0
  })

  it('publishes an item once the whole ledger is present', async () => {
    const database = await freshDatabase()
    const id = await insertItem(database, completeLedger, 'published')
    const stored = await database.query<{ status: string; attribution_location: string }>(
      'SELECT status, attribution_location FROM content_items WHERE id = $1',
      [id],
    )
    expect(stored.rows[0]).toMatchObject({ status: 'published', attribution_location: '/credits' })
  })

  it.each([
    'source_name',
    'source_url',
    'license_name',
    'license_scope',
    'attribution_text',
    'attribution_location',
    'author',
    'reviewer',
    'evidence_link',
    'dataset_version',
    'content_version',
  ])('refuses to publish when %s is missing', async (missing) => {
    const database = await freshDatabase()
    await expect(
      insertItem(database, { ...completeLedger, [missing]: null }, 'published'),
    ).rejects.toThrowError(/publication ledger/)
  })

  it('refuses to publish without a review timestamp', async () => {
    const database = await freshDatabase()
    await expect(
      insertItem(database, { ...completeLedger, reviewed_at: null }, 'published'),
    ).rejects.toThrowError(/publication ledger/)
  })

  it('refuses to publish a source that does not allow commercial use', async () => {
    const database = await freshDatabase()
    await expect(
      insertItem(database, { ...completeLedger, commercial_allowed: false }, 'published'),
    ).rejects.toThrowError(/commercial use/)
  })

  it('keeps drafts writable while the ledger is still empty', async () => {
    const database = await freshDatabase()
    const id = await insertItem(database)
    await database.query("UPDATE content_items SET source_name = 'draft source' WHERE id = $1", [id])
    const stored = await database.query<{ status: string }>('SELECT status FROM content_items WHERE id = $1', [id])
    expect(stored.rows[0]?.status).toBe('draft')
  })

  it('rejects edits to a published item', async () => {
    const database = await freshDatabase()
    const id = await insertItem(database, completeLedger, 'published')
    await expect(
      database.query("UPDATE content_items SET payload = '{\"blocks\":[\"changed\"]}'::jsonb WHERE id = $1", [id]),
    ).rejects.toThrowError(/immutable/)
  })

  it('allows retiring a published item but not moving it back to draft', async () => {
    const database = await freshDatabase()
    const id = await insertItem(database, completeLedger, 'published')
    await database.query("UPDATE content_items SET status = 'retired' WHERE id = $1", [id])
    const stored = await database.query<{ status: string }>('SELECT status FROM content_items WHERE id = $1', [id])
    expect(stored.rows[0]?.status).toBe('retired')

    const draft = await insertItem(database, completeLedger, 'published')
    await expect(
      database.query("UPDATE content_items SET status = 'draft' WHERE id = $1", [draft]),
    ).rejects.toThrowError(/only be retired/)
  })

  it('requires a fresh review before republishing a retired item', async () => {
    const database = await freshDatabase()
    const id = await insertItem(database, completeLedger, 'published')
    await database.query("UPDATE content_items SET status = 'retired' WHERE id = $1", [id])
    await expect(
      database.query("UPDATE content_items SET status = 'published' WHERE id = $1", [id]),
    ).rejects.toThrowError(/fresh review/)
    await database.query(
      "UPDATE content_items SET status = 'published', reviewed_at = now() WHERE id = $1",
      [id],
    )
    const stored = await database.query<{ status: string }>('SELECT status FROM content_items WHERE id = $1', [id])
    expect(stored.rows[0]?.status).toBe('published')
  })

  it('never deletes or truncates content items', async () => {
    const database = await freshDatabase()
    const id = await insertItem(database, completeLedger, 'published')
    await expect(database.query('DELETE FROM content_items WHERE id = $1', [id])).rejects.toThrowError(/retired, not deleted/)
    // 0017 で daily_answers から参照されたため、TRUNCATE は外部キーの段階で拒否されます。
    // どちらの経路でも「切り捨てさせない」という保証は変わりません。
    await expect(database.query('TRUNCATE content_items')).rejects.toThrowError(/retired, not truncated|foreign key constraint/)
  })

  describe('the seeded item bank', () => {
    it('lands in review rather than published, because no reviewer has seen it', async () => {
      const database = await freshDatabase()
      const count = await seedContentItems(database)
      const rows = await database.query<{ status: string; reviewer: string | null }>(
        'SELECT status, reviewer FROM content_items',
      )
      expect(rows.rows).toHaveLength(count)
      expect(rows.rows.every((row) => row.status === 'in_review')).toBe(true)
      expect(rows.rows.every((row) => row.reviewer === null)).toBe(true)
    })

    it('names the reviewer honestly when published for a local demo', async () => {
      const database = await freshDatabase()
      await seedContentItems(database, { publishForDemo: true })
      const rows = await database.query<{ status: string; reviewer: string; attribution_location: string }>(
        'SELECT status, reviewer, attribution_location FROM content_items',
      )
      expect(rows.rows.every((row) => row.status === 'published')).toBe(true)
      expect(rows.rows.every((row) => row.reviewer === 'unreviewed-demo-seed')).toBe(true)
      expect(rows.rows.every((row) => row.attribution_location === '/credits')).toBe(true)
    })

    it('covers the three item types the daily level needs', async () => {
      const database = await freshDatabase()
      await seedContentItems(database, { publishForDemo: true })
      const kinds = await database.query<{ item_kind: string; count: string }>(
        'SELECT item_kind, count(*) AS count FROM content_items GROUP BY item_kind ORDER BY item_kind',
      )
      expect(kinds.rows.map((row) => row.item_kind)).toEqual(['article', 'katakana', 'word_order'])
      const total = kinds.rows.reduce((sum, row) => sum + Number(row.count), 0)
      // 1 関卡は 12-15 題なので、1 日ぶんを埋められる数が必要です。
      expect(total).toBeGreaterThanOrEqual(12)
    })
  })
})
