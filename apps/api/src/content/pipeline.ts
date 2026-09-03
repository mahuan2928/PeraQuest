import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  findDuplicateVersions, parseContentLines,
  MINIMUM_ITEMS_PER_KNOWLEDGE_POINT, RECOMMENDED_ITEMS_PER_KNOWLEDGE_POINT,
  type ContentItemFile, type ParsedLine, type ParseFailure,
} from './schema.js'

export interface ContentDatabase {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string, parameters?: unknown[],
  ): Promise<{ rows: Row[] }>
}

// 自作題の台帳。CEFR-J は「どの語・どの文法がこの級で合法か」を決める根拠であって
// 問題集ではないので、source_name は原作であることを名乗ります。
export const ORIGINAL_LEDGER = {
  datasetVersion: 'cefr-j-vocabulary-profile-v1.5+grammar-profile-20180315',
  sourceName: 'PeraQuest original item (levelled with CEFR-J profiles)',
  sourceUrl: 'https://github.com/openlanguageprofiles/olp-en-cefrj',
  licenseName: 'CEFR-J Vocabulary Profile v1.5 / Grammar Profile 20180315',
  licenseScope: 'commercial use permitted with attribution; used as levelling basis only',
  attributionText: 'Levelled with CEFR-J Vocabulary Profile v1.5 and Grammar Profile 20180315 (Tono, Y.)',
  attributionLocation: '/credits',
  evidenceLink: 'https://github.com/openlanguageprofiles/olp-en-cefrj#licence',
}

export const readContentDirectory = async (directory: string): Promise<{ items: ParsedLine[]; failures: ParseFailure[] }> => {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.jsonl')).sort()
  const items: ParsedLine[] = []
  const failures: ParseFailure[] = []
  for (const name of names) {
    const parsed = parseContentLines(name, await readFile(join(directory, name), 'utf8'))
    items.push(...parsed.items)
    failures.push(...parsed.failures)
  }
  return { items, failures }
}

export interface ValidationReport {
  itemCount: number
  failures: ParseFailure[]
  duplicateVersions: string[]
  perKnowledgePoint: Array<{ knowledgePointRef: string; count: number }>
}

export const validateContent = (items: ParsedLine[], failures: ParseFailure[]): ValidationReport => {
  const counts = new Map<string, number>()
  for (const entry of items) {
    counts.set(entry.item.knowledgePointRef, (counts.get(entry.item.knowledgePointRef) ?? 0) + 1)
  }
  return {
    itemCount: items.length,
    failures,
    duplicateVersions: findDuplicateVersions(items),
    perKnowledgePoint: [...counts.entries()]
      .map(([knowledgePointRef, count]) => ({ knowledgePointRef, count }))
      .sort((left, right) => left.count - right.count || left.knowledgePointRef.localeCompare(right.knowledgePointRef)),
  }
}

/**
 * 投入は必ず in_review です。ここで published にできてしまうと、
 * 0016 の公開ゲート（日本語母語の教研レビュー）が形だけになります。
 * 既存の行は payload と分類だけ更新します。台帳と審査結果はレビュー側の持ち物です。
 */
