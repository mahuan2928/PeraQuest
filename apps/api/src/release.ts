import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { runMigrations } from './migrate.js'
import { seedContentItems } from './seed-content.js'
import { readKnowledgePoints } from './content/knowledgePoints.js'
import { importContentItems, publishKnowledgePoint, readContentDirectory, readCoverage, validateContent } from './content/pipeline.js'

/**
 * デプロイのたびに走ります（fly.toml の release_command）。
 * 手で流す運用にすると、環境ごとにマイグレーションと題庫がずれます。
 *
 * 公開に使う reviewer 名は嘘をつきません。教研レビューを受けていない題は
 * `unreviewed-demo-seed` のまま公開します。台帳に本物の人名を書いてよいのは、
 * 実際にその人が読んだときだけです。
 */
const DEMO_REVIEWER = 'unreviewed-demo-seed'

export interface ReleaseDatabase {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string, parameters?: unknown[],
  ): Promise<{ rows: Row[] }>
}

export const contentItemsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../../content/items')

export const runRelease = async (client: ReleaseDatabase, log: (line: string) => void): Promise<void> => {
  const applied = await runMigrations(client)
  log(`migrations: ${applied.length ? applied.join(', ') : 'already up to date'}`)

  // デモ用の 14 題。reviewer が unreviewed-demo-seed なので、
  // 値そのものからレビュー未実施だと分かります。
  const seeded = await seedContentItems(client, { publishForDemo: true })
  log(`demo seed: ${seeded} items`)

  const { items, failures } = await readContentDirectory(contentItemsDirectory)
  const report = validateContent(items, failures)
  if (report.failures.length > 0 || report.duplicateVersions.length > 0) {
    for (const failure of report.failures) log(`✗ ${failure.file}:${failure.line} ${failure.message}`)
    for (const version of report.duplicateVersions) log(`✗ duplicate content_version ${version}`)
    // 壊れた題庫のまま起動するより、リリースを止めるほうが安全です。
    throw new Error('content files are invalid; refusing to release')
  }
  const imported = await importContentItems(client, items.map((entry) => entry.item))
  log(`content: ${imported.inserted} new, ${imported.updated} refreshed`)

  // 8 題に満たない知識ポイントは publishKnowledgePoint 自身が断ります。
  for (const ref of [...new Set(items.map((entry) => entry.item.knowledgePointRef))].sort()) {
    const result = await publishKnowledgePoint(client, ref, DEMO_REVIEWER)
    log(`publish ${ref}: ${result.status}`)
  }

  const coverage = await readCoverage(client, await readKnowledgePoints())
  const thinnest = coverage.reduce((low, row) => Math.min(low, row.published), Number.POSITIVE_INFINITY)
  log(`coverage: ${coverage.length} knowledge points, thinnest has ${thinnest} published items`)
}

const main = async (): Promise<void> => {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required')
  const client = new Client({ connectionString })
  await client.connect()
  try {
    await runRelease(client, (line) => process.stdout.write(`${line}\n`))
  } finally {
    await client.end()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
