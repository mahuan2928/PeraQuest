import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

// 日本人特化題型の初期題庫。
//
// 出題・例文・日本語解説はすべて当チームの原創です。CEFR-J は「どの語・文法が
// 英検 3 級相当か」を決めるレベル分けの基礎としてのみ使用しています（PRD 3.4）。
//
// 既定では in_review で投入します。日本語母語の教研レビューを受けていないものを
// published にしてしまうと、0016 で作った公開ゲートの意味がなくなるためです。
// ローカルのデモに限り --demo で公開できますが、その場合 reviewer には
// レビュー未実施であることが分かる値が入ります。

const LEDGER = {
  dataset_version: 'cefr-j-vocabulary-profile-v1.5+grammar-profile-20180315',
  source_name: 'PeraQuest original item (levelled with CEFR-J profiles)',
  source_url: 'https://github.com/openlanguageprofiles/olp-en-cefrj',
  license_name: 'CEFR-J Vocabulary Profile v1.5 / Grammar Profile 20180315',
  license_scope: 'commercial use permitted with attribution; used as levelling basis only',
  commercial_allowed: true,
  attribution_text: 'Levelled with CEFR-J Vocabulary Profile v1.5 and Grammar Profile 20180315 (Tono, Y.)',
  attribution_location: '/credits',
  author: 'peraquest-content',
  evidence_link: 'https://github.com/openlanguageprofiles/olp-en-cefrj#licence',
}

type Item = {
  itemKind: 'word_order' | 'article' | 'katakana'
  knowledgePointRef: string
  skillRef: string
  contentVersion: string
  payload: unknown
}

const items: Item[] = [
  // 語順ブロック: 日本語の語順と英語の語順の違いを、並べ替えで体感させます。
  {
    itemKind: 'word_order', knowledgePointRef: 'grammar.word_order', skillRef: 'grammar',
    contentVersion: 'wo-001',
    payload: {
      japanese: 'わたしは放課後にサッカーをします。',
      blocks: ['I', 'play', 'soccer', 'after', 'school'],
      answers: [['I', 'play', 'soccer', 'after', 'school']],
      explanation: '日本語は「いつ→何を→する」の順ですが、英語は「だれが→する→何を→いつ」の順に並べます。',
    },
  },
  {
    itemKind: 'word_order', knowledgePointRef: 'grammar.word_order', skillRef: 'grammar',
    contentVersion: 'wo-002',
    payload: {
      japanese: 'きのう宿題を終えました。',
      blocks: ['I', 'finished', 'my', 'homework', 'yesterday'],
      answers: [['I', 'finished', 'my', 'homework', 'yesterday'], ['Yesterday', 'I', 'finished', 'my', 'homework']],
      explanation: '「きのう」は文の最後にも先頭にも置けます。どちらでも自然な英語です。',
    },
  },
  {
    itemKind: 'word_order', knowledgePointRef: 'grammar.question_order', skillRef: 'grammar',
    contentVersion: 'wo-003',
    payload: {
      japanese: 'あなたはどこに住んでいますか。',
      blocks: ['Where', 'do', 'you', 'live'],
      answers: [['Where', 'do', 'you', 'live']],
      explanation: '日本語は最後に「か」を付けますが、英語は疑問詞と do を先に出します。',
    },
  },
  {
    itemKind: 'word_order', knowledgePointRef: 'grammar.word_order', skillRef: 'grammar',
    contentVersion: 'wo-004',
    payload: {
      japanese: '母は毎朝コーヒーを飲みます。',
      blocks: ['My', 'mother', 'drinks', 'coffee', 'every', 'morning'],
      answers: [['My', 'mother', 'drinks', 'coffee', 'every', 'morning'], ['Every', 'morning', 'my', 'mother', 'drinks', 'coffee']],
      explanation: '頻度を表す語句は文末が基本です。文頭に出すこともできます。',
    },
  },
  {
    itemKind: 'word_order', knowledgePointRef: 'grammar.question_order', skillRef: 'grammar',
    contentVersion: 'wo-005',
    payload: {
      japanese: '彼女は何時に起きますか。',
      blocks: ['What', 'time', 'does', 'she', 'get', 'up'],
      answers: [['What', 'time', 'does', 'she', 'get', 'up']],
      explanation: '三人称単数が主語のときは does を使い、動詞は原形に戻します。',
    },
  },

  // 冠詞センサー: a / an / the / 無冠詞 の判断。制限時間つき。
  {
    itemKind: 'article', knowledgePointRef: 'grammar.article', skillRef: 'grammar',
    contentVersion: 'ar-001',
    payload: {
      sentence: 'I have ___ apple in my bag.',
      choices: ['a', 'an', 'the', '(なし)'],
      answer: 'an',
      timeLimitSeconds: 12,
      explanation: '次の語が母音の音で始まるときは an を使います。apple は /æ/ で始まります。',
    },
  },
  {
    itemKind: 'article', knowledgePointRef: 'grammar.article', skillRef: 'grammar',
    contentVersion: 'ar-002',
    payload: {
      sentence: 'Please close ___ door.',
      choices: ['a', 'an', 'the', '(なし)'],
      answer: 'the',
      timeLimitSeconds: 12,
      explanation: 'その場の相手と「どの door か」が分かっているときは the を使います。',
    },
  },
  {
    itemKind: 'article', knowledgePointRef: 'grammar.article', skillRef: 'grammar',
    contentVersion: 'ar-003',
    payload: {
      sentence: 'She goes to ___ school by bus.',
      choices: ['a', 'an', 'the', '(なし)'],
      answer: '(なし)',
      timeLimitSeconds: 12,
      explanation: '建物ではなく「学校に通う」という行為を表すときは冠詞を付けません。',
    },
  },
  {
    itemKind: 'article', knowledgePointRef: 'grammar.article', skillRef: 'grammar',
    contentVersion: 'ar-004',
    payload: {
      sentence: 'He is ___ honest boy.',
      choices: ['a', 'an', 'the', '(なし)'],
      answer: 'an',
      timeLimitSeconds: 12,
      explanation: 'つづりが h でも、honest は発音が母音で始まるため an になります。文字ではなく音で決めます。',
    },
  },
  {
    itemKind: 'article', knowledgePointRef: 'grammar.article', skillRef: 'grammar',
    contentVersion: 'ar-005',
    payload: {
      sentence: 'I like ___ music.',
      choices: ['a', 'an', 'the', '(なし)'],
      answer: '(なし)',
      timeLimitSeconds: 12,
      explanation: '数えられない名詞を「一般に」言うときは冠詞を付けません。',
    },
  },

  // 和製英語ハンター: 片仮名語がそのまま英語で通じるかを判断させます。
  {
    itemKind: 'katakana', knowledgePointRef: 'vocabulary.loanword', skillRef: 'vocabulary',
    contentVersion: 'ka-001',
    payload: {
      katakana: 'コンセント',
      naturalEnglish: false,
      choices: ['consent', 'outlet', 'concent'],
      answer: 'outlet',
      explanation: '「コンセント」は英語では通じません。壁の差込口は outlet（英ではsocket）と言います。',
    },
  },
  {
    itemKind: 'katakana', knowledgePointRef: 'vocabulary.loanword', skillRef: 'vocabulary',
    contentVersion: 'ka-002',
    payload: {
      katakana: 'ノートパソコン',
      naturalEnglish: false,
      choices: ['note personal computer', 'laptop', 'notebook'],
      answer: 'laptop',
      explanation: '「ノートパソコン」は和製英語です。英語では laptop と言います。',
    },
  },
  {
    itemKind: 'katakana', knowledgePointRef: 'vocabulary.loanword', skillRef: 'vocabulary',
    contentVersion: 'ka-003',
    payload: {
      katakana: 'テーブル',
      naturalEnglish: true,
      choices: ['table', 'desk', 'board'],
      answer: 'table',
      explanation: '「テーブル」はそのまま table で通じます。すべての片仮名語が和製英語ではありません。',
    },
  },
  {
    itemKind: 'katakana', knowledgePointRef: 'vocabulary.loanword', skillRef: 'vocabulary',
    contentVersion: 'ka-004',
    payload: {
      katakana: 'マンション',
      naturalEnglish: false,
      choices: ['mansion', 'apartment', 'house'],
      answer: 'apartment',
      explanation: '英語の mansion は「大邸宅」です。日本の「マンション」は apartment が近い言い方です。',
    },
  },
]