export const importContentItems = async (
  database: ContentDatabase, items: ContentItemFile[],
): Promise<{ inserted: number; updated: number }> => {
  let inserted = 0
  let updated = 0
  for (const item of items) {
    const result = await database.query<{ was_insert: boolean }>(`
      INSERT INTO content_items (
        item_kind, knowledge_point_ref, skill_ref, payload,
        dataset_version, content_version, source_name, source_url,
        license_name, license_scope, commercial_allowed,
        attribution_text, attribution_location, author, evidence_link, status
      ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,true,$11,$12,$13,$14,'in_review')
      ON CONFLICT (content_version) WHERE content_version IS NOT NULL AND status <> 'retired'
      DO UPDATE SET
        item_kind = EXCLUDED.item_kind,
        knowledge_point_ref = EXCLUDED.knowledge_point_ref,
        skill_ref = EXCLUDED.skill_ref,
        payload = EXCLUDED.payload
      RETURNING (xmax = 0) AS was_insert
    `, [
      item.itemKind, item.knowledgePointRef, item.skillRef, JSON.stringify(item.payload),
      ORIGINAL_LEDGER.datasetVersion, item.contentVersion, ORIGINAL_LEDGER.sourceName, ORIGINAL_LEDGER.sourceUrl,
      ORIGINAL_LEDGER.licenseName, ORIGINAL_LEDGER.licenseScope,
      ORIGINAL_LEDGER.attributionText, ORIGINAL_LEDGER.attributionLocation, 'peraquest-content',
      ORIGINAL_LEDGER.evidenceLink,
    ])
    if (result.rows[0]?.was_insert) inserted += 1
    else updated += 1
  }
  return { inserted, updated }
}

export interface CoverageRow {
  knowledgePointRef: string
  published: number
  inReview: number
  shortfallToMinimum: number
  shortfallToRecommended: number
}

/**
 * 8 回の判定窓が本当に機能しているかは、合計題数では分かりません。
 * 1,200 題あっても 40 ポイントに偏っていれば 2 日目に同じ問題が出ます。
 * 見るべきはいつでも「いちばん薄い知識ポイント」です。
 */
export const readCoverage = async (database: ContentDatabase): Promise<CoverageRow[]> => {
  const result = await database.query<{ knowledge_point_ref: string; published: number; in_review: number }>(`
    SELECT knowledge_point_ref,
           count(*) FILTER (WHERE status = 'published')::int AS published,
           count(*) FILTER (WHERE status = 'in_review')::int AS in_review
    FROM content_items
    WHERE status <> 'retired'
    GROUP BY knowledge_point_ref
    ORDER BY 2 ASC, 1 ASC
  `)
  return result.rows.map((row) => ({
    knowledgePointRef: row.knowledge_point_ref,
    published: Number(row.published),
    inReview: Number(row.in_review),
    shortfallToMinimum: Math.max(0, MINIMUM_ITEMS_PER_KNOWLEDGE_POINT - Number(row.published)),
    shortfallToRecommended: Math.max(0, RECOMMENDED_ITEMS_PER_KNOWLEDGE_POINT - Number(row.published)),
  }))
}

export type PublishOutcome =
  | { status: 'published'; count: number }
  | { status: 'nothing_to_publish' }
  | { status: 'too_few'; available: number; required: number }

/**
 * 公開は知識ポイント単位です。1 題ずつ公開できると、7 題しかないポイントが
 * 出題キューに入ってしまい、窓の中で同じ問題が 2 回出ます。
 */
export const publishKnowledgePoint = async (
  database: ContentDatabase, knowledgePointRef: string, reviewer: string,
): Promise<PublishOutcome> => {
  const pending = await database.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM content_items WHERE knowledge_point_ref = $1 AND status IN ('in_review', 'published')",
    [knowledgePointRef],
  )
  const available = Number(pending.rows[0]?.count ?? 0)
  if (available < MINIMUM_ITEMS_PER_KNOWLEDGE_POINT) {
    return { status: 'too_few', available, required: MINIMUM_ITEMS_PER_KNOWLEDGE_POINT }
  }
  const published = await database.query(`
    UPDATE content_items
    SET status = 'published', reviewer = $2, reviewed_at = CURRENT_TIMESTAMP
    WHERE knowledge_point_ref = $1 AND status = 'in_review'
    RETURNING id
  `, [knowledgePointRef, reviewer])
  // すでに全部公開済みなら 0 件です。0 件を「公開しました」と返すと、
  // 押したのに何も起きていないことが呼び出し側に伝わりません。
  if (published.rows.length === 0) return { status: 'nothing_to_publish' }
  return { status: 'published', count: published.rows.length }
}
