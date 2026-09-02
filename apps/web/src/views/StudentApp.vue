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
    const knowledge = await fetchDemoStudentKnowledge(props.session.studentToken)
    if (knowledge.ok) emit('knowledgeUpdated', ((knowledge.body as { items?: KnowledgeItem[] }).items ?? []))
    await refreshGameState()
    const reward = resultSummary.value.rewards ?? rewardFromGameStateDelta(previousGameState, gameState.value)
    earnedReward.value = hasRewardValue(reward) ? reward : null
    rewardCelebrationOpen.value = Boolean(earnedReward.value)
    message.value = 'レベルチェックの結果を保存しました。Quest 進捗と復習予定を更新しました。'
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
</script>

<template>
  <section
    class="product-panel"
    aria-labelledby="student-app-title"
  >
    <header class="product-hero">
      <p class="eyebrow">
        生徒アプリ
      </p>
      <h1 id="student-app-title">
        今日の学習を始めます
      </h1>
      <p class="lead">
        保護者の確認、学習プラン、音声練習の準備が整うと、レベルチェックと復習が進められます。
      </p>
    </header>

    <ul class="safety-list">
      <li :class="{ done: guardianReady }">
        <span>{{ guardianReady ? '✓' : '1' }}</span>
        <div>
          <strong>保護者の確認</strong>
          <small>{{ guardianReady ? '保護者の確認が完了しました。' : '保護者の確認を待っています。' }}</small>
        </div>
      </li>
      <li :class="{ done: learnReady }">
        <span>{{ learnReady ? '✓' : '2' }}</span>
        <div>
          <strong>学習の解放</strong>
          <small>{{ learnReady ? 'レベルチェックを開始できます。' : '確認後に学習が解放されます。' }}</small>
        </div>
      </li>
      <li :class="{ done: voiceEnabled }">
        <span>{{ voiceEnabled ? '✓' : '3' }}</span>
        <div>
          <strong>音声練習</strong>
          <small>{{ voiceEnabled ? '音声練習を提出できます。' : '保護者の同意が必要です。' }}</small>
        </div>
      </li>
    </ul>

    <section class="student-grid">
      <article class="action-card quest-card">
        <p class="card-kicker">
          Quest
        </p>
        <h2>Quest Map</h2>
        <p>学習の成果が、冒険マップの進み具合に変わります。</p>
        <div class="quest-stats">
          <span><strong>{{ displayedTotalXp }}</strong> XP</span>
          <span><strong>{{ displayedActivityCoins }}</strong> コイン</span>
          <span><strong>{{ gameState?.questChapter ?? 0 }}</strong> 章</span>
        </div>
        <div class="quest-current">
          <span>現在の目標</span>
          <strong>{{ currentQuestIsland.title }} · {{ currentQuestNode.title }}</strong>
          <p>{{ currentQuestNode.action }}</p>
        </div>
        <div class="quest-island-overview">
          <span>{{ currentQuestIsland.chapter }}</span>
          <strong>{{ currentQuestIsland.title }}</strong>
          <p>{{ currentQuestIsland.description }}</p>
        </div>
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
              <small>{{ island.description }}</small>
            </div>
            <ol class="quest-island-nodes">
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
          class="quest-detail"
          aria-live="polite"
        >
          <span>スポット詳細</span>
          <strong>{{ selectedQuestNode.title }}</strong>
          <p>{{ selectedQuestNode.description }}</p>
          <em>{{ selectedQuestNode.action }}</em>
        </section>
        <div class="quest-trail">
          <span :style="{ width: `${questProgress}%` }" />
        </div>
        <p class="quest-step">
          {{ completedQuestCount }} / {{ questMapNodes.length }} スポット達成
        </p>
        <div
          v-if="displayedBadges.length"
          class="badge-list"
        >
          <span
            v-for="badge in displayedBadges"
            :key="badge"
          >
            {{ badgeLabels[badge] ?? badge }}
          </span>
        </div>
      </article>

      <article class="action-card inventory-card">
        <p class="card-kicker">
          Collection
        </p>
        <h2>冒険バッグ</h2>
        <p>学習で集めた XP、コイン、バッジをここにしまっておきます。</p>
        <div class="inventory-count">
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

      <article class="action-card">
        <p class="card-kicker">
          家族連携
        </p>
        <h2>保護者に確認を依頼します</h2>
        <p>保護者アプリで入力する招待コードを発行します。</p>
        <button
          class="primary-action"
          type="button"
          :disabled="busy || Boolean(invitationCode)"
          @click="createInvitation"
        >
          {{ invitationCode ? '招待コードを発行済みです' : '招待コードを発行します' }}
        </button>
        <p
          v-if="invitationCode"
          class="invitation-code"
        >
          {{ invitationCode }}
        </p>
      </article>

      <article class="action-card">
        <p class="card-kicker">
          学習プラン
        </p>
        <h2>学習プラン</h2>
        <p>正式なお支払い機能は準備中です。現在の体験では、保護者確認後にレベルチェックへ進めます。</p>
        <span class="plan-badge">近日公開</span>
      </article>

      <article class="action-card next-island-card">
        <p class="card-kicker">
          次の冒険
        </p>
        <h2>次の島プレビュー</h2>
        <p>{{ nextIslandReady ? '復習の森を越えました。次のステージの予告を確認できます。' : '復習クエストを完了すると、次の島の予告が開きます。' }}</p>
        <div class="next-island-lock">
          <span>{{ nextIslandReady ? '解放済み' : '解放条件' }}</span>
          <strong>{{ nextIslandReady ? '新しい島への航路を確認できます' : '復習の森をクリアしましょう' }}</strong>
        </div>
        <button
          class="primary-action"
          type="button"
          :disabled="!nextIslandReady"
          @click="openNextIslandPreview"
        >
          {{ nextIslandReady ? '次の島をプレビューします' : '復習後にプレビューできます' }}
        </button>
        <section
          v-if="nextIslandPreviewOpen"
          class="next-island-preview"
          aria-live="polite"
        >
          <span>Coming Soon</span>
          <strong>リスニング入り江</strong>
          <p>短い会話を聞き取り、時間・理由・気持ちを選ぶ新しい冒険です。</p>
          <ul>
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
        </section>
      </article>
    </section>

    <section
      v-if="journeySummaryVisible"
      class="journey-summary-card"
      aria-label="学習旅程サマリー"
    >
      <p class="card-kicker">
        Journey Summary
      </p>
      <h2>今日の冒険まとめ</h2>
      <p>今日の学習で進んだ場所と、次に向かうルートをまとめました。</p>
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

    <section class="lesson-panel">
      <header class="lesson-header">
        <div>
          <p class="eyebrow">
            レベルチェック
          </p>
          <strong>英検3級 · レベルチェック</strong>
        </div>
        <p>{{ attempt ? `${attempt.items.length} 問` : '未開始' }}</p>
      </header>
      <button
        v-if="!attempt"
        class="primary-action"
        type="button"
        :disabled="busy || !learnReady"
        @click="startLevelCheck"
      >
        レベルチェックを開始します
      </button>

      <article
        v-else-if="!resultSummary"
        class="question-card"
      >
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

    <section class="student-grid">
      <article class="action-card">
        <p class="card-kicker">
          音声練習
        </p>
        <h2>音声練習</h2>
        <p>{{ voiceEnabled ? '保護者の同意により利用できます。' : '現在は利用できません。' }}</p>
        <button
          class="primary-action"
          type="button"
          :disabled="busy || !voiceEnabled || voiceReady"
          @click="prepareVoicePractice"
        >
          {{ voiceReady ? '提出準備が完了しました' : '音声練習を提出します' }}
        </button>
      </article>

      <article class="action-card">
        <p class="card-kicker">
          復習予定
        </p>
        <h2>復習予定</h2>
        <p>{{ knowledgeItems.length ? `${knowledgeItems.length} 件の復習予定があります。` : 'レベルチェック後に復習予定が表示されます。' }}</p>
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
          class="primary-action"
          type="button"
          :disabled="!reviewQuestReady"
          @click="startReviewQuest"
        >
          {{ reviewQuestReady ? '復習クエストを始めます' : 'レベルチェック後に始められます' }}
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

      <article class="action-card">
        <p class="card-kicker">
          端末設定
        </p>
        <h2>端末設定</h2>
        <p>{{ deviceReady ? '端末登録が完了しました。' : 'この端末で続きから体験できます。' }}</p>
        <button
          class="primary-action"
          type="button"
          :disabled="busy || deviceReady"
          @click="registerDevice"
        >
          {{ deviceReady ? '登録済みです' : '端末を登録します' }}
        </button>
      </article>
    </section>

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
