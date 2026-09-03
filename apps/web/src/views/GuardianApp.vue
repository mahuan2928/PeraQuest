<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { knowledgePointLabel } from '../data/knowledgeLabels'
import {
  fetchDemoGuardianLearningSummary,
  fetchDemoGuardianStudentKnowledge,
  setDemoVoiceConsent,
  verifyDemoGuardian,
  type DemoSessionResponse,
} from '../api/demoFlow'

type CapabilityState = {
  canUploadVoice?: boolean
  guardianLinkStatus?: string
  voiceConsentStatus?: string
}

type KnowledgeItem = {
  knowledgePointRef: string
  masteryScore: number
  state: string
  dueAt: string | null
}

type SummaryItem = {
  knowledgePointRef: string
  label: string
  masteryPercent: number
  state: string
}

type LearningSummary = {
  overview: {
    headline: string
    weeklyActivityLabel: string
    averageMasteryPercent: number
    reviewItemCount: number
    masteredItemCount: number
  }
  strengths: SummaryItem[]
  reviewFocus: SummaryItem[]
  quest: {
    totalXp: number
    activityCoins: number
    questChapter: number
    questStep: number
    badges: string[]
    summary: string
  }
  nextRecommendation: string
}

type StudentJourneySummary = {
  completedQuestCount: number
  totalQuestCount: number
  totalXp: number
  activityCoins: number
  masteryAverage: number
  highlights: string[]
  badges: string[]
  nextStep: string
}

type GuardianSupportMemo = {
  progress: string
  focus: string
  encouragement: string
}

const props = defineProps<{
  session: DemoSessionResponse
  invitationCode: string
  capabilities: CapabilityState | null
  knowledgeItems: KnowledgeItem[]
  studentJourneySummary: StudentJourneySummary | null
  reportRefreshKey: number
}>()

const emit = defineEmits<{
  verified: []
  consentChanged: []
  knowledgeUpdated: [items: KnowledgeItem[]]
}>()

const inputCode = ref('')
const busy = ref(false)
const message = ref('')
const error = ref('')
const pendingConsent = ref(false)
const pendingKnowledge = ref(false)
const pendingSummary = ref(false)
const guardianKnowledgeItems = ref<KnowledgeItem[]>([])
const learningSummary = ref<LearningSummary | null>(null)

const verified = computed(() => props.capabilities?.guardianLinkStatus === 'verified')
const voiceAllowed = computed(() => props.capabilities?.voiceConsentStatus === 'granted' && props.capabilities?.canUploadVoice === true)
const displayKnowledgeItems = computed(() => guardianKnowledgeItems.value.length ? guardianKnowledgeItems.value : props.knowledgeItems)
const masteryAverage = computed(() => {
  if (!displayKnowledgeItems.value.length) return 0
  return Math.round((displayKnowledgeItems.value.reduce((sum, item) => sum + item.masteryScore, 0) / displayKnowledgeItems.value.length) * 100)
})
const guardianJourneySummary = computed<StudentJourneySummary | null>(() => {
  if (props.studentJourneySummary) return props.studentJourneySummary
  if (!learningSummary.value) return null
  const badges = learningSummary.value.quest.badges
  const completedQuestCount = Math.min(5, learningSummary.value.quest.questStep)
  const highlights = [
    badges.includes('guardian_shield') ? '保護者確認が完了しました' : '',
    badges.includes('level_check_cleared') || badges.includes('level_check_challenger') || learningSummary.value.overview.masteredItemCount > 0
      ? 'レベルチェックを完了しました'
      : '',
    badges.includes('review_forest_cleared') ? '復習の森をクリアしました' : '',
    badges.includes('listening_cove_trial') ? 'リスニング入り江を体験しました' : '',
  ].filter(Boolean)
  const nextStep = badges.includes('listening_cove_trial')
    ? '次は、リスニング入り江の本編公開に向けて短い会話を続けましょう。'
    : completedQuestCount >= 4
      ? '次は、リスニング入り江の1問体験に進みましょう。'
      : completedQuestCount >= 3
        ? '次は、復習の森で苦手ポイントを短く確認しましょう。'
        : learningSummary.value.nextRecommendation
  return {
    completedQuestCount,
    totalQuestCount: 5,
    totalXp: learningSummary.value.quest.totalXp,
    activityCoins: learningSummary.value.quest.activityCoins,
    masteryAverage: learningSummary.value.overview.averageMasteryPercent,
    highlights,
    badges,
    nextStep,
  }
})
const guardianSupportMemo = computed<GuardianSupportMemo | null>(() => {
  const journey = guardianJourneySummary.value
  if (!journey && !learningSummary.value) return null
  const reviewFocus = learningSummary.value?.reviewFocus[0]?.label
  // 保護者には学習の中身を伝えます。クエストの進行度は生徒側だけの指標です。
  const progress = journey
    ? `平均の定着率は ${journey.masteryAverage}% です。`
    : learningSummary.value?.quest.summary ?? '今日の学習状況を確認しています。'
  const focus = reviewFocus
    ? `次は「${reviewFocus}」を短く復習すると効果的です。`
    : journey?.nextStep ?? learningSummary.value?.nextRecommendation ?? '次のおすすめを確認しましょう。'
  const encouragement = journey?.badges.length
    ? '「今日はどこが分かるようになった？」と聞いて、次の一歩を一緒に確認しましょう。'
    : '「まずは始められたね」と声をかけて、安心して続けられる雰囲気を作りましょう。'
  return { progress, focus, encouragement }
})

