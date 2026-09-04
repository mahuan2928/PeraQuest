import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { MINIMUM_ITEMS_PER_KNOWLEDGE_POINT, RECOMMENDED_ITEMS_PER_KNOWLEDGE_POINT } from './schema.js'
import { importContentItems, publishKnowledgePoint, readContentDirectory, readCoverage, validateContent } from './pipeline.js'
import { readKnowledgePoints } from './knowledgePoints.js'

// 実行時の作業ディレクトリに依存させません。npm run の起点が変わるだけで
// 「0 題」と報告されるのがいちばん困ります。
const CONTENT_DIRECTORY = process.env.CONTENT_DIR
  ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../../content/items')

const argumentValue = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const connect = async (): Promise<Client> => {
  const connectionString = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL or TEST_DATABASE_URL is required')
  const client = new Client({ connectionString })
  await client.connect()
  return client
}

const reportValidation = (report: ReturnType<typeof validateContent>): boolean => {
  for (const failure of report.failures) {
    console.error(`✗ ${failure.file}:${failure.line} ${failure.message}`)
  }
  for (const version of report.duplicateVersions) {
    console.error(`✗ content_version "${version}" appears more than once; it is the live unique key`)
  }
  const thin = report.perKnowledgePoint.filter((row) => row.count < MINIMUM_ITEMS_PER_KNOWLEDGE_POINT)
  for (const row of thin) {
    console.warn(`… ${row.knowledgePointRef}: ${row.count} items, ${MINIMUM_ITEMS_PER_KNOWLEDGE_POINT - row.count} short of the window minimum`)
  }
  console.log(`${report.itemCount} items across ${report.perKnowledgePoint.length} knowledge points`)
  return report.failures.length === 0 && report.duplicateVersions.length === 0
}

const commands: Record<string, () => Promise<void>> = {
  async validate() {
    const { items, failures } = await readContentDirectory(CONTENT_DIRECTORY)
    if (!reportValidation(validateContent(items, failures))) process.exitCode = 1
  },

  async import() {
    const { items, failures } = await readContentDirectory(CONTENT_DIRECTORY)
    if (!reportValidation(validateContent(items, failures))) {
      process.exitCode = 1
      return
    }
    const client = await connect()
    try {
      const result = await importContentItems(client, items.map((entry) => entry.item))
      // 投入は必ず in_review です。公開はレビューを経た publish だけが行います。
      console.log(`imported ${result.inserted} new and refreshed ${result.updated} existing items as in_review`)
    } finally {
      await client.end()
    }
  },

  async coverage() {
    const points = await readKnowledgePoints()
    const client = await connect()
    try {
      const rows = await readCoverage(client, points)
      const onlyFirst = process.argv.includes('--first-30')
      const shown = onlyFirst ? rows.filter((row) => row.status === 'first-30') : rows
      console.log('#   knowledge point'.padEnd(38) + 'pub  rev   最低まで  推奨まで  状態')
      for (const row of shown) {
        console.log(
          `${String(row.teachingOrder ?? '-').padStart(3)} ${row.knowledgePointRef}`.padEnd(38) +
          String(row.published).padStart(3) + String(row.inReview).padStart(5) +
          String(row.shortfallToMinimum).padStart(10) + String(row.shortfallToRecommended).padStart(10) +
          '  ' + row.status,
        )
      }
      // 合計ではなく「まだ 1 題も無い点の数」と「いちばん薄い点」を見ます。
      // 合計が足りていても偏っていれば、2 日目に同じ問題が出ます。
      const scope = rows.filter((row) => row.status === 'first-30')
      const unstarted = scope.filter((row) => row.published + row.inReview === 0).length
      const ready = scope.filter((row) => row.published >= MINIMUM_ITEMS_PER_KNOWLEDGE_POINT).length
      console.log(
        `\n最初の 30 点: 公開ずみ ${ready} / 未着手 ${unstarted} / 残り ${scope.length - ready}` +
        `（1 点あたり最低 ${MINIMUM_ITEMS_PER_KNOWLEDGE_POINT}、推奨 ${RECOMMENDED_ITEMS_PER_KNOWLEDGE_POINT} 題）`,
      )
      const remaining = scope.reduce((total, row) => total + row.shortfallToRecommended, 0)
      console.log(`推奨まで残り ${remaining} 題`)
    } finally {
      await client.end()
    }
  },

  async publish() {
    const knowledgePoint = argumentValue('knowledge-point')
    const reviewer = argumentValue('reviewer')
    if (!knowledgePoint || !reviewer) {
      console.error('usage: content publish --knowledge-point <ref> --reviewer "<name>"')
      process.exitCode = 1
      return
    }
    const client = await connect()
    try {
      const result = await publishKnowledgePoint(client, knowledgePoint, reviewer)
      if (result.status === 'too_few') {
        console.error(
          `✗ ${knowledgePoint} has ${result.available} items; ${result.required} are needed before publishing. ` +
          'Publishing a thin point puts the same question in the window twice.',
        )
        process.exitCode = 1
        return
      }
      if (result.status === 'nothing_to_publish') {
        console.log(`nothing to publish for ${knowledgePoint}; every item there is already published`)
        return
      }
      console.log(`published ${result.count} items for ${knowledgePoint} (reviewer: ${reviewer})`)
    } finally {
      await client.end()
    }
  },
}

const main = async (): Promise<void> => {
  const command = process.argv[2] ?? ''
  const run = commands[command]
  if (!run) {
    console.error(`usage: content <${Object.keys(commands).join('|')}>`)
    process.exitCode = 1
    return
  }
  await run()
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
