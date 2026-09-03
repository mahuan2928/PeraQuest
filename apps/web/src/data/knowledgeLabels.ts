// 知識ポイントの日本語表示名。学生画面と保護者画面の両方から参照します。
// 内部の識別子（comparatives など）がそのまま保護者に見えないようにするための唯一の辞書です。
export const knowledgePointLabels: Record<string, string> = {
  'grammar.past_tense': '過去形',
  'vocabulary.context': '文脈から語彙を選ぶ力',
  'reading.reason': '理由を読み取る力',
  'grammar.comparative': '比較表現',
  'listening.time': '時刻を聞き取る力',
  'writing.word_order': '自然な語順',
  'past-tense': '過去形',
  'daily-vocabulary': '日常語彙',
  'main-idea': '文章の要点をつかむ力',
  comparatives: '比較表現',
  'short-dialogue': '会話文の読み取り',
  'sentence-order': '自然な語順',
  'grammar.article': '冠詞の使い分け',
  'vocabulary.katakana': 'カタカナ語と英語の違い',
}

export const knowledgePointLabel = (knowledgePointRef: string): string =>
  knowledgePointLabels[knowledgePointRef] ?? '復習ポイント'