watch(() => props.invitationCode, (value) => {
  if (value && !inputCode.value) inputCode.value = value
}, { immediate: true })

watch(verified, (value) => {
  if (value) void refreshGuardianReport()
}, { immediate: true })

watch(() => props.reportRefreshKey, (value) => {
  if (value > 0 && verified.value) void refreshGuardianReport()
})

function friendlyError() {
  return '招待コードが正しくないか、有効期限が切れています。'
}

async function confirmInvitation() {
  if (!inputCode.value.trim() || busy.value) return
  busy.value = true
  error.value = ''
  try {
    // 画面では読みやすさのため4文字ごとに区切って表示しているため、
    // 空白を取り除いてから照合します。
    const normalizedCode = inputCode.value.replace(/\s+/g, '')
    const response = await verifyDemoGuardian(props.session.guardianToken, normalizedCode)
    if (!response.ok) {
      error.value = friendlyError()
      return
    }
    message.value = 'お子さまとの連携が完了しました。'
    emit('verified')
  } catch (caught) {
    console.error(caught)
    error.value = friendlyError()
  } finally {
    busy.value = false
  }
}

async function refreshKnowledge() {
  if (!verified.value || pendingKnowledge.value) return
  pendingKnowledge.value = true
  try {
    const response = await fetchDemoGuardianStudentKnowledge(props.session.guardianToken, props.session.studentId)
    if (!response.ok) {
      error.value = '学習状況を更新できませんでした。'
      return
    }
    const body = response.body as { items?: KnowledgeItem[] }
    guardianKnowledgeItems.value = body.items ?? []
    emit('knowledgeUpdated', guardianKnowledgeItems.value)
  } catch (caught) {
    console.error(caught)
    error.value = '学習状況を更新できませんでした。'
  } finally {
    pendingKnowledge.value = false
  }
}

async function refreshLearningSummary() {
  if (!verified.value || pendingSummary.value) return
  pendingSummary.value = true
  try {
    const response = await fetchDemoGuardianLearningSummary(props.session.guardianToken, props.session.studentId)
    if (!response.ok) {
      error.value = '学習レポートを更新できませんでした。'
      return
    }
    learningSummary.value = response.body as LearningSummary
  } catch (caught) {
    console.error(caught)
    error.value = '学習レポートを更新できませんでした。'
  } finally {
    pendingSummary.value = false
  }
}

async function refreshGuardianReport() {
  if (!verified.value) return
  await Promise.all([refreshKnowledge(), refreshLearningSummary()])
}

