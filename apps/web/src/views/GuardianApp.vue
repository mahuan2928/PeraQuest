<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
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

const props = defineProps<{
  session: DemoSessionResponse
  invitationCode: string
  capabilities: CapabilityState | null
  knowledgeItems: KnowledgeItem[]
}>()

const emit = defineEmits<{
  verified: []
  consentChanged: []
}>()

const inputCode = ref('')
const busy = ref(false)
const message = ref('')
const error = ref('')
const pendingConsent = ref(false)

const verified = computed(() => props.capabilities?.guardianLinkStatus === 'verified')
const voiceAllowed = computed(() => props.capabilities?.voiceConsentStatus === 'granted' && props.capabilities?.canUploadVoice === true)
const masteryAverage = computed(() => {
  if (!props.knowledgeItems.length) return 0
  return Math.round((props.knowledgeItems.reduce((sum, item) => sum + item.masteryScore, 0) / props.knowledgeItems.length) * 100)
})

watch(() => props.invitationCode, (value) => {
  if (value && !inputCode.value) inputCode.value = value
}, { immediate: true })

function friendlyError() {
  return '招待コードが正しくないか、有効期限が切れています。'
}

async function confirmInvitation() {
  if (!inputCode.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const response = await verifyDemoGuardian(props.session.guardianToken, inputCode.value)
    console.info('guardian verification result', response)
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

async function toggleConsent() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  pendingConsent.value = true
  try {
    const nextStatus = voiceAllowed.value ? 'withdrawn' : 'granted'
    const response = await setDemoVoiceConsent(props.session.guardianToken, props.session.studentId, nextStatus)
    console.info('voice consent result', response)
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
            学習状況
          </p>
          <h2>お子さまの学習状況</h2>
        </div>
        <div class="mini-mastery">
          <strong>{{ masteryAverage }}%</strong>
          <span>平均習熟度</span>
        </div>
      </div>
      <p v-if="!knowledgeItems.length">
        レベルチェックが終わると、復習が必要な項目がここに表示されます。
      </p>
      <ul
        v-else
        class="knowledge-list"
      >
        <li
          v-for="item in knowledgeItems"
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
    </section>

    <section class="future-card">
      <h2>近日公開</h2>
      <p>決済、ゲーム報酬、保護者向けレポートは正式な機能として準備中です。</p>
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
