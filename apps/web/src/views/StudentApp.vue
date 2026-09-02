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
  title: string
  description: string
  reward: string
  action: string
  status: 'done' | 'current' | 'locked'
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

const guardianReady = computed(() => props.capabilities?.guardianLinkStatus === 'verified')
const learnReady = computed(() => props.capabilities?.canLearn === true)
const voiceEnabled = computed(() => props.capabilities?.canUploadVoice === true)
const answered = computed(() => attempt.value?.items.every((item) => selected.value[item.itemId]) === true)
const masteryAverage = computed(() => {
  if (!props.knowledgeItems.length) return 0
  return Math.round((props.knowledgeItems.reduce((sum, item) => sum + item.masteryScore, 0) / props.knowledgeItems.length) * 100)
})
const questStep = computed(() => {
  const rawStep = gameState.value?.questStep ?? 0
  const badges = new Set(gameState.value?.badges ?? [])
  const earnedStep = badges.has('level_check_cleared') || badges.has('level_check_challenger') || props.knowledgeItems.length > 0
    ? 3
    : badges.has('guardian_shield') || (gameState.value?.totalXp ?? 0) >= 20
      ? 2
      : 0
  return Math.max(rawStep, earnedStep)
})
const questProgress = computed(() => Math.min(100, Math.round((questStep.value / questMapNodes.value.length) * 100)))
const badgeLabels: Record<string, string> = {
  guardian_shield: 'ガーディアンシールド',
  level_check_cleared: 'レベルチェッククリア',
  level_check_challenger: 'Quest チャレンジャー',
}
const questBlueprint = [
  {
    id: 'start',
    title: 'はじまりの港',
    description: '英検3級の冒険を始めます。',
    reward: 'スタート',
    action: 'デモを開始しました。',
  },
  {
    id: 'guardian',
    title: '家族の門',
    description: '保護者確認で安全に学習を解放します。',
    reward: '盾バッジ',
    action: '保護者に確認を依頼しましょう。',
  },
  {
    id: 'level-check',
    title: '力だめしの丘',
    description: 'レベルチェックで今の得意と復習を見つけます。',
    reward: 'XP + コイン',
    action: 'レベルチェックに挑戦しましょう。',
  },
  {
    id: 'review',
    title: '復習の森',
    description: '苦手な単元を短く復習します。',
    reward: '復習ルート',
    action: '復習予定を見て、短く確認しましょう。',
  },
  {
    id: 'next-island',
    title: '次の島',
    description: '次のステージへ進む準備をします。',
    reward: '近日公開',
    action: '次の冒険は準備中です。',
  },
] satisfies Array<Omit<QuestMapNode, 'status'>>
const questMapNodes = computed<QuestMapNode[]>(() => questBlueprint.map((node, index) => {
  const stepNumber = index + 1
  const status = questStep.value >= stepNumber ? 'done' : questStep.value === index ? 'current' : 'locked'
  return { ...node, status }
}))
const currentQuestNode = computed(() => questMapNodes.value.find((node) => node.status === 'current') ?? questMapNodes.value.at(-1)!)
const selectedQuestNode = computed(() => questMapNodes.value.find((node) => node.id === selectedQuestNodeId.value) ?? currentQuestNode.value)
const completedQuestCount = computed(() => questMapNodes.value.filter((node) => node.status === 'done').length)
const questStatusLabel = (status: QuestMapNode['status']) => {
  if (status === 'done') return '達成'
  if (status === 'current') return '次の目標'
  return 'ロック中'
}
const selectQuestNode = (node: QuestMapNode) => {
  selectedQuestNodeId.value = node.id
}
const closeRewardCelebration = () => {
  rewardCelebrationOpen.value = false
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
          <span><strong>{{ gameState?.totalXp ?? 0 }}</strong> XP</span>
          <span><strong>{{ gameState?.activityCoins ?? 0 }}</strong> コイン</span>
          <span><strong>{{ gameState?.questChapter ?? 0 }}</strong> 章</span>
        </div>
        <div class="quest-current">
          <span>現在の目標</span>
          <strong>{{ currentQuestNode.title }}</strong>
          <p>{{ currentQuestNode.action }}</p>
        </div>
        <ol
          class="quest-map"
          aria-label="Quest Map"
        >
          <li
            v-for="(node, index) in questMapNodes"
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
              <span class="quest-pin">{{ node.status === 'done' ? '✓' : index + 1 }}</span>
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
          v-if="gameState?.badges.length"
          class="badge-list"
        >
          <span
            v-for="badge in gameState.badges"
            :key="badge"
          >
            {{ badgeLabels[badge] ?? badge }}
          </span>
        </div>
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
