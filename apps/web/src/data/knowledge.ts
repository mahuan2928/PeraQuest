export type MasteryStatus = 'mastered' | 'in-progress' | 'review'

export interface KnowledgePoint {
  id: string
  title: string
  summary: string
  mastery: number
  status: MasteryStatus
  statusLabel: string
  lastPracticed: string
}

export interface KnowledgeGroup {
  id: string
  title: string
  description: string
  points: KnowledgePoint[]
}

export const knowledgeGroups: KnowledgeGroup[] = [
  {
    id: 'reading',
    title: '読解の土台',
    description: '短い文章から要点とつながりを見つける力',
    points: [
      {
        id: 'main-idea',
        title: '要点をつかむ',
        summary: '文章の中心となるメッセージを見つけます。',
        mastery: 86,
        status: 'mastered',
        statusLabel: '安定している',
        lastPracticed: '昨日',
      },
      {
        id: 'context-clues',
        title: '文脈から推測する',
        summary: '知らない語句も前後のヒントから意味を考えます。',
        mastery: 62,
        status: 'in-progress',
        statusLabel: '伸びている',
        lastPracticed: '3日前',
      },
    ],
  },
  {
    id: 'grammar',
    title: '文のしくみ',
    description: '語順や時制を使って正確に伝える力',
    points: [
      {
        id: 'past-tense',
        title: '過去形を使う',
        summary: '過去の出来事を自然な文で表現します。',
        mastery: 74,
        status: 'in-progress',
        statusLabel: '練習中',
        lastPracticed: '今日',
      },
      {
        id: 'question-words',
        title: '疑問詞を使い分ける',
        summary: '知りたい内容に合わせて質問の形を選びます。',
        mastery: 38,
        status: 'review',
        statusLabel: 'もう一度',
        lastPracticed: '先週',
      },
    ],
  },
]

export const masteryStatusText: Record<MasteryStatus, string> = {
  mastered: '安定している',
  'in-progress': '伸びている',
  review: 'もう一度',
}
