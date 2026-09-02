<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  createDemoGuardianInvitation,
  createDemoVoiceUploadTicket,
  fetchDemoGameState,
  fetchDemoStageAttemptResult,
  fetchDemoStudentKnowledge,
  registerDemoDevice,
  startDemoStageAttempt,
  submitDemoStageAttempt,
  type DemoSessionResponse,
} from '../api/demoFlow'

type CapabilityState = {
  canLearn?: boolean
  canUploadVoice?: boolean
  voiceUploadMode?: string
  canPurchase?: boolean
  guardianLinkStatus?: string
  voiceConsentStatus?: string
}

type StageQuestion = {
  itemId: string
  prompt: string
  support: string | null
  options: Array<{ optionId: string; text: string }>
}

type StageAttempt = {
  attemptId: string
  items: StageQuestion[]
}

type KnowledgeItem = {
  knowledgePointRef: string
  masteryScore: number
  state: string
  dueAt: string | null
}

type GameReward = {
  xpAwarded: number
  activityCoinsAwarded: number
  questStepDelta: number
  questChapterUnlocked: number | null
  badgesAwarded: string[]
}

type GameState = {
  totalXp: number
  activityCoins: number
  questChapter: number
  questStep: number
  badges: string[]
}

type QuestMapNode = {
  id: string
  islandId: string
  title: string
  description: string
  reward: string
  action: string
  status: 'done' | 'current' | 'locked'
}

type QuestIsland = {
  id: string
  chapter: string
  title: string
  description: string
  status: 'done' | 'current' | 'locked'
  nodes: QuestMapNode[]
}

type JourneySummary = {
  completedQuestCount: number
  totalQuestCount: number
  totalXp: number
  activityCoins: number
  masteryAverage: number
  highlights: string[]
  badges: string[]
  nextStep: string
}

type InventoryItem = {
  id: string
  title: string
  detail: string
  status: 'collected' | 'locked'
}

type DemoGuide = {
  step: string
  title: string
  detail: string
  action: string
  talkTrack: string
  checkpoints: string[]
}

type DemoMetric = {
  label: string
  value: string
  detail: string
}

const props = defineProps<{
  session: DemoSessionResponse
  capabilities: CapabilityState | null
  invitationCode: string
  knowledgeItems: KnowledgeItem[]
}>()

const emit = defineEmits<{
  refresh: []
  invitationCreated: [code: string]
  knowledgeUpdated: [items: KnowledgeItem[]]
  journeyUpdated: [summary: JourneySummary]
}>()

const demoStageExamId = import.meta.env.VITE_DEMO_STAGE_EXAM_ID ?? '11111111-1111-4111-8111-111111111111'
const busy = ref(false)
const message = ref('')
const error = ref('')
const attempt = ref<StageAttempt | null>(null)
const selected = ref<Record<string, string>>({})
const resultSummary = ref<{ passed?: boolean; score?: number; maxScore?: number; rewards?: GameReward } | null>(null)
const gameState = ref<GameState | null>(null)
const voiceReady = ref(false)
const deviceReady = ref(false)
const selectedQuestNodeId = ref<string | null>(null)
const earnedReward = ref<GameReward | null>(null)
const rewardCelebrationOpen = ref(false)
const reviewQuestOpen = ref(false)
const reviewQuestCompleted = ref(false)
const reviewQuestReward = ref<GameReward | null>(null)
const reviewReadAloudDone = ref(false)
const reviewFocusRef = ref('')
const reviewRewriteText = ref('')
const nextIslandPreviewOpen = ref(false)
const listeningDemoOpen = ref(false)
const listeningDemoAnswer = ref('')
const listeningDemoSubmitted = ref(false)
const listeningDemoReward = ref<GameReward | null>(null)

