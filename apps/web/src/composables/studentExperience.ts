import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
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
import type { InjectionKey } from 'vue'

export type CapabilityState = {
  canLearn?: boolean
  canUploadVoice?: boolean
  voiceUploadMode?: string
  canPurchase?: boolean
  guardianLinkStatus?: string
  voiceConsentStatus?: string
}

export type StageQuestion = {
  itemId: string
  prompt: string
  support: string | null
  options: Array<{ optionId: string; text: string }>
}

export type StageAttempt = {
  attemptId: string
  items: StageQuestion[]
}

function isStageAttempt(value: unknown): value is StageAttempt {
  if (!value || typeof value !== 'object') return false
  const attempt = value as Partial<StageAttempt>
  return typeof attempt.attemptId === 'string' && Array.isArray(attempt.items)
}

export type KnowledgeItem = {
  knowledgePointRef: string
  masteryScore: number
  state: string
  dueAt: string | null
}

export type GameReward = {
  xpAwarded: number
  activityCoinsAwarded: number
  questStepDelta: number
  questChapterUnlocked: number | null
  badgesAwarded: string[]
}

export type GameState = {
  totalXp: number
  activityCoins: number
  questChapter: number
  questStep: number
  badges: string[]
}

export type QuestMapNode = {
  id: string
  islandId: string
  title: string
  description: string
  reward: string
  action: string
  status: 'done' | 'current' | 'locked'
}

export type QuestIsland = {
  id: string
  chapter: string
  title: string
  description: string
  status: 'done' | 'current' | 'locked'
  nodes: QuestMapNode[]
}

export type JourneySummary = {
  completedQuestCount: number
  totalQuestCount: number
  totalXp: number
  activityCoins: number
  masteryAverage: number
  highlights: string[]
  badges: string[]
  nextStep: string
}

export type InventoryItem = {
  id: string
  title: string
  detail: string
  status: 'collected' | 'locked'
}

export type DemoGuide = {
  step: string
  title: string
  detail: string
  action: string
  talkTrack: string
  checkpoints: string[]
}

export type DemoMetric = {
  label: string
  value: string
  detail: string
}

export interface StudentExperienceProps {
  session: DemoSessionResponse
  capabilities: CapabilityState | null
  invitationCode: string
  knowledgeItems: KnowledgeItem[]
}

export interface StudentExperienceEmit {
  (event: 'refresh'): void
  (event: 'invitationCreated', code: string): void
  (event: 'knowledgeUpdated', items: KnowledgeItem[]): void
  (event: 'journeyUpdated', summary: JourneySummary): void
}