async function toggleConsent() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  pendingConsent.value = true
  try {
    const nextStatus = voiceAllowed.value ? 'withdrawn' : 'granted'
    const response = await setDemoVoiceConsent(props.session.guardianToken, props.session.studentId, nextStatus)
    if (!response.ok) {
      error.value = verified.value ? '音声練習の設定を更新できませんでした。' : '保護者確認が完了すると、音声練習を許可できます。'
      return
    }
    message.value = nextStatus === 'granted' ? '音声練習を許可しました。' : '音声練習の同意を停止しました。'
    emit('consentChanged')
  } catch (caught) {
    console.error(caught)
    error.value = '音声練習の設定を更新できませんでした。'
  } finally {
    pendingConsent.value = false
    busy.value = false
  }
}

function stateLabel(state: string, masteryScore: number) {
  if (state === 'mastered') return '安定しています'
  // 一度も正解していない項目を「伸びています」と伝えると、
  // 保護者が支払いを判断する材料として誤解を招きます。
  if (state === 'learning') return masteryScore > 0 ? '伸びています' : 'これから伸ばすところ'
  return '復習しましょう'
}

</script>

<template>
  <section
    class="product-panel guardian-app"
    aria-labelledby="guardian-app-title"
  >
    <header class="product-hero">
      <p class="eyebrow">
        保護者アプリ
      </p>
      <h1 id="guardian-app-title">
        お子さまの学習を見守ります
      </h1>
      <p class="lead">
        招待コードで連携し、音声練習の同意と学習状況を確認できます。
      </p>
    </header>

    <section class="guardian-card">
      <h2>招待コードを入力します</h2>
      <p>お子さまの画面に表示された招待コードを入力してください。</p>
      <div class="guardian-form">
        <label for="guardian-code">招待コード</label>
        <input
          id="guardian-code"
          v-model="inputCode"
          type="text"
          autocomplete="off"
          :disabled="busy || verified"
        >
        <button
          class="primary-action"
          type="button"
          :disabled="busy || verified || !inputCode"
          @click="confirmInvitation"
        >
          {{ verified ? '連携済みです' : '連携を確認します' }}
        </button>
      </div>
      <p
        v-if="verified"
        class="status-note"
      >
        お子さまとの連携が完了しました。
      </p>
    </section>

    <section class="guardian-grid">
      <article class="guardian-card">
        <h2>音声練習の同意</h2>
        <p>{{ voiceAllowed ? '音声練習を利用できます。' : '音声練習は停止中です。' }}</p>
        <button
          class="toggle-button"
          type="button"
          :class="{ active: voiceAllowed }"
          :disabled="busy"
          @click="toggleConsent"
        >
          {{ pendingConsent ? '更新中です…' : voiceAllowed ? '同意を停止します' : '同意します' }}
        </button>
      </article>

      <article class="guardian-card">
        <h2>学習プラン</h2>
        <p>現在は無料でご利用いただけます。</p>
        <span class="plan-badge">無料プラン</span>
      </article>
    </section>

    <section class="guardian-card">
      <div class="mastery-heading">
        <div>
          <p class="eyebrow">
            学習レポート
          </p>
          <h2>今週の学習まとめ</h2>
        </div>
        <button
          class="secondary-action"
          type="button"
          :disabled="!verified || pendingKnowledge || pendingSummary"
          @click="refreshGuardianReport"
        >
          {{ pendingKnowledge || pendingSummary ? '更新しています…' : '最新のレポートを表示します' }}
        </button>
        <div class="mini-mastery">
          <strong>{{ learningSummary?.overview.averageMasteryPercent ?? masteryAverage }}%</strong>
          <span>平均習熟度</span>
        </div>
      </div>
      <p v-if="!learningSummary && !displayKnowledgeItems.length">
        レベルチェックが終わると、復習が必要な項目がここに表示されます。
      </p>
      <div
        v-else
        class="guardian-report"
      >
        <article class="report-highlight">
          <h3>今週のまとめ</h3>
          <p>{{ learningSummary?.overview.headline ?? '学習記録をもとに、得意なところと復習ポイントを整理しています。' }}</p>
          <span>{{ learningSummary?.overview.weeklyActivityLabel ?? `${displayKnowledgeItems.length}項目の学習記録が更新されています。` }}</span>
        </article>

        <div
          v-if="learningSummary"
          class="report-stat-grid"
        >
          <div>
            <strong>{{ learningSummary.overview.masteredItemCount }}</strong>
            <span>安定している項目</span>
          </div>
          <div>
            <strong>{{ learningSummary.overview.reviewItemCount }}</strong>
            <span>復習したい項目</span>
          </div>
        </div>

        <section
          v-if="guardianJourneySummary"
          class="guardian-journey-card"
          aria-label="お子さまの冒険まとめ"
        >
          <p class="card-kicker">
            学習レポート
          </p>
          <h3>お子さまの学習まとめ</h3>
          <p>今日どこまで進み、何が身についたかをまとめました。</p>
          <div class="guardian-journey-grid">
            <div>
              <strong>{{ guardianJourneySummary.masteryAverage }}%</strong>
              <span>平均習熟度</span>
            </div>
          </div>
          <ul class="guardian-journey-list">
            <li
              v-for="highlight in guardianJourneySummary.highlights"
              :key="highlight"
            >
              {{ highlight }}
            </li>
          </ul>
          <p class="guardian-journey-next">
            {{ guardianJourneySummary.nextStep }}
          </p>
        </section>

        <section
          v-if="guardianSupportMemo"
          class="guardian-support-memo"
          aria-label="家庭サポートメモ"
        >
          <p class="card-kicker">
            Family Support
          </p>
          <h3>家庭サポートメモ</h3>
          <ul>
            <li>
              <span>今日の成果</span>
              <strong>{{ guardianSupportMemo.progress }}</strong>
            </li>
            <li>
              <span>次のおすすめ</span>
              <strong>{{ guardianSupportMemo.focus }}</strong>
            </li>
            <li>
              <span>声かけ例</span>
              <strong>{{ guardianSupportMemo.encouragement }}</strong>
            </li>
          </ul>
        </section>

        <section
          v-if="learningSummary"
          class="report-section"
        >
          <h3>得意なところ</h3>
          <p v-if="!learningSummary.strengths.length">
            レベルチェック後に、得意な項目を表示します。
          </p>
          <ul
            v-else
            class="summary-list"
          >
            <li
              v-for="item in learningSummary.strengths"
              :key="`strength-${item.knowledgePointRef}`"
            >
              <span>{{ item.label }}</span>
              <strong>{{ item.masteryPercent }}%</strong>
            </li>
          </ul>
        </section>

        <section
          v-if="learningSummary"
          class="report-section"
        >
          <h3>これから復習するところ</h3>
          <p v-if="!learningSummary.reviewFocus.length">
            すぐに復習が必要な項目はありません。
          </p>
          <ul
            v-else
            class="summary-list"
          >
            <li
              v-for="item in learningSummary.reviewFocus"
              :key="`review-${item.knowledgePointRef}`"
            >
              <span>{{ item.label }}</span>
              <strong>{{ item.masteryPercent }}%</strong>
            </li>
          </ul>
        </section>

        
        <section
          v-if="learningSummary"
          class="report-section"
        >
          <h3>次におすすめすること</h3>
          <p>{{ learningSummary.nextRecommendation }}</p>
        </section>

        <ul
          v-if="!learningSummary"
          class="knowledge-list"
        >
          <li
            v-for="item in displayKnowledgeItems"
            :key="item.knowledgePointRef"
            class="knowledge-item"
          >
            <div class="knowledge-item__main">
              <div class="knowledge-item__title-row">
                <h3>{{ knowledgePointLabel(item.knowledgePointRef) }}</h3>
                <span
                  class="status-pill"
                  :class="item.state === 'mastered' ? 'status-pill--mastered' : item.state === 'learning' ? 'status-pill--in-progress' : 'status-pill--review'"
                >
                  {{ stateLabel(item.state, item.masteryScore) }}
                </span>
              </div>
              <div class="mastery-meter-row">
                <div
                  class="mastery-meter"
                  role="progressbar"
                  :aria-label="`${knowledgePointLabel(item.knowledgePointRef)}の習熟度`"
                  :aria-valuenow="Math.round(item.masteryScore * 100)"
                  aria-valuemin="0"
                  aria-valuemax="100"
                >
                  <span :style="{ width: `${Math.round(item.masteryScore * 100)}%` }" />
                </div>
                <strong>{{ Math.round(item.masteryScore * 100) }}%</strong>
              </div>
            </div>
          </li>
        </ul>
      </div>
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
