import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

export const DEMO_STAGE_EXAM_ID = '11111111-1111-4111-8111-111111111111'
const DEMO_STAGE_EXAM_VERSION_ID = '22222222-2222-4222-8222-222222222222'

const items = [
  {
    id: '33333333-3333-4333-8333-333333333331',
    itemRef: 'demo-eiken3-001',
    ordinal: 1,
    skillRef: 'grammar',
    knowledgePointRef: 'past-tense',
    prompt: 'Yesterday, I ___ my homework before dinner.',
    support: '最も自然な過去形を選んでください。',
    options: [
      { id: '44444444-4444-4444-8444-444444444431', ref: 'A', text: 'finish', ordinal: 1 },
      { id: '44444444-4444-4444-8444-444444444432', ref: 'B', text: 'finished', ordinal: 2 },
      { id: '44444444-4444-4444-8444-444444444433', ref: 'C', text: 'finishing', ordinal: 3 },
    ],
    correctRef: 'B',
  },
  {
    id: '33333333-3333-4333-8333-333333333332',
    itemRef: 'demo-eiken3-002',
    ordinal: 2,
    skillRef: 'vocabulary',
    knowledgePointRef: 'daily-vocabulary',
    prompt: 'I am looking ___ my keys.',
    support: '文脈に合う前置詞を選んでください。',
    options: [
      { id: '44444444-4444-4444-8444-444444444434', ref: 'A', text: 'for', ordinal: 1 },
      { id: '44444444-4444-4444-8444-444444444435', ref: 'B', text: 'at', ordinal: 2 },
      { id: '44444444-4444-4444-8444-444444444436', ref: 'C', text: 'by', ordinal: 3 },
    ],
    correctRef: 'A',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    itemRef: 'demo-eiken3-003',
    ordinal: 3,
    skillRef: 'reading',
    knowledgePointRef: 'main-idea',
    prompt: 'The train was late, so Emi took a bus. Why did Emi take a bus?',
    support: '本文の理由を選んでください。',
    options: [
      { id: '44444444-4444-4444-8444-444444444437', ref: 'A', text: 'The train was late.', ordinal: 1 },
      { id: '44444444-4444-4444-8444-444444444438', ref: 'B', text: 'She wanted to walk.', ordinal: 2 },
      { id: '44444444-4444-4444-8444-444444444439', ref: 'C', text: 'The bus was closed.', ordinal: 3 },
    ],
    correctRef: 'A',
  },
  {
    id: '33333333-3333-4333-8333-333333333334',
    itemRef: 'demo-eiken3-004',
    ordinal: 4,
    skillRef: 'grammar',
    knowledgePointRef: 'comparatives',
    prompt: 'This bag is ___ than that one.',
    support: '比較級として正しい語を選んでください。',
    options: [
      { id: '44444444-4444-4444-8444-44444444443a', ref: 'A', text: 'heavy', ordinal: 1 },
      { id: '44444444-4444-4444-8444-44444444443b', ref: 'B', text: 'heavier', ordinal: 2 },
      { id: '44444444-4444-4444-8444-44444444443c', ref: 'C', text: 'heaviest', ordinal: 3 },
    ],
    correctRef: 'B',
  },
  {
    id: '33333333-3333-4333-8333-333333333335',
    itemRef: 'demo-eiken3-005',
    ordinal: 5,
    skillRef: 'listening',
    knowledgePointRef: 'short-dialogue',
    prompt: 'Mika says, “Let’s meet at three.” What time will they meet?',
    support: '会話の内容に合う時刻を選んでください。',
    options: [
      { id: '44444444-4444-4444-8444-44444444443d', ref: 'A', text: 'At two.', ordinal: 1 },
      { id: '44444444-4444-4444-8444-44444444443e', ref: 'B', text: 'At three.', ordinal: 2 },
      { id: '44444444-4444-4444-8444-44444444443f', ref: 'C', text: 'At four.', ordinal: 3 },
    ],
    correctRef: 'B',
  },
  {
    id: '33333333-3333-4333-8333-333333333336',
    itemRef: 'demo-eiken3-006',
    ordinal: 6,
    skillRef: 'writing',
    knowledgePointRef: 'sentence-order',
    prompt: 'Choose the correct sentence.',
    support: '語順が自然な文を選んでください。',
    options: [
      { id: '44444444-4444-4444-8444-444444444440', ref: 'A', text: 'I play soccer after school.', ordinal: 1 },
      { id: '44444444-4444-4444-8444-444444444441', ref: 'B', text: 'Soccer play I after school.', ordinal: 2 },
      { id: '44444444-4444-4444-8444-444444444442', ref: 'C', text: 'After school soccer I play.', ordinal: 3 },
    ],
    correctRef: 'A',
  },
]