// StudentApp.vue の <script setup> をそのまま移設したものです。ロジックは変更していません。
export function createStudentExperience(props: StudentExperienceProps, emit: StudentExperienceEmit) {
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
    level_check_challenger: 'チャレンジャー',
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
        talkTrack: '回答の自動入力を使うと、毎回同じ結果で説明できます。',
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
    message.value = '回答を入力しました。このまま提出できます。'
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
      if (!response.ok || !isStageAttempt(response.body)) throw new Error('stage attempt start failed')
      attempt.value = response.body
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
      const result = await fetchDemoStageAttemptResult(props.session.studentToken, attempt.value!.attemptId)
      if (!submitted.ok && !result.ok) throw new Error('stage attempt submit failed')
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

  // 端末登録は利用者の作業ではないため、画面に出さず背面で済ませます。
  // 失敗しても体験は続けられるので、エラーは表示しません。
  onMounted(async () => {
    try {
      const response = await registerDemoDevice(props.session.studentToken)
      if (response.ok) deviceReady.value = true
    } catch {
      // 端末登録は任意の補助機能のため、失敗しても何も表示しません。
    }
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
    targetPath: string | null
  }


  const nextMission = computed<Mission>(() => {
    if (attempt.value && !resultSummary.value) {
      return {
        id: 'submit-answers',
        step: '学習中',
        title: '答えを選んで提出します',
        detail: answered.value ? 'すべて選べました。提出できます。' : `${attempt.value.items.length} 問すべてに答えると提出できます。`,
        ctaLabel: answered.value ? '答えを提出します' : '問題を見ます',
        targetPath: '/level-check',
      }
    }
    if (!guardianReady.value && !props.invitationCode) {
      return {
        id: 'invite',
        step: 'はじめの準備',
        title: '保護者に確認を依頼します',
        detail: '未成年の方は、学習を始める前に保護者の確認が必要です。',
        ctaLabel: '招待コードを発行します',
        targetPath: null,
      }
    }
    if (!guardianReady.value) {
      return {
        id: 'await-guardian',
        step: 'はじめの準備',
        title: '保護者の確認を待っています',
        detail: '「保護者として体験」に切り替えて、招待コードを入力してください。',
        ctaLabel: null,
        targetPath: null,
      }
    }
    if (learnReady.value && !resultSummary.value) {
      return {
        id: 'level-check',
        step: '今日やること',
        title: 'レベルチェックを受けます',
        detail: '今の得意と、復習したいポイントを確認します。',
        ctaLabel: 'レベルチェックを開始します',
        targetPath: '/level-check',
      }
    }
    if (reviewQuestReady.value && !reviewQuestCompleted.value) {
      return {
        id: 'review',
        step: '今日やること',
        title: '今日の復習クエストに進みます',
        detail: 'レベルチェックで見つかった苦手ポイントを短く確認します。',
        ctaLabel: '復習クエストを始めます',
        targetPath: '/review',
      }
    }
    if (voiceEnabled.value && !voiceReady.value) {
      return {
        id: 'voice',
        step: '今日やること',
        title: '音声練習を試します',
        detail: '保護者の同意により、音声練習が利用できます。',
        ctaLabel: '音声練習を提出します',
        targetPath: null,
      }
    }
    if (!deviceReady.value) {
      return {
        id: 'device',
        step: '今日やること',
        title: 'この端末を登録します',
        detail: '次回もこの端末で続きから体験できるようにします。',
        ctaLabel: '端末を登録します',
        targetPath: null,
      }
    }
    return {
      id: 'done',
      step: '今日のまとめ',
      title: '今日の冒険は完了しました',
      detail: '保護者アプリに切り替えると、今日の学習成果を確認できます。',
      ctaLabel: null,
      targetPath: null,
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

  // 製品ではページが分かれているためルーター遷移します。
  // 単体テスト用ハーネスは1ツリーなのでルーターが無く、その場合はスクロールで代替します。
  const router = useRouter()
  const missionPanelIds: Record<string, string> = {
    '/level-check': 'level-check-panel',
    '/review': 'review-panel',
  }

  const goToMissionTarget = async (targetPath: string | null) => {
    if (!targetPath) return
    if (router) {
      if (router.currentRoute.value.path !== targetPath) await router.push(targetPath)
      return
    }
    const panelId = missionPanelIds[targetPath]
    if (panelId) document.getElementById(panelId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const runMission = async () => {
    const mission = nextMission.value
    switch (mission.id) {
      case 'submit-answers':
        if (answered.value) void submitLevelCheck()
        else await goToMissionTarget(mission.targetPath)
        return
      case 'invite':
        void createInvitation()
        return
      case 'level-check':
        await goToMissionTarget(mission.targetPath)
        void startLevelCheck()
        return
      case 'review':
        await goToMissionTarget(mission.targetPath)
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

  // SFC では props がテンプレートに自動公開されていたため、ページ側へ明示的に渡します。
  const knowledgeItems = computed(() => props.knowledgeItems)
  const session = computed(() => props.session)
  const invitationCode = computed(() => props.invitationCode)
  const capabilities = computed(() => props.capabilities)

  return {
    knowledgeItems,
    session,
    invitationCode,
    capabilities,
    demoStageExamId,
    busy,
    message,
    error,
    attempt,
    selected,
    resultSummary,
    gameState,
    voiceReady,
    deviceReady,
    selectedQuestNodeId,
    earnedReward,
    rewardCelebrationOpen,
    reviewQuestOpen,
    reviewQuestCompleted,
    reviewQuestReward,
    reviewReadAloudDone,
    reviewFocusRef,
    reviewRewriteText,
    nextIslandPreviewOpen,
    listeningDemoOpen,
    listeningDemoAnswer,
    listeningDemoSubmitted,
    listeningDemoReward,
    guardianReady,
    learnReady,
    voiceEnabled,
    answered,
    masteryAverage,
    reviewCompletionReward,
    listeningDemoCompletionReward,
    demoMetrics,
    questStep,
    questProgress,
    localRewards,
    displayedTotalXp,
    displayedActivityCoins,
    displayedBadges,
    inventoryItems,
    badgeInventoryItems,
    lockedInventoryHints,
    inventoryCollectionCount,
    badgeLabels,
    knowledgePointLabels,
    questBlueprint,
    questIslandBlueprint,
    questMapNodes,
    questIslands,
    currentQuestNode,
    selectedQuestNode,
    completedQuestCount,
    currentQuestIsland,
    reviewQuestItems,
    reviewQuestReady,
    reviewTaskProgress,
    reviewQuestCanComplete,
    nextIslandReady,
    listeningDemoOptions,
    demoAnswerTextByPrompt,
    listeningDemoCorrect,
    journeySummaryVisible,
    journeyHighlights,
    latestBadgeLabels,
    journeyNextStep,
    demoGuide,
    journeySummary,
    questStatusLabel,
    knowledgePointLabel,
    reviewStateLabel,
    selectQuestNode,
    fillDemoLevelCheckAnswers,
    closeRewardCelebration,
    startReviewQuest,
    completeReviewQuest,
    openNextIslandPreview,
    startListeningDemo,
    submitListeningDemo,
    hasRewardValue,
    rewardFromGameStateDelta,
    toUserMessage,
    runAction,
    refreshGameState,
    createInvitation,
    startLevelCheck,
    submitLevelCheck,
    prepareVoicePractice,
    registerDevice,
    nextMission,
    missionTrackIndex,
    missionStepIndex,
    missionBusy,
    goToMissionTarget,
    runMission,
    comingSoonOpen,
    demoGuideOpen,
  }
}

export type StudentExperience = ReturnType<typeof createStudentExperience>
export const studentExperienceKey: InjectionKey<StudentExperience> = Symbol('studentExperience')
