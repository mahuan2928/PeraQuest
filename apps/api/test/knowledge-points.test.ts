import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readCefrjGrammarCodes, readKnowledgePoints } from '../src/content/knowledgePoints.js'
import { readContentDirectory } from '../src/content/pipeline.js'
import { MINIMUM_ITEMS_PER_KNOWLEDGE_POINT } from '../src/content/schema.js'

const here = dirname(fileURLToPath(import.meta.url))
const points = await readKnowledgePoints()
const cefrjCodes = await readCefrjGrammarCodes()

describe('the knowledge point registry', () => {
  it('parses and gives every point a unique ref', () => {
    expect(points.length).toBeGreaterThan(0)
    expect(new Set(points.map((point) => point.knowledgePointRef)).size).toBe(points.length)
  })

  it('cites only CEFR-J codes that exist in the checked-in profile', () => {
    // 出典が本物であることは、この案件では飾りではありません。0016 の公開台帳が
    // 「CEFR-J で難易度づけした自作題」と名乗る根拠がここにあります。
    const unknown = points.flatMap((point) => point.cefrjCodes.filter((code) => !cefrjCodes.has(code)))
    expect(unknown).toEqual([])
  })

  it('only claims A1–A2 codes, which is the Eiken Grade 3 range', () => {
    const allowed = new Set(['A1.1', 'A1.2', 'A1.3', 'A2', 'A2.1', 'A2.2'])
    const outside = points.flatMap((point) => point.cefrjCodes
      .map((code) => ({ code, level: cefrjCodes.get(code) ?? '' }))
      .filter((entry) => !allowed.has(entry.level)))
    expect(outside).toEqual([])
  })

  it('does not silently drop an A1–A2 code that no point covers', () => {
    const covered = new Set(points.flatMap((point) => point.cefrjCodes))
    const levelled = [...cefrjCodes.entries()]
      .filter(([, level]) => ['A1.1', 'A1.2', 'A1.3', 'A2', 'A2.1', 'A2.2'].includes(level))
      .map(([code]) => code)
    expect(levelled.filter((code) => !covered.has(code))).toEqual([])
  })

  it('keeps the teaching order separate from the CEFR-J level, because they disagree', () => {
    // CEFR-J のレベルはコーパスの頻度です。受動態が A1.2、more+形容詞が A2.2 になります。
    // レベル順に教えると受動態が be 動詞より先に来ます。順序は別に持つしかありません。
    const passive = points.find((point) => point.knowledgePointRef === 'grammar.passive')!
    const bePresent = points.find((point) => point.knowledgePointRef === 'grammar.be_present')!
    expect(passive.cefrjLevels).toContain('A1.2')
    expect(bePresent.cefrjLevels).toEqual(['A1.1'])
    expect(passive.teachingOrder!).toBeGreaterThan(bePresent.teachingOrder!)
  })

  it('numbers the teaching order without gaps or repeats', () => {
    const orders = points.map((point) => point.teachingOrder).filter((order): order is number => order !== null).sort((a, b) => a - b)
    expect(orders).toEqual(Array.from({ length: orders.length }, (_, index) => index + 1))
  })

  it('scopes exactly thirty points to the first milestone', () => {
    const first = points.filter((point) => point.status === 'first-30')
    expect(first).toHaveLength(30)
    // 最初の 30 は教学順の頭から続きます。飛ばすと、飛ばした点が
    // 学習の途中で初めて現れることになります。
    expect(first.map((point) => point.teachingOrder)).toEqual(Array.from({ length: 30 }, (_, index) => index + 1))
  })

  it('puts nothing in the first thirty that no item kind can render', () => {
    const renderable = new Set(['word_order', 'article', 'katakana', 'mcq'])
    for (const point of points.filter((entry) => entry.status === 'first-30')) {
      expect(point.itemKinds.length).toBeGreaterThan(0)
      expect(point.itemKinds.every((kind) => renderable.has(kind))).toBe(true)
    }
  })

  it('records why a blocked point is blocked instead of leaving it unexplained', () => {
    for (const point of points.filter((entry) => entry.status === 'blocked')) {
      expect(point.blockedReason ?? '').not.toBe('')
      expect(point.teachingOrder).toBeNull()
    }
  })
})

describe('the registry against what is already live', () => {
  it('covers every knowledge point the demo seed uses', async () => {
    const seed = await readFile(resolve(here, '../src/seed-content.ts'), 'utf8')
    const used = [...seed.matchAll(/knowledgePointRef: '([^']+)'/g)].map((match) => match[1]!)
    const refs = new Set(points.map((point) => point.knowledgePointRef))
    expect([...new Set(used)].filter((ref) => !refs.has(ref))).toEqual([])
  })

  it('covers every knowledge point the item bank uses', async () => {
    const { items } = await readContentDirectory(resolve(here, '../../../content/items'))
    const refs = new Set(points.map((point) => point.knowledgePointRef))
    expect([...new Set(items.map((entry) => entry.item.knowledgePointRef))].filter((ref) => !refs.has(ref))).toEqual([])
  })

  it('has a Japanese label for every point, so no identifier reaches a guardian', async () => {
    const labels = await readFile(resolve(here, '../../web/src/data/knowledgeLabels.ts'), 'utf8')
    const missing = points.filter((point) => !labels.includes(`"${point.knowledgePointRef}"`))
    expect(missing.map((point) => point.knowledgePointRef)).toEqual([])
  })

  it('describes a first milestone a person can actually finish', () => {
    const first = points.filter((point) => point.status === 'first-30')
    // 30 点 × 12 題。1 題 3–5 分の教研レビューで、1 人で数日の量です。
    expect(first.length * MINIMUM_ITEMS_PER_KNOWLEDGE_POINT).toBeLessThanOrEqual(360)
  })
})
