<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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

const props = defineProps<{
  session: DemoSessionResponse
  invitationCode: string
  capabilities: CapabilityState | null
  knowledgeItems: KnowledgeItem[]
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
  if (!inputCode.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const response = await verifyDemoGuardian(props.session.guardianToken, inputCode.value)
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

function stateLabel(state: string) {
  if (state === 'mastered') return '安定しています'
  if (state === 'learning') return '伸びています'
  return '復習しましょう'
}

function badgeLabel(badge: string) {
  if (badge === 'guardian_shield') return 'ガーディアンシールド'
  if (badge === 'level_check_cleared') return 'レベルチェッククリア'
  if (badge === 'level_check_challenger') return 'Quest チャレンジャー'
  return badge
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
        <p>未契約です。正式なお支払い機能は準備中です。</p>
        <span class="plan-badge">近日公開</span>
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
          <div>
            <strong>{{ learningSummary.quest.totalXp }}</strong>
            <span>獲得 XP</span>
          </div>
          <div>
            <strong>{{ learningSummary.quest.activityCoins }}</strong>
            <span>コイン</span>
          </div>
        </div>

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
          <h3>Quest の成長</h3>
          <p>{{ learningSummary.quest.summary }}</p>
          <div
            v-if="learningSummary.quest.badges.length"
            class="badge-row"
          >
            <span
              v-for="badge in learningSummary.quest.badges"
              :key="badge"
              class="plan-badge"
            >
              {{ badgeLabel(badge) }}
            </span>
          </div>
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
                <h3>{{ item.knowledgePointRef }}</h3>
                <span
                  class="status-pill"
                  :class="item.state === 'mastered' ? 'status-pill--mastered' : item.state === 'learning' ? 'status-pill--in-progress' : 'status-pill--review'"
                >
                  {{ stateLabel(item.state) }}
                </span>
              </div>
              <div class="mastery-meter-row">
                <div
                  class="mastery-meter"
                  role="progressbar"
                  :aria-label="`${item.knowledgePointRef}の習熟度`"
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

    <section class="future-card">
      <h2>近日公開</h2>
      <p>正式なお支払い機能と Quest Map の拡張は準備中です。</p>
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