const guardianReady = computed(() => props.capabilities?.guardianLinkStatus === 'verified')
const learnReady = computed(() => props.capabilities?.canLearn === true)
const voiceEnabled = computed(() => props.capabilities?.canUploadVoice === true)
const answered = computed(() => attempt.value?.items.every((item) => selected.value[item.itemId]) === true)
const masteryAverage = computed(() => {
  if (!props.knowledgeItems.length) return 0
  return Math.round((props.knowledgeItems.reduce((sum, item) => sum + item.masteryScore, 0) / props.knowledgeItems.length) * 100)
})
const reviewCompletionReward: GameReward = {
  xpAwarded: 15,
  activityCoinsAwarded: 5,
  questStepDelta: 1,
  questChapterUnlocked: null,
  badgesAwarded: ['review_forest_cleared'],
}
const listeningDemoCompletionReward: GameReward = {
  xpAwarded: 10,
  activityCoinsAwarded: 3,
  questStepDelta: 0,
  questChapterUnlocked: null,
  badgesAwarded: ['listening_cove_trial'],
}
const demoMetrics: DemoMetric[] = [
  {
    label: '保護者確認',
    value: '+20 XP',
    detail: 'ガーディアンシールドを獲得し、学習が解放されます。',
  },
  {
    label: 'Level Check',
    value: '+100 XP / +50 コイン',
    detail: '標準デモではクリア結果として説明します。',
  },
  {
    label: '復習クエスト',
    value: '+15 XP / +5 コイン',
    detail: '復習の森クリアが冒険バッグに入ります。',
  },
  {
    label: 'リスニング体験',
    value: '+10 XP / +3 コイン',
    detail: 'リスニング入り江体験バッジを紹介します。',
  },
]
const questStep = computed(() => {
  const rawStep = gameState.value?.questStep ?? 0
  const badges = new Set(gameState.value?.badges ?? [])
  const earnedStep = reviewQuestCompleted.value
    ? 4
    : badges.has('level_check_cleared') || badges.has('level_check_challenger') || props.knowledgeItems.length > 0
      ? 3
      : badges.has('guardian_shield') || (gameState.value?.totalXp ?? 0) >= 20
        ? 2
        : 0
  return Math.max(rawStep, earnedStep)
})
const questProgress = computed(() => Math.min(100, Math.round((questStep.value / questMapNodes.value.length) * 100)))
const localRewards = computed(() => [reviewQuestReward.value, listeningDemoReward.value].filter((reward): reward is GameReward => Boolean(reward)))
const displayedTotalXp = computed(() => (gameState.value?.totalXp ?? 0) + localRewards.value.reduce((sum, reward) => sum + reward.xpAwarded, 0))
const displayedActivityCoins = computed(() => (gameState.value?.activityCoins ?? 0) + localRewards.value.reduce((sum, reward) => sum + reward.activityCoinsAwarded, 0))
const displayedBadges = computed(() => {
  const badges = new Set(gameState.value?.badges ?? [])
  for (const reward of localRewards.value) {
    for (const badge of reward.badgesAwarded) badges.add(badge)
  }
  return [...badges]
})
const inventoryItems = computed<InventoryItem[]>(() => [
  {
    id: 'xp',
    title: 'XP クリスタル',
    detail: `${displayedTotalXp.value} XP を集めました。`,
    status: displayedTotalXp.value > 0 ? 'collected' : 'locked',
  },
  {
    id: 'coins',
    title: '冒険コイン',
    detail: `${displayedActivityCoins.value} コインを持っています。`,
    status: displayedActivityCoins.value > 0 ? 'collected' : 'locked',
  },
  {
    id: 'route-map',
    title: '島の航海図',
    detail: `${completedQuestCount.value} / ${questMapNodes.value.length} スポットを記録しました。`,
    status: completedQuestCount.value > 0 ? 'collected' : 'locked',
  },
])
const badgeInventoryItems = computed<InventoryItem[]>(() => displayedBadges.value.map((badge) => ({
  id: badge,
  title: badgeLabels[badge] ?? badge,
  detail: '冒険で手に入れたバッジです。',
  status: 'collected' as const,
})))
const lockedInventoryHints = computed<InventoryItem[]>(() => [
  {
    id: 'review-hint',
    badgeId: 'review_forest_cleared',
    title: '復習の森クリア',
    detail: '復習クエストを終えるとバッグに入ります。',
    status: 'locked' as const,
  },
  {
    id: 'listening-hint',
    badgeId: 'listening_cove_trial',
    title: 'リスニング入り江体験',
    detail: '次の島の1問体験で手に入ります。',
    status: 'locked' as const,
  },
].filter((item) => !displayedBadges.value.includes(item.badgeId)))
const inventoryCollectionCount = computed(() => inventoryItems.value.filter((item) => item.status === 'collected').length + badgeInventoryItems.value.length)
const badgeLabels: Record<string, string> = {
  guardian_shield: 'ガーディアンシールド',
  level_check_cleared: 'レベルチェッククリア',
  level_check_challenger: 'Quest チャレンジャー',
  review_forest_cleared: '復習の森クリア',
  listening_cove_trial: 'リスニング入り江体験',
}
const knowledgePointLabels: Record<string, string> = {
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
  'short-dialogue': '短い会話を聞き取る力',
  'sentence-order': '自然な語順',
}
const questBlueprint = [
  {
    id: 'start',
    islandId: 'harbor',
    title: 'はじまりの港',
    description: '英検3級の冒険を始めます。',
    reward: 'スタート',
    action: 'デモを開始しました。',
  },
  {
    id: 'guardian',
    islandId: 'harbor',
    title: '家族の門',
    description: '保護者確認で安全に学習を解放します。',
    reward: '盾バッジ',
    action: '保護者に確認を依頼しましょう。',
  },
  {
    id: 'level-check',
    islandId: 'harbor',
    title: '力だめしの丘',
    description: 'レベルチェックで今の得意と復習を見つけます。',
    reward: 'XP + コイン',
    action: 'レベルチェックに挑戦しましょう。',
  },
  {
    id: 'review',
    islandId: 'forest',
    title: '復習の森',
    description: '苦手な単元を短く復習します。',
    reward: '復習ルート',
    action: '復習予定を見て、短く確認しましょう。',
  },
  {
    id: 'next-island',
    islandId: 'cove',
    title: '次の島',
    description: '次のステージへ進む準備をします。',
    reward: '近日公開',
    action: '次の冒険は準備中です。',
  },
] satisfies Array<Omit<QuestMapNode, 'status'>>
const questIslandBlueprint = [
  {
    id: 'harbor',
    chapter: 'Chapter 1',
    title: 'はじまりの島',
    description: '家族連携と力だめしで冒険の準備を整えます。',
  },
  {
    id: 'forest',
    chapter: 'Chapter 2',
    title: '復習の森',
    description: '苦手ポイントを短く確認して、次の島への道を開きます。',
  },
  {
    id: 'cove',
    chapter: 'Chapter 3',
    title: 'リスニング入り江',
    description: '短い会話を聞き取り、新しい冒険の予告を体験します。',
  },
] as const
const questMapNodes = computed<QuestMapNode[]>(() => questBlueprint.map((node, index) => {
  const stepNumber = index + 1
  const status = questStep.value >= stepNumber ? 'done' : questStep.value === index ? 'current' : 'locked'
  return { ...node, status }
}))
const questIslands = computed<QuestIsland[]>(() => questIslandBlueprint.map((island) => {
  const nodes = questMapNodes.value.filter((node) => node.islandId === island.id)
  const status = nodes.every((node) => node.status === 'done')
    ? 'done'
    : nodes.some((node) => node.status === 'current' || node.status === 'done')
      ? 'current'
      : 'locked'
  return { ...island, nodes, status }
}))
const currentQuestNode = computed(() => questMapNodes.value.find((node) => node.status === 'current') ?? questMapNodes.value.at(-1)!)
const selectedQuestNode = computed(() => questMapNodes.value.find((node) => node.id === selectedQuestNodeId.value) ?? currentQuestNode.value)
const completedQuestCount = computed(() => questMapNodes.value.filter((node) => node.status === 'done').length)
const currentQuestIsland = computed<QuestIsland>(() => questIslands.value.find((island) => island.nodes.some((node) => node.id === currentQuestNode.value.id)) ?? questIslands.value[0]!)
const reviewQuestItems = computed(() => [...props.knowledgeItems]
  .sort((left, right) => left.masteryScore - right.masteryScore)
  .slice(0, 3))
