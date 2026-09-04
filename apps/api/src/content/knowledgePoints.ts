import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

// 知識ポイントの登録簿。CEFR-J から引いた出題範囲を、
// 「学習者が独立して間違えられる単位」にまとめたものです。
//
// cefrjLevels と teachingOrder は別物です。CEFR-J のレベルは**コーパスの頻度**で、
// 教える順ではありません（受動態が A1.2、more+形容詞が A2.2 になります）。
// レベルは出典として持ち、順序はこちらの教学判断として別に持ちます。

const knowledgePointSchema = z.object({
  knowledgePointRef: z.string().min(1),
  labelJa: z.string().min(1),
  skillRef: z.string().min(1),
  teachingOrder: z.number().int().positive().nullable(),
  /** この点が根拠にしている CEFR-J Grammar Profile の Shorthand Code。 */
  cefrjCodes: z.array(z.string()),
  cefrjLevels: z.array(z.string()),
  itemKinds: z.array(z.string()),
  status: z.enum(['first-30', 'in-scope', 'blocked']),
  blockedReason: z.string().optional(),
}).strict()

export type KnowledgePoint = z.infer<typeof knowledgePointSchema>

const CONTENT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../content')

export const knowledgePointsPath = resolve(CONTENT_ROOT, 'knowledge-points.jsonl')
export const cefrjGrammarProfilePath = resolve(CONTENT_ROOT, 'reference/cefrj-grammar-profile-20180315.csv')

export const readKnowledgePoints = async (path = knowledgePointsPath): Promise<KnowledgePoint[]> => {
  const text = await readFile(path, 'utf8')
  return text.split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      const parsed = knowledgePointSchema.safeParse(JSON.parse(line))
      if (!parsed.success) {
        throw new Error(`knowledge-points.jsonl:${index + 1} ${parsed.error.issues.map((issue) => issue.message).join('; ')}`)
      }
      return parsed.data
    })
}

/** 引用している CEFR-J コードが実在するかを確かめるために、参照データから拾います。 */
export const readCefrjGrammarCodes = async (path = cefrjGrammarProfilePath): Promise<Map<string, string>> => {
  const text = await readFile(path, 'utf8')
  const [header, ...lines] = text.split('\n')
  const columns = (header ?? '').replace(/^\uFEFF/, '').split(',')
  const codeIndex = columns.indexOf('Shorthand Code')
  const levelIndex = columns.indexOf('CEFR-J Level')
  const codes = new Map<string, string>()
  for (const line of lines) {
    if (line.trim().length === 0) continue
    // 参照データの一部の欄は引用符つきです。コードとレベルの列には
    // カンマが入らないので、必要なところまでの単純な分割で足ります。
    const cells = line.split(',')
    const code = cells[codeIndex]?.trim()
    if (code) codes.set(code, cells[levelIndex]?.trim() ?? '')
  }
  return codes
}