export const seedContentItems = async (
  database: { query(sql: string, parameters?: unknown[]): Promise<unknown> },
  options: { publishForDemo?: boolean } = {},
): Promise<number> => {
  const publish = options.publishForDemo === true
  const status = publish ? 'published' : 'in_review'
  // レビュー未実施であることが値そのものから分かるようにします。
  const reviewer = publish ? 'unreviewed-demo-seed' : null
  const reviewedAt = publish ? new Date().toISOString() : null

  for (const item of items) {
    await database.query(
      `INSERT INTO content_items (
         item_kind, knowledge_point_ref, skill_ref, payload,
         dataset_version, content_version, source_name, source_url,
         license_name, license_scope, commercial_allowed,
         attribution_text, attribution_location, author, reviewer, reviewed_at, evidence_link,
         status
       ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT DO NOTHING`,
      [
        item.itemKind, item.knowledgePointRef, item.skillRef, JSON.stringify(item.payload),
        LEDGER.dataset_version, item.contentVersion, LEDGER.source_name, LEDGER.source_url,
        LEDGER.license_name, LEDGER.license_scope, LEDGER.commercial_allowed,
        LEDGER.attribution_text, LEDGER.attribution_location, LEDGER.author, reviewer, reviewedAt, LEDGER.evidence_link,
        status,
      ],
    )
  }
  return items.length
}

const main = async (): Promise<void> => {
  const connectionString = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL or TEST_DATABASE_URL is required')
  const publishForDemo = process.argv.includes('--demo')
  const client = new Client({ connectionString })
  await client.connect()
  try {
    const count = await seedContentItems(client, { publishForDemo })
    console.log(
      publishForDemo
        ? `Seeded ${count} content items as published for local demo (reviewer: unreviewed-demo-seed)`
        : `Seeded ${count} content items as in_review; a Japanese-native reviewer must publish them`,
    )
  } finally {
    await client.end()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