const reviewQuestReady = computed(() => questStep.value >= 3 && reviewQuestItems.value.length > 0)
const reviewTaskProgress = computed(() => [
  reviewReadAloudDone.value,
  Boolean(reviewFocusRef.value),
  reviewRewriteText.value.trim().length >= 6,
].filter(Boolean).length)
const reviewQuestCanComplete = computed(() => reviewQuestOpen.value && reviewTaskProgress.value === 3)
const nextIslandReady = computed(() => questStep.value >= 4)
const listeningDemoOptions = [
  {
    id: 'library',
    text: '図書館で会う',
  },
  {
    id: 'station',
    text: '駅で会う',
  },
  {
    id: 'park',
    text: '公園で会う',
  },
] as const
const demoAnswerTextByPrompt: Record<string, string> = {
  'Yesterday, I ___ my homework before dinner.': 'finished',
  'I am looking ___ my keys.': 'for',
  'The train was late, so Emi took a bus. Why did Emi take a bus?': 'The train was late.',
  'This bag is ___ than that one.': 'heavier',
  'Mika says, “Let’s meet at three.” What time will they meet?': 'At three.',
  'Choose the correct sentence.': 'I play soccer after school.',
}
const listeningDemoCorrect = computed(() => listeningDemoAnswer.value === 'library')
const journeySummaryVisible = computed(() => Boolean(resultSummary.value) || reviewQuestCompleted.value || listeningDemoSubmitted.value)
const journeyHighlights = computed(() => [
  guardianReady.value ? '保護者確認が完了しました' : '',
  resultSummary.value || questStep.value >= 3 ? 'レベルチェックを完了しました' : '',
  reviewQuestCompleted.value ? '復習の森をクリアしました' : '',
  listeningDemoSubmitted.value ? 'リスニング入り江を体験しました' : '',
].filter(Boolean))
const latestBadgeLabels = computed(() => displayedBadges.value.map((badge) => badgeLabels[badge] ?? badge).slice(-4))
const journeyNextStep = computed(() => {
  if (listeningDemoSubmitted.value) return '次は、リスニング入り江の本編公開に向けて短い会話を続けましょう。'
  if (nextIslandReady.value) return '次は、リスニング入り江の1問体験に進みましょう。'
  if (reviewQuestReady.value) return '次は、復習の森で苦手ポイントを短く確認しましょう。'
  return 'まずはレベルチェックで今の得意と復習ポイントを見つけましょう。'
})
const demoGuide = computed<DemoGuide>(() => {
  if (listeningDemoSubmitted.value) {
    return {
      step: '最後に見せる',
      title: '保護者レポートへ切り替えます',
      detail: '学習結果、冒険の進み、次のおすすめが保護者にも伝わることを確認します。',
      action: '上部の「保護者として体験」を押します。',
      talkTrack: '最後に、子どもの体験が保護者の見守りレポートにつながることを見せます。',
      checkpoints: ['今日の冒険まとめ', 'リスニング入り江体験', '保護者レポート'],
    }
  }
  if (nextIslandReady.value) {
    return {
      step: '次の見せ場',
      title: '次の島プレビューを開きます',
      detail: '復習の成果が新しい冒険の予告につながる流れを見せます。',
      action: '「次の島をプレビューします」を押します。',
      talkTrack: '復習が終わると、次に進みたくなる予告が開きます。',
      checkpoints: ['復習の森クリア', '次の島プレビュー', 'リスニング入り江'],
    }
  }
  if (reviewQuestReady.value) {
    return {
      step: '次の操作',
      title: '復習クエストを体験します',
      detail: 'レベルチェックで見つけた苦手ポイントが、短い復習タスクに変わります。',
      action: '「復習クエストを始めます」を押します。',
      talkTrack: '苦手をただ表示するのではなく、次の短い冒険タスクに変換します。',
      checkpoints: ['復習予定', '3つの復習タスク', 'ごほうび'],
    }
  }
  if (resultSummary.value) {
    return {
      step: '見せるポイント',
      title: 'Quest Map と冒険バッグを確認します',
      detail: '回答結果が XP、コイン、バッジ、次の復習ルートに変わったことを説明します。',
      action: '画面上部の Quest Map と冒険バッグを見せます。',
      talkTrack: '点数だけで終わらず、学習成果が冒険の進みと報酬になります。',
      checkpoints: ['XP', 'コイン', '復習の森'],
    }
  }
  if (attempt.value) {
    return {
      step: '次の操作',
      title: 'レベルチェックを提出します',
      detail: '短い問題に答えるだけで、得意と復習ポイントが見えることを見せます。',
      action: '答えを選んで「答えを提出します」を押します。',
      talkTrack: 'デモ用の回答ボタンを使うと、毎回同じ説明しやすい結果にできます。',
      checkpoints: ['デモ用の回答', '6問', '提出ボタン'],
    }
  }
  if (learnReady.value) {
    return {
      step: '次の操作',
      title: 'レベルチェックを開始します',
      detail: '安全確認後に学習が解放され、冒険が学習結果で進む入口です。',
      action: '「レベルチェックを開始します」を押します。',
      talkTrack: '保護者確認が終わると、子どもはすぐ学習冒険を始められます。',
      checkpoints: ['家族の門達成', 'レベルチェック開始', 'Quest Map'],
    }
  }
  if (props.invitationCode) {
    return {
      step: 'デモの切り替え',
      title: '保護者確認を完了します',
      detail: '子ども側で招待コードを出し、保護者側で確認すると学習が解放されます。',
      action: '上部の「保護者として体験」に切り替えます。',
      talkTrack: '未成年向けの安全導線として、学習前に保護者確認を通します。',
      checkpoints: ['招待コード', '保護者として体験', '連携確認'],
    }
  }
  return {
    step: '最初の操作',
    title: '保護者への確認依頼を作ります',
    detail: '未成年向けの安全導線として、学習前に保護者確認が必要なことを見せます。',
    action: '「招待コードを発行します」を押します。',
    talkTrack: '最初に、安全に学習を始めるための親子連携を見せます。',
    checkpoints: ['Demo Guide', 'Quest Map', '招待コード'],
  }
})
const journeySummary = computed<JourneySummary>(() => ({
  completedQuestCount: completedQuestCount.value,
  totalQuestCount: questMapNodes.value.length,
  totalXp: displayedTotalXp.value,
  activityCoins: displayedActivityCoins.value,
  masteryAverage: masteryAverage.value,
  highlights: journeyHighlights.value,
  badges: displayedBadges.value,
  nextStep: journeyNextStep.value,
}))
const questStatusLabel = (status: QuestMapNode['status']) => {
  if (status === 'done') return '達成'
  if (status === 'current') return '次の目標'
  return 'ロック中'
}
const knowledgePointLabel = (knowledgePointRef: string) => knowledgePointLabels[knowledgePointRef] ?? '復習ポイント'
const reviewStateLabel = (state: string) => {
  if (state === 'mastered') return '安定'
  if (state === 'due') return '復習優先'
  if (state === 'learning') return '練習中'
  return '確認'
}
const selectQuestNode = (node: QuestMapNode) => {
  selectedQuestNodeId.value = node.id
  if (node.id === 'review' && reviewQuestReady.value && !reviewQuestOpen.value) {
    startReviewQuest()
  }
}
const fillDemoLevelCheckAnswers = () => {
  if (!attempt.value || resultSummary.value) return
  const nextSelected: Record<string, string> = { ...selected.value }
  for (const item of attempt.value.items) {
    const suggestedText = demoAnswerTextByPrompt[item.prompt]
    const suggestedOption = item.options.find((option) => option.text === suggestedText) ?? item.options[0]
    if (suggestedOption) nextSelected[item.itemId] = suggestedOption.optionId
  }
  selected.value = nextSelected
  message.value = 'デモ用の回答を入力しました。このまま結果まで進めます。'
}
const closeRewardCelebration = () => {
  rewardCelebrationOpen.value = false
}
const startReviewQuest = () => {
  if (!reviewQuestReady.value) return
  selectedQuestNodeId.value = 'review'
  reviewQuestOpen.value = true
  reviewQuestCompleted.value = false
  reviewQuestReward.value = null
  reviewReadAloudDone.value = false
  reviewFocusRef.value = ''
  reviewRewriteText.value = ''
  message.value = '復習の森に入りました。今日の3つを短く確認しましょう。'
}
const completeReviewQuest = () => {
  if (!reviewQuestCanComplete.value) return
  reviewQuestCompleted.value = true
  reviewQuestReward.value = reviewCompletionReward
  earnedReward.value = reviewCompletionReward
  rewardCelebrationOpen.value = true
  message.value = '今日の復習クエストを完了しました。次の冒険へ進む準備ができています。'
}
const openNextIslandPreview = () => {
  if (!nextIslandReady.value) return
  selectedQuestNodeId.value = 'next-island'
  nextIslandPreviewOpen.value = true
  message.value = '次の島の予告を開きました。新しい冒険の準備を確認しましょう。'
}
const startListeningDemo = () => {
  if (!nextIslandReady.value) return
  listeningDemoOpen.value = true
  listeningDemoSubmitted.value = false
  listeningDemoAnswer.value = ''
  listeningDemoReward.value = null
  message.value = 'リスニング入り江の体験を開始しました。会話の内容を選びましょう。'
}
const submitListeningDemo = () => {
  if (!listeningDemoAnswer.value || listeningDemoSubmitted.value) return
  listeningDemoSubmitted.value = true
  listeningDemoReward.value = listeningDemoCompletionReward
  earnedReward.value = listeningDemoCompletionReward
  rewardCelebrationOpen.value = true
  message.value = listeningDemoCorrect.value
    ? '正解です。短い会話から待ち合わせ場所を聞き取れました。リスニング入り江の体験バッジを獲得しました。'
    : '場所を表す言葉に注目できました。リスニング入り江の体験バッジを獲得しました。'
}