export const seedDemo = async (database: Pick<Client, 'query'>): Promise<void> => {
  await database.query('BEGIN')
  try {
    await database.query(`
      INSERT INTO stage_exams (id, exam_level, stage, code)
      VALUES ($1, 'eiken_grade_3', 1, 'demo-eiken-grade-3')
      ON CONFLICT (exam_level, stage, code) DO NOTHING
    `, [DEMO_STAGE_EXAM_ID])

    const existingVersion = await database.query<{ status: 'draft' | 'published' }>('SELECT status FROM stage_exam_versions WHERE id = $1', [DEMO_STAGE_EXAM_VERSION_ID])
    if (!existingVersion.rows[0]) {
      await database.query(`
        INSERT INTO stage_exam_versions (id, exam_id, version, status, pass_score, duration_seconds, content_hash)
        VALUES ($1, $2, 1, 'draft', 0.666667, 900, $3)
      `, [DEMO_STAGE_EXAM_VERSION_ID, DEMO_STAGE_EXAM_ID, createHash('sha256').update('peraquest-demo-eiken-grade-3-v1').digest()])
    }

    const version = await database.query<{ status: 'draft' | 'published' }>('SELECT status FROM stage_exam_versions WHERE id = $1', [DEMO_STAGE_EXAM_VERSION_ID])
    if (version.rows[0]?.status === 'draft') {
      for (const item of items) {
        await database.query(`
          INSERT INTO stage_exam_items (id, exam_version_id, item_ref, ordinal, prompt, support, points, skill_ref, knowledge_point_ref)
          VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8)
          ON CONFLICT (exam_version_id, item_ref) DO NOTHING
        `, [item.id, DEMO_STAGE_EXAM_VERSION_ID, item.itemRef, item.ordinal, item.prompt, item.support, item.skillRef, item.knowledgePointRef])
        for (const option of item.options) {
          await database.query(`
            INSERT INTO stage_exam_item_options (id, item_id, option_ref, option_text, ordinal)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (item_id, option_ref) DO NOTHING
          `, [option.id, item.id, option.ref, option.text, option.ordinal])
        }
        const correctOption = item.options.find((option) => option.ref === item.correctRef)
        if (!correctOption) throw new Error(`Missing correct option for ${item.itemRef}`)
        await database.query(`
          INSERT INTO stage_exam_item_answer_keys (item_id, correct_option_id)
          VALUES ($1, $2)
          ON CONFLICT (item_id) DO NOTHING
        `, [item.id, correctOption.id])
      }

      await database.query(`
        UPDATE stage_exam_versions
        SET status = 'published',
            published_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND status = 'draft'
      `, [DEMO_STAGE_EXAM_VERSION_ID])
    }

    await database.query('COMMIT')
  } catch (error) {
    await database.query('ROLLBACK')
    throw error
  }
}

const main = async (): Promise<void> => {
  const connectionString = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL or TEST_DATABASE_URL is required')
  const client = new Client({ connectionString })
  await client.connect()
  try {
    await seedDemo(client)
    console.log(`Seeded demo stage exam: ${DEMO_STAGE_EXAM_ID}`)
  } finally {
    await client.end()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
