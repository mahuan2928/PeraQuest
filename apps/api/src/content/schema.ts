import { z } from 'zod'

// 題目ファイルの形。seed-content.ts の TS 配列は 14 題だから読めるのであって、
// 1,200 題を 1 ファイルに書くと 1 題ずつのレビューも差分も取れません。
// 知識ポイントごとの JSONL にして、1 行 1 題にします。

const nonEmpty = z.string().trim().min(1)

/** 語順並べ替え。答えは複数許容します（「きのう」は文頭でも文末でも自然です）。 */
const wordOrderPayload = z.object({
  japanese: nonEmpty,
  blocks: z.array(nonEmpty).min(2),
  answers: z.array(z.array(nonEmpty).min(2)).min(1),
  explanation: nonEmpty,
}).strict()

const choicePayload = z.object({
  choices: z.array(nonEmpty).min(2),
  answer: nonEmpty,
  explanation: nonEmpty,
})

const articlePayload = choicePayload.extend({
  sentence: nonEmpty,
  timeLimitSeconds: z.number().int().min(5).max(60),
}).strict()

const katakanaPayload = choicePayload.extend({ katakana: nonEmpty }).strict()

/** 四択。英検3級 大問1 と同じ形です。制限時間は持ちません。 */
const mcqPayload = choicePayload.extend({ sentence: nonEmpty }).strict()

const withAnswerInChoices = <T extends { choices: string[]; answer: string }>(payload: T, context: z.RefinementCtx) => {
  if (!payload.choices.includes(payload.answer)) {
    context.addIssue({ code: 'custom', message: `answer ${payload.answer} is not one of the choices` })
  }
  if (new Set(payload.choices).size !== payload.choices.length) {
    context.addIssue({ code: 'custom', message: 'choices contain a duplicate' })
  }
}

export const contentItemSchema = z.discriminatedUnion('itemKind', [
  z.object({
    itemKind: z.literal('word_order'),
    contentVersion: nonEmpty,
    knowledgePointRef: nonEmpty,
    skillRef: nonEmpty,
    payload: wordOrderPayload.superRefine((payload, context) => {
      // 並べ替えの答えは、必ず配られたブロックだけでできている必要があります。
      // ここを緩めると「絶対に正解できない問題」が公開まで通ります。
      const available = [...payload.blocks].sort()
      for (const answer of payload.answers) {
        const used = [...answer].sort()
        if (used.length !== available.length || used.some((word, index) => word !== available[index])) {
          context.addIssue({ code: 'custom', message: `answer [${answer.join(' ')}] does not use exactly the given blocks` })
        }
      }
    }),
  }).strict(),
  z.object({
    itemKind: z.literal('article'),
    contentVersion: nonEmpty,
    knowledgePointRef: nonEmpty,
    skillRef: nonEmpty,
    payload: articlePayload.superRefine(withAnswerInChoices),
  }).strict(),
  z.object({
    itemKind: z.literal('katakana'),
    contentVersion: nonEmpty,
    knowledgePointRef: nonEmpty,
    skillRef: nonEmpty,
    payload: katakanaPayload.superRefine(withAnswerInChoices),
  }).strict(),
  z.object({
    itemKind: z.literal('mcq'),
    contentVersion: nonEmpty,
    knowledgePointRef: nonEmpty,
    skillRef: nonEmpty,
    payload: mcqPayload.superRefine(withAnswerInChoices),
  }).strict(),
])

export type ContentItemFile = z.infer<typeof contentItemSchema>

/** 判定窓が 8 回なので、1 知識ポイントに最低 8 題。推奨は 12 題です。 */
export const MINIMUM_ITEMS_PER_KNOWLEDGE_POINT = 8
export const RECOMMENDED_ITEMS_PER_KNOWLEDGE_POINT = 12

export interface ParsedLine {
  file: string
  line: number
  item: ContentItemFile
}

export interface ParseFailure {
  file: string
  line: number
  message: string
}

export const parseContentLines = (file: string, text: string): { items: ParsedLine[]; failures: ParseFailure[] } => {
  const items: ParsedLine[] = []
  const failures: ParseFailure[] = []
  text.split('\n').forEach((raw, index) => {
    const line = index + 1
    const trimmed = raw.trim()
    if (trimmed.length === 0 || trimmed.startsWith('//')) return
    let json: unknown
    try {
      json = JSON.parse(trimmed)
    } catch {
      failures.push({ file, line, message: 'not valid JSON' })
      return
    }
    const parsed = contentItemSchema.safeParse(json)
    if (!parsed.success) {
      failures.push({ file, line, message: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') })
      return
    }
    items.push({ file, line, item: parsed.data })
  })
  return { items, failures }
}

/** content_version は生きている行の一意キー（0025）なので、投入前に重なりを見ます。 */
export const findDuplicateVersions = (items: ParsedLine[]): string[] => {
  const seen = new Map<string, number>()
  for (const entry of items) seen.set(entry.item.contentVersion, (seen.get(entry.item.contentVersion) ?? 0) + 1)
  return [...seen.entries()].filter(([, count]) => count > 1).map(([version]) => version).sort()
}