const hasRewardValue = (reward: GameReward | null): reward is GameReward => (
  Boolean(reward)
  && (reward!.xpAwarded > 0 || reward!.activityCoinsAwarded > 0 || reward!.questStepDelta > 0 || reward!.badgesAwarded.length > 0)
)

const rewardFromGameStateDelta = (before: GameState | null, after: GameState | null): GameReward | null => {
  if (!after) return null
  const previousBadges = new Set(before?.badges ?? [])
  return {
    xpAwarded: Math.max(0, after.totalXp - (before?.totalXp ?? 0)),
    activityCoinsAwarded: Math.max(0, after.activityCoins - (before?.activityCoins ?? 0)),
    questStepDelta: Math.max(0, after.questStep - (before?.questStep ?? 0)),
    questChapterUnlocked: after.questChapter > (before?.questChapter ?? 0) ? after.questChapter : null,
    badgesAwarded: after.badges.filter((badge) => !previousBadges.has(badge)),
  }
}

function toUserMessage() {
  return '接続を確認して、もう一度お試しください。'
}

async function runAction(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await action()
  } catch (caught) {
    console.error(caught)
    error.value = toUserMessage()
  } finally {
    busy.value = false
  }
}

async function refreshGameState() {
  const response = await fetchDemoGameState(props.session.studentToken)
  if (response.ok) gameState.value = response.body as GameState
}

async function createInvitation() {
  await runAction(async () => {
    const response = await createDemoGuardianInvitation(props.session.studentToken)
    if (!response.ok) throw new Error('invitation failed')
    emit('invitationCreated', response.body.inviteCode)
    message.value = '保護者に確認依頼を送りました。'
  })
}

async function startLevelCheck() {
  await runAction(async () => {
    const response = await startDemoStageAttempt(props.session.studentToken, demoStageExamId, `student-start-${props.session.studentId}`)
    if (!response.ok) throw new Error('stage attempt start failed')
    attempt.value = response.body as StageAttempt
    selected.value = {}
    resultSummary.value = null
    earnedReward.value = null
    rewardCelebrationOpen.value = false
    message.value = 'レベルチェックを開始しました。'
  })
}

async function submitLevelCheck() {
  if (!attempt.value || !answered.value) return
  await runAction(async () => {
    const previousGameState = gameState.value
    const answers = attempt.value!.items.map((item) => ({
      itemId: item.itemId,
      selectedOptionId: selected.value[item.itemId] ?? null,
    }))
    const submitted = await submitDemoStageAttempt(props.session.studentToken, attempt.value!.attemptId, answers, `student-submit-${props.session.studentId}`)
    if (!submitted.ok) throw new Error('stage attempt submit failed')
    const result = await fetchDemoStageAttemptResult(props.session.studentToken, attempt.value!.attemptId)
    if (!result.ok) throw new Error('stage attempt result failed')
    resultSummary.value = result.body as { passed?: boolean; score?: number; maxScore?: number; rewards?: GameReward }
    let progressRefreshOk = true
    try {
      const knowledge = await fetchDemoStudentKnowledge(props.session.studentToken)
      if (knowledge.ok) emit('knowledgeUpdated', ((knowledge.body as { items?: KnowledgeItem[] }).items ?? []))
      await refreshGameState()
    } catch {
      progressRefreshOk = false
    }
    const reward = resultSummary.value.rewards ?? rewardFromGameStateDelta(previousGameState, gameState.value)
    earnedReward.value = hasRewardValue(reward) ? reward : null
    rewardCelebrationOpen.value = Boolean(earnedReward.value)
    message.value = progressRefreshOk
      ? 'レベルチェックの結果を保存しました。Quest 進捗と復習予定を更新しました。'
      : 'レベルチェックの結果を保存しました。進捗は少し待ってから更新されます。'
  })
}

async function prepareVoicePractice() {
  await runAction(async () => {
    const response = await createDemoVoiceUploadTicket(props.session.studentToken)
    if (!response.ok) throw new Error('voice upload failed')
    voiceReady.value = true
    message.value = '音声練習を提出できる状態になりました。'
  })
}

async function registerDevice() {
  await runAction(async () => {
    const response = await registerDemoDevice(props.session.studentToken)
    if (!response.ok) throw new Error('device registration failed')
    deviceReady.value = true
    message.value = 'この端末で体験を続けられるようにしました。'
  })
}

onMounted(() => {
  void refreshGameState()
})

watch(
  () => [props.capabilities?.guardianLinkStatus, props.capabilities?.voiceConsentStatus],
  () => {
    void refreshGameState()
  },
)

watch(currentQuestNode, (node) => {
  selectedQuestNodeId.value = node.id
}, { immediate: true })

watch(() => props.knowledgeItems.length, (count) => {
  if (!count) {
    reviewQuestOpen.value = false
    reviewQuestCompleted.value = false
    reviewReadAloudDone.value = false
    reviewFocusRef.value = ''
    reviewRewriteText.value = ''
  }
})

watch(journeySummary, (summary) => {
  emit('journeyUpdated', summary)
}, { immediate: true })

// --- 表示層のみ: 「いま何をすべきか」を1つに絞るためのミッション導線 ---
type Mission = {
  id: 'submit-answers' | 'invite' | 'await-guardian' | 'level-check' | 'review' | 'voice' | 'device' | 'done'
  step: string
  title: string
  detail: string
  ctaLabel: string | null
  targetId: string | null
}


const nextMission = computed<Mission>(() => {
  if (attempt.value && !resultSummary.value) {
    return {
      id: 'submit-answers',
      step: 'レベルチェック中',
      title: '答えを選んで提出します',
      detail: answered.value ? 'すべて選べました。提出できます。' : `${attempt.value.items.length} 問すべてに答えると提出できます。`,
      ctaLabel: answered.value ? '答えを提出します' : '問題を見ます',
      targetId: 'level-check-panel',
    }
  }
  if (!guardianReady.value && !props.invitationCode) {
    return {
      id: 'invite',
      step: 'ステップ 1 / 4',
      title: '保護者に確認を依頼します',
      detail: '未成年の方は、学習を始める前に保護者の確認が必要です。',
      ctaLabel: '招待コードを発行します',
      targetId: null,
    }
  }
  if (!guardianReady.value) {
    return {
      id: 'await-guardian',
      step: 'ステップ 1 / 4',
      title: '保護者の確認を待っています',
      detail: '「保護者として体験」に切り替えて、招待コードを入力してください。',
      ctaLabel: null,
      targetId: null,
    }
  }
  if (learnReady.value && !resultSummary.value) {
    return {
      id: 'level-check',
      step: 'ステップ 2 / 4',
      title: 'レベルチェックを受けます',
      detail: '今の得意と、復習したいポイントを確認します。',
      ctaLabel: 'レベルチェックを開始します',
      targetId: 'level-check-panel',
    }
  }
  if (reviewQuestReady.value && !reviewQuestCompleted.value) {
    return {
      id: 'review',
      step: 'ステップ 3 / 4',
      title: '今日の復習クエストに進みます',
      detail: 'レベルチェックで見つかった苦手ポイントを短く確認します。',
      ctaLabel: '復習クエストを始めます',
      targetId: 'review-panel',
    }
  }
  if (voiceEnabled.value && !voiceReady.value) {
    return {
      id: 'voice',
      step: 'ステップ 4 / 4',
      title: '音声練習を試します',
      detail: '保護者の同意により、音声練習が利用できます。',
      ctaLabel: '音声練習を提出します',
      targetId: null,
    }
  }
  if (!deviceReady.value) {
    return {
      id: 'device',
      step: '仕上げ',
      title: 'この端末を登録します',
      detail: '次回もこの端末で続きから体験できるようにします。',
      ctaLabel: '端末を登録します',
      targetId: null,
    }
  }
  return {
    id: 'done',
    step: '完了',
    title: '今日の冒険は完了しました',
    detail: '保護者アプリに切り替えると、今日の学習成果を確認できます。',
    ctaLabel: null,
    targetId: null,
  }
})

// ミッション ID を「保護者の確認 / レベルチェック / 復習 / 音声練習」の4段トラックに対応させます。
const missionTrackIndex: Record<Mission['id'], number> = {
  invite: 0,
  'await-guardian': 0,
  'level-check': 1,
  'submit-answers': 1,
  review: 2,
  voice: 3,
  device: 4,
  done: 4,
}
const missionStepIndex = computed(() => missionTrackIndex[nextMission.value.id])

const missionBusy = computed(() => {
  if (busy.value) return true
  if (nextMission.value.id === 'invite') return Boolean(props.invitationCode)
  if (nextMission.value.id === 'submit-answers') return false
  return false
})

const focusTarget = (targetId: string | null) => {
  if (!targetId) return
  document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const runMission = () => {
  const mission = nextMission.value
  switch (mission.id) {
    case 'submit-answers':
      if (answered.value) void submitLevelCheck()
      else focusTarget(mission.targetId)
      return
    case 'invite':
      void createInvitation()
      return
    case 'level-check':
      focusTarget(mission.targetId)
      void startLevelCheck()
      return
    case 'review':
      focusTarget(mission.targetId)
      startReviewQuest()
      return
    case 'voice':
      void prepareVoicePractice()
      return
    case 'device':
      void registerDevice()
      return
    default:
  }
}

const comingSoonOpen = ref(false)
const demoGuideOpen = ref(false)
</script>

<template>
  <section
    class="product-panel"
    aria-labelledby="student-app-title"
  >
    <header class="product-hero compact">
      <p class="eyebrow">
        生徒アプリ
      </p>
      <h1 id="student-app-title">
        今日の学習
      </h1>
    </header>

    <!-- 今日のミッション: 画面上で唯一の主操作 -->
    <section
      class="mission-bar"
      :class="`mission-${nextMission.id}`"
      aria-label="今日のミッション"
    >
      <div class="mission-main">
        <p class="mission-step">
          {{ nextMission.step }}
        </p>
        <h2>{{ nextMission.title }}</h2>
        <p class="mission-detail">
          {{ nextMission.detail }}
        </p>
        <button
          v-if="nextMission.ctaLabel"
          class="primary-action mission-cta"
          type="button"
          :disabled="missionBusy"
          @click="runMission"
        >
          {{ nextMission.ctaLabel }}
        </button>
        <p
          v-else
          class="mission-waiting"
          role="status"
        >
          {{ nextMission.id === 'await-guardian' ? '保護者の確認をお待ちください。' : '次の操作はありません。' }}
        </p>
        <div
          v-if="invitationCode"
          class="mission-code"
        >
          <span>招待コード</span>
          <strong class="invitation-code">{{ invitationCode }}</strong>
          <small>「保護者として体験」に切り替えて入力してください。</small>
        </div>
      </div>

      <div class="mission-side">
        <dl class="mission-stats">
          <div>
            <dt>XP</dt>
            <dd>{{ displayedTotalXp }}</dd>
          </div>
          <div>
            <dt>コイン</dt>
            <dd>{{ displayedActivityCoins }}</dd>
          </div>
          <div>
            <dt>スポット</dt>
            <dd>{{ completedQuestCount }} / {{ questMapNodes.length }}</dd>
          </div>
        </dl>
        <ol class="mission-track">
          <li
            v-for="(label, index) in ['保護者の確認', 'レベルチェック', '復習', '音声練習']"
            :key="label"
            :class="{ done: missionStepIndex > index, current: missionStepIndex === index }"
          >
            <span>{{ missionStepIndex > index ? '✓' : index + 1 }}</span>
            <small>{{ label }}</small>
          </li>
        </ol>
      </div>
    </section>

    <div class="student-layout">
      <div class="student-main">
        <section
          id="level-check-panel"
          class="lesson-panel"
        >
          <header class="lesson-header">
            <div>
              <p class="eyebrow">
                レベルチェック
              </p>
              <strong>英検3級 · レベルチェック</strong>
            </div>
            <p>{{ attempt ? `${attempt.items.length} 問` : learnReady ? '準備できました' : '保護者の確認後に開始できます' }}</p>
          </header>

          <p
            v-if="!attempt && !learnReady"
            class="panel-empty"
          >
            まだレベルチェックは始められません。保護者の確認が完了すると、ここから開始できます。
          </p>

          <button
            v-else-if="!attempt"
            class="primary-action"
            type="button"
            :disabled="busy"
            @click="startLevelCheck"
          >
            レベルチェックを開始します
          </button>

          <article
            v-else-if="!resultSummary"
            class="question-card"
          >
            <div class="demo-answer-guide">
              <div>
                <span>Demo Stable Path</span>
                <strong>デモ用の回答を入れて、同じ結果で説明できます。</strong>
              </div>
              <button
                class="secondary-action"
                type="button"
                :disabled="busy"
                @click="fillDemoLevelCheckAnswers"
              >
                デモ用の回答を入れます
              </button>
            </div>
            <div
              v-for="(item, index) in attempt.items"
              :key="item.itemId"
              class="stage-question"
            >
              <span class="ability-tag">問題 {{ index + 1 }}</span>
              <h2>{{ item.prompt }}</h2>
              <p class="question-support">
                {{ item.support }}
              </p>
              <fieldset :disabled="busy">
                <legend class="sr-only">
                  答えを1つ選んでください
                </legend>
                <label
                  v-for="option in item.options"
                  :key="option.optionId"
                  class="choice"
                  :class="{ selected: selected[item.itemId] === option.optionId }"
                >
                  <input
                    v-model="selected[item.itemId]"
                    type="radio"
                    :name="item.itemId"
                    :value="option.optionId"
                  >
                  <span>{{ option.text }}</span>
                </label>
              </fieldset>
            </div>
            <button
              class="primary-action"
              type="button"
              :disabled="busy || !answered"
              @click="submitLevelCheck"
            >
              答えを提出します
            </button>
          </article>

          <article
            v-else
            class="result-card"
          >
            <strong>{{ resultSummary.passed ? '合格ラインに到達しました' : '復習から始めましょう' }}</strong>
            <p>今回の結果をもとに、復習予定を更新しました。</p>
            <p class="score-line">
              {{ resultSummary.score }} / {{ resultSummary.maxScore }}
            </p>
            <div
              v-if="earnedReward"
              class="reward-summary"
            >
              <span>+{{ earnedReward.xpAwarded }} XP</span>
              <span>+{{ earnedReward.activityCoinsAwarded }} コイン</span>
              <span v-if="earnedReward.questStepDelta">
                Quest +{{ earnedReward.questStepDelta }}
              </span>
            </div>
          </article>
        </section>

        <article
          id="review-panel"
          class="action-card"
        >
          <p class="card-kicker">
            復習予定
          </p>
          <h2>今日の復習</h2>
          <p>{{ knowledgeItems.length ? `${knowledgeItems.length} 件の復習予定があります。` : 'レベルチェックが終わると、復習予定がここに表示されます。' }}</p>
          <div
            v-if="knowledgeItems.length"
            class="mini-mastery"
          >
            <strong>{{ masteryAverage }}%</strong>
            <span>平均習熟度</span>
          </div>
          <section
            v-if="reviewQuestItems.length"
            class="review-route"
            aria-label="今日の復習クエスト"
          >
            <span>今日の復習クエスト</span>
            <strong>復習の森ルート</strong>
            <ol>
              <li
                v-for="item in reviewQuestItems"
                :key="item.knowledgePointRef"
              >
                <span>{{ reviewStateLabel(item.state) }}</span>
                <strong>{{ knowledgePointLabel(item.knowledgePointRef) }}</strong>
                <small>習熟度 {{ Math.round(item.masteryScore * 100) }}%</small>
              </li>
            </ol>
          </section>
          <button
            v-if="reviewQuestReady && !reviewQuestOpen"
            class="primary-action"
            type="button"
            @click="startReviewQuest"
          >
            復習クエストを始めます
          </button>
          <section
            v-if="reviewQuestOpen"
            class="review-quest-panel"
            aria-live="polite"
          >
            <span>森のルート</span>
            <strong>{{ reviewQuestItems.length }}つのポイントを確認中</strong>
            <p>声に出して例文を読み、間違えた理由を1つだけ思い出しましょう。</p>
            <div class="review-task-list">
              <label
                class="review-task"
                :class="{ done: reviewReadAloudDone }"
              >
                <input
                  v-model="reviewReadAloudDone"
                  type="checkbox"
                  :disabled="reviewQuestCompleted"
                >
                <span>
                  <strong>例文を声に出して読みました</strong>
                  <small>今日の復習ポイントを1つ、ゆっくり読み上げます。</small>
                </span>
              </label>
              <fieldset
                class="review-focus-task"
                :disabled="reviewQuestCompleted"
              >
                <legend>今日いちばん復習したいポイント</legend>
                <label
                  v-for="item in reviewQuestItems"
                  :key="`focus-${item.knowledgePointRef}`"
                  class="review-task"
                  :class="{ done: reviewFocusRef === item.knowledgePointRef }"
                >
                  <input
                    v-model="reviewFocusRef"
                    type="radio"
                    name="review-focus"
                    :value="item.knowledgePointRef"
                  >
                  <span>
                    <strong>{{ knowledgePointLabel(item.knowledgePointRef) }}</strong>
                    <small>習熟度 {{ Math.round(item.masteryScore * 100) }}%</small>
                  </span>
                </label>
              </fieldset>
              <label
                class="review-task rewrite"
                :class="{ done: reviewRewriteText.trim().length >= 6 }"
              >
                <span>
                  <strong>短い英文を1つ書き直しました</strong>
                  <small>例: I finished my homework.</small>
                </span>
                <input
                  v-model="reviewRewriteText"
                  class="review-rewrite-input"
                  type="text"
                  placeholder="I finished my homework."
                  :disabled="reviewQuestCompleted"
                >
              </label>
            </div>
            <p class="review-task-progress">
              {{ reviewTaskProgress }} / 3 タスク完了
            </p>
            <button
              class="secondary-action"
              type="button"
              :disabled="reviewQuestCompleted || !reviewQuestCanComplete"
              @click="completeReviewQuest"
            >
              {{ reviewQuestCompleted ? '復習済みです' : '今日の復習を完了します' }}
            </button>
            <p
              v-if="reviewQuestCompleted"
              class="review-complete"
            >
              今日の復習を完了しました。次は「次の島」の準備へ進みます。
            </p>
          </section>
        </article>

        <article class="action-card quest-card">
          <p class="card-kicker">
            Quest
          </p>
          <h2>Quest Map</h2>
          <div class="quest-current">
            <span>現在の目標</span>
            <strong>{{ currentQuestIsland.title }} · {{ currentQuestNode.title }}</strong>
            <p>{{ currentQuestNode.action }}</p>
          </div>
          <div class="quest-trail">
            <span :style="{ width: `${questProgress}%` }" />
          </div>
          <p class="quest-step">
            {{ completedQuestCount }} / {{ questMapNodes.length }} スポット達成
          </p>
          <ol
            class="quest-map"
            aria-label="Quest Map"
          >
            <li
              v-for="island in questIslands"
              :key="island.id"
              class="quest-island"
              :class="island.status"
            >
              <div class="quest-island-heading">
                <span>{{ island.chapter }}</span>
                <strong>{{ island.title }}</strong>
                <small>{{ island.status === 'locked' ? 'ここから先は、次の目標を達成すると開きます。' : island.description }}</small>
              </div>
              <ol
                v-if="island.status !== 'locked'"
                class="quest-island-nodes"
              >
                <li
                  v-for="node in island.nodes"
                  :key="node.id"
                  class="quest-node"
                  :class="node.status"
                >
                  <button
                    class="quest-node-button"
                    type="button"
                    :aria-pressed="selectedQuestNode.id === node.id"
                    @click="selectQuestNode(node)"
                  >
                    <span class="quest-pin">{{ node.status === 'done' ? '✓' : questMapNodes.findIndex((item) => item.id === node.id) + 1 }}</span>
                    <div>
                      <strong>
                        {{ node.title }}
                        <small class="quest-state-label">{{ questStatusLabel(node.status) }}</small>
                      </strong>
                      <small>{{ node.description }}</small>
                      <em>{{ node.reward }}</em>
                    </div>
                    <span
                      v-if="node.id === currentQuestNode.id"
                      class="quest-avatar"
                      aria-label="現在地"
                    >
                      LQ
                    </span>
                  </button>
                </li>
              </ol>
            </li>
          </ol>
          <section
            class="quest-detail compact"
            aria-live="polite"
          >
            <span>スポット詳細</span>
            <strong>{{ selectedQuestNode.title }}</strong>
            <p>{{ selectedQuestNode.action }}</p>
          </section>
        </article>

        <section
          v-if="journeySummaryVisible"
          class="journey-summary-card"
          aria-label="学習旅程サマリー"
        >
          <p class="card-kicker">
            Journey Summary
          </p>
          <h2>今日の冒険まとめ</h2>
          <div class="journey-score-grid">
            <div>
              <strong>{{ completedQuestCount }}</strong>
              <span>達成スポット</span>
            </div>
            <div>
              <strong>{{ displayedTotalXp }}</strong>
              <span>XP</span>
            </div>
            <div>
              <strong>{{ displayedActivityCoins }}</strong>
              <span>コイン</span>
            </div>
            <div>
              <strong>{{ masteryAverage }}%</strong>
              <span>平均習熟度</span>
            </div>
          </div>
          <ul class="journey-highlight-list">
            <li
              v-for="highlight in journeyHighlights"
              :key="highlight"
            >
              {{ highlight }}
            </li>
          </ul>
          <div
            v-if="latestBadgeLabels.length"
            class="journey-badges"
          >
            <span>獲得バッジ</span>
            <strong>{{ latestBadgeLabels.join(' / ') }}</strong>
          </div>
          <p class="journey-next-step">
            {{ journeyNextStep }}
          </p>
        </section>
      </div>

      <aside class="student-side">
        <article class="action-card side-card">
          <p class="card-kicker">
            ステータス
          </p>
          <h2>準備の状況</h2>
          <ul class="safety-list compact">
            <li :class="{ done: guardianReady }">
              <span>{{ guardianReady ? '✓' : '1' }}</span>
              <div>
                <strong>保護者の確認</strong>
                <small>{{ guardianReady ? '完了しました。' : '確認を待っています。' }}</small>
              </div>
            </li>
            <li :class="{ done: learnReady }">
              <span>{{ learnReady ? '✓' : '2' }}</span>
              <div>
                <strong>学習の解放</strong>
                <small>{{ learnReady ? 'レベルチェックを開始できます。' : '確認後に解放されます。' }}</small>
              </div>
            </li>
            <li :class="{ done: voiceEnabled }">
              <span>{{ voiceEnabled ? '✓' : '3' }}</span>
              <div>
                <strong>音声練習</strong>
                <small>{{ voiceEnabled ? '利用できます。' : '保護者の同意が必要です。' }}</small>
              </div>
            </li>
          </ul>
          <button
            v-if="voiceEnabled"
            class="secondary-action"
            type="button"
            :disabled="busy || voiceReady"
            @click="prepareVoicePractice"
          >
            {{ voiceReady ? '提出準備が完了しました' : '音声練習を提出します' }}
          </button>
        </article>

        <article class="action-card side-card inventory-card">
          <p class="card-kicker">
            Collection
          </p>
          <h2>冒険バッグ</h2>
          <div class="inventory-count compact">
            <strong>{{ inventoryCollectionCount }}</strong>
            <span>コレクション</span>
          </div>
          <div class="inventory-resource-grid">
            <div
              v-for="item in inventoryItems"
              :key="item.id"
              class="inventory-item"
              :class="item.status"
            >
              <span>{{ item.status === 'collected' ? '✓' : '?' }}</span>
              <strong>{{ item.title }}</strong>
              <small>{{ item.detail }}</small>
            </div>
          </div>
          <section class="inventory-section">
            <h3>バッジ</h3>
            <p v-if="!badgeInventoryItems.length">
              最初のバッジは保護者確認で手に入ります。
            </p>
            <div
              v-else
              class="inventory-badge-grid"
            >
              <span
                v-for="badge in badgeInventoryItems"
                :key="badge.id"
              >
                {{ badge.title }}
              </span>
            </div>
          </section>
          <section
            v-if="lockedInventoryHints.length"
            class="inventory-section locked"
          >
            <h3>次に集めるもの</h3>
            <ul>
              <li
                v-for="item in lockedInventoryHints"
                :key="item.id"
              >
                <strong>{{ item.title }}</strong>
                <small>{{ item.detail }}</small>
              </li>
            </ul>
          </section>
        </article>

        <article class="action-card side-card">
          <p class="card-kicker">
            端末設定
          </p>
          <h2>端末の登録</h2>
          <p>{{ deviceReady ? '端末登録が完了しました。' : 'この端末で続きから体験できます。' }}</p>
          <button
            class="secondary-action"
            type="button"
            :disabled="busy || deviceReady"
            @click="registerDevice"
          >
            {{ deviceReady ? '登録済みです' : '端末を登録します' }}
          </button>
        </article>
      </aside>
    </div>

    <section class="coming-soon">
      <button
        class="coming-soon-toggle"
        type="button"
        :aria-expanded="comingSoonOpen"
        @click="comingSoonOpen = !comingSoonOpen"
      >
        <span>近日公開の体験</span>
        <strong>学習プラン ・ 次の島 ・ リスニング入り江</strong>
        <small>{{ comingSoonOpen ? '閉じる' : '開く' }}</small>
      </button>
      <div
        v-if="comingSoonOpen"
        class="coming-soon-body"
      >
        <article class="future-card">
          <h3>学習プラン</h3>
          <p>正式なお支払い機能は準備中です。現在の体験では、保護者確認後にレベルチェックへ進めます。</p>
          <span class="plan-badge">近日公開</span>
        </article>
        <article class="future-card">
          <h3>次の島</h3>
          <p>{{ nextIslandReady ? '復習の森を越えました。次のステージの予告を確認できます。' : '復習クエストを完了すると、次の島の予告が開きます。' }}</p>
          <button
            class="secondary-action"
            type="button"
            :disabled="!nextIslandReady"
            @click="openNextIslandPreview"
          >
            {{ nextIslandReady ? '次の島をプレビューします' : '復習後にプレビューできます' }}
          </button>
        </article>
        <article
          v-if="nextIslandPreviewOpen"
          class="future-card wide"
        >
          <h3>リスニング入り江</h3>
          <p>短い会話を聞き取り、時間・理由・気持ちを選ぶ新しい冒険です。</p>
          <ul class="future-list">
            <li>3分で挑戦できる短い会話</li>
            <li>復習の森で見つけた苦手ポイントを反映</li>
            <li>保護者レポートに次のおすすめとして表示予定</li>
          </ul>
          <button
            class="secondary-action"
            type="button"
            :disabled="listeningDemoSubmitted"
            @click="startListeningDemo"
          >
            {{ listeningDemoSubmitted ? '体験済みです' : '1問だけ体験します' }}
          </button>
          <section
            v-if="listeningDemoOpen"
            class="listening-demo"
            aria-live="polite"
          >
            <span>Listening Demo</span>
            <strong>どこで会いますか？</strong>
            <p class="listening-script">
              A: Let&apos;s meet at the library after school.<br>
              B: OK. See you there at four.
            </p>
            <fieldset :disabled="listeningDemoSubmitted">
              <legend class="sr-only">
                会話に合う答えを1つ選んでください
              </legend>
              <label
                v-for="option in listeningDemoOptions"
                :key="option.id"
                class="choice compact-choice"
                :class="{ selected: listeningDemoAnswer === option.id }"
              >
                <input
                  v-model="listeningDemoAnswer"
                  type="radio"
                  name="listening-demo"
                  :value="option.id"
                >
                <span>{{ option.text }}</span>
              </label>
            </fieldset>
            <button
              class="secondary-action"
              type="button"
              :disabled="!listeningDemoAnswer || listeningDemoSubmitted"
              @click="submitListeningDemo"
            >
              答えを確認します
            </button>
            <p
              v-if="listeningDemoSubmitted"
              class="listening-feedback"
              :class="{ correct: listeningDemoCorrect }"
            >
              {{ listeningDemoCorrect ? '正解です。library は「図書館」です。' : '惜しいです。library という場所の言葉を聞き取りましょう。' }}
            </p>
          </section>
        </article>
      </div>
    </section>

    <section class="demo-guide-fold">
      <button
        class="coming-soon-toggle"
        type="button"
        :aria-expanded="demoGuideOpen"
        @click="demoGuideOpen = !demoGuideOpen"
      >
        <span>デモ進行ガイド</span>
        <strong>{{ demoGuide.title }}</strong>
        <small>{{ demoGuideOpen ? '閉じる' : '開く' }}</small>
      </button>
      <div
        v-if="demoGuideOpen"
        class="demo-guide-body"
      >
        <div>
          <span>{{ demoGuide.step }}</span>
          <strong>{{ demoGuide.title }}</strong>
          <p>{{ demoGuide.detail }}</p>
        </div>
        <div class="demo-guide-script">
          <p>{{ demoGuide.action }}</p>
          <small>{{ demoGuide.talkTrack }}</small>
          <ul>
            <li
              v-for="checkpoint in demoGuide.checkpoints"
              :key="checkpoint"
            >
              {{ checkpoint }}
            </li>
          </ul>
        </div>
        <div class="demo-guide-metrics">
          <h3>標準デモの口径</h3>
          <article
            v-for="metric in demoMetrics"
            :key="metric.label"
          >
            <span>{{ metric.label }}</span>
            <strong>{{ metric.value }}</strong>
            <p>{{ metric.detail }}</p>
          </article>
        </div>
      </div>
    </section>

    <aside
      v-if="earnedReward && rewardCelebrationOpen"
      class="reward-celebration"
      role="status"
      aria-live="polite"
    >
      <div class="reward-burst">
        +
      </div>
      <div>
        <span>報酬を獲得しました</span>
        <strong>Quest が前に進みました</strong>
        <p>学習の結果が、XP・コイン・バッジに変わりました。</p>
        <div class="reward-summary">
          <span>+{{ earnedReward.xpAwarded }} XP</span>
          <span>+{{ earnedReward.activityCoinsAwarded }} コイン</span>
          <span
            v-for="badge in earnedReward.badgesAwarded"
            :key="badge"
          >
            {{ badgeLabels[badge] ?? badge }}
          </span>
        </div>
      </div>
      <button
        class="reward-close"
        type="button"
        aria-label="報酬のお知らせを閉じます"
        @click="closeRewardCelebration"
      >
        閉じる
      </button>
    </aside>

    <p
      v-if="message"
      class="status-note"
      role="status"
    >
      {{ message }}
    </p>
    <p
      v-if="error"
      class="field-error"
      role="alert"
    >
      {{ error }}
    </p>
  </section>
</template>
