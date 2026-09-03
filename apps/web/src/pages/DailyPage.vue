<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import { fetchDailyHint, fetchDailyPlan, startDailySession, submitDailyAnswer } from '../api/demoFlow'
import { studentExperienceKey } from '../composables/studentExperience'
import WordOrderItem from '../components/daily/WordOrderItem.vue'
import ArticleSensorItem from '../components/daily/ArticleSensorItem.vue'
import KatakanaHunterItem from '../components/daily/KatakanaHunterItem.vue'

type DailyItem = {
  contentItemId: string
  itemKind: 'word_order' | 'article' | 'katakana'
  knowledgePointRef: string
  isReview: boolean
  prompt: Record<string, unknown>
}
type DailySession = { sessionId: string; sessionDate: string; status: string; targetCount: number; completedCount: number; reviewCount: number }
type DailyPlan = { sessionDate: string; lives: number; maxLives: number; supportMode: boolean; nextLifeAt: string | null; reviewCap: number; session: DailySession | null }
type Feedback = { correct: boolean; timedOut: boolean; explanation: string }

const experience = inject(studentExperienceKey)!
const { session: demoSession, knowledgePointLabel } = experience

const plan = ref<DailyPlan | null>(null)
const items = ref<DailyItem[]>([])
const index = ref(0)
const feedback = ref<Feedback | null>(null)
const busy = ref(false)
const error = ref('')
const notAvailable = ref(false)
const hint = ref('')

const token = () => demoSession.value.studentToken
const current = computed(() => items.value[index.value] ?? null)
const finished = computed(() => items.value.length > 0 && index.value >= items.value.length)
const progress = computed(() => (items.value.length ? Math.round((index.value / items.value.length) * 100) : 0))
// 体力が尽きても学習は止めません。ヒントを出せる「ゆっくりモード」に切り替えます。
const supportMode = computed(() => plan.value?.supportMode === true)

const nextLifeLabel = computed(() => {
  if (!plan.value?.nextLifeAt) return ''
  const minutes = Math.max(0, Math.ceil((new Date(plan.value.nextLifeAt).getTime() - Date.now()) / 60000))
  return `つぎの回復まで約 ${minutes} 分`
})

async function loadPlan() {
  const response = await fetchDailyPlan(token())
  if (response.ok) plan.value = response.body as DailyPlan
}

async function begin() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  notAvailable.value = false
  try {
    const response = await startDailySession(token())
    if (response.status === 409) {
      // 公開済みの問題が足りないときは、空の関卡を作らずに理由を伝えます。
      notAvailable.value = true
      return
    }
    if (!response.ok) throw new Error('start failed')
    const body = response.body as { session: DailySession; items: DailyItem[] }
    items.value = body.items
    index.value = 0
    feedback.value = null
    await loadPlan()
  } catch {
    error.value = '今日の学習を開始できませんでした。通信環境を確認して、もう一度お試しください。'
  } finally {
    busy.value = false
  }
}

async function answer(response: string | string[] | null, timedOut = false) {
  const item = current.value
  if (!item || busy.value || feedback.value) return
  busy.value = true
  try {
    const result = await submitDailyAnswer(token(), plan.value!.session!.sessionId, {
      contentItemId: item.contentItemId,
      response,
      timedOut,
    })
    if (!result.ok) throw new Error('submit failed')
    const body = result.body as Feedback & { lives: number; session: DailySession }
    feedback.value = { correct: body.correct, timedOut: body.timedOut, explanation: body.explanation }
    const spent = plan.value !== null && body.lives < plan.value.lives
    if (plan.value) plan.value = { ...plan.value, lives: body.lives, session: body.session }
    // 生命値が減ったときだけ、回復予定時刻を取り直します
    // （採点の応答には次の回復時刻が含まれないため）。
    if (spent) await loadPlan()
  } catch {
    error.value = '答えを送れませんでした。もう一度お試しください。'
  } finally {
    busy.value = false
  }
}

async function showHint() {
  const item = current.value
  if (!item || busy.value) return
  busy.value = true
  try {
    const result = await fetchDailyHint(token(), plan.value!.session!.sessionId, item.contentItemId)
    if (result.ok) hint.value = (result.body as { hint: string }).hint
  } catch {
    // ヒントは補助なので、取れなくても学習は続けられます。
  } finally {
    busy.value = false
  }
}

function next() {
  hint.value = ''
  feedback.value = null
  index.value += 1
}

onMounted(async () => {
  await loadPlan()
  if (plan.value?.session) await begin()
})
</script>

<template>
  <section
    class="daily-page"
    aria-labelledby="daily-title"
  >
    <header class="daily-header">
      <div>
        <p class="card-kicker">
          学習
        </p>
        <h2 id="daily-title">
          今日の学習
        </h2>
      </div>
      <div
        class="daily-lives"
        :aria-label="`のこり ${plan?.lives ?? 5} / ${plan?.maxLives ?? 5}`"
      >
        <span
          v-for="n in (plan?.maxLives ?? 5)"
          :key="n"
          class="life"
          :class="{ spent: n > (plan?.lives ?? 5) }"
          aria-hidden="true"
        >♥</span>
        <small v-if="nextLifeLabel">{{ nextLifeLabel }}</small>
      </div>
    </header>

    <p
      v-if="notAvailable"
      class="panel-empty"
    >
      今日の問題はまだ準備中です。教研レビューが終わった問題から順に公開されます。
    </p>

    <p
      v-else-if="supportMode && !finished"
      class="support-mode-note"
      role="status"
    >
      ゆっくりモードにしました。あせらず、ヒントを見ながら進めましょう。{{ nextLifeLabel }}
    </p>

    <button
      v-if="!notAvailable && !items.length"
      class="primary-action"
      type="button"
      :disabled="busy"
      @click="begin"
    >
      今日の学習を始めます
    </button>

    <div
      v-else-if="finished"
      class="daily-done"
      aria-live="polite"
    >
      <strong>今日の学習を終えました</strong>
      <p>{{ items.length }} 問に取り組みました。明日はここに復習が並びます。</p>
    </div>

    <template v-else>
      <div
        class="quest-trail"
        role="progressbar"
        :aria-valuenow="index"
        aria-valuemin="0"
        :aria-valuemax="items.length"
      >
        <span :style="{ width: `${progress}%` }" />
      </div>
      <p class="daily-progress">
        {{ index + 1 }} / {{ items.length }} 問
        <span
          v-if="current?.isReview"
          class="daily-review-tag"
        >復習</span>
        <span class="daily-point">{{ knowledgePointLabel(current!.knowledgePointRef) }}</span>
      </p>

      <div
        v-if="supportMode && !feedback"
        class="daily-hint"
      >
        <button
          v-if="!hint"
          class="secondary-action"
          type="button"
          :disabled="busy"
          @click="showHint"
        >
          ヒントを見る
        </button>
        <p
          v-else
          aria-live="polite"
        >
          {{ hint }}
        </p>
      </div>

      <article class="daily-item">
        <WordOrderItem
          v-if="current!.itemKind === 'word_order'"
          :prompt="current!.prompt"
          :disabled="busy || Boolean(feedback)"
          @answer="answer"
        />
        <ArticleSensorItem
          v-else-if="current!.itemKind === 'article'"
          :prompt="current!.prompt"
          :disabled="busy || Boolean(feedback)"
          @answer="answer"
          @timeout="answer(null, true)"
        />
        <KatakanaHunterItem
          v-else
          :prompt="current!.prompt"
          :disabled="busy || Boolean(feedback)"
          @answer="answer"
        />
      </article>

      <section
        v-if="feedback"
        class="daily-feedback"
        :class="{ correct: feedback.correct, 'timed-out': feedback.timedOut }"
        aria-live="polite"
      >
        <strong>
          {{ feedback.timedOut ? '時間切れです' : feedback.correct ? '正解です' : 'おしいです' }}
        </strong>
        <p>{{ feedback.explanation }}</p>
        <button
          class="primary-action"
          type="button"
          @click="next"
        >
          {{ index + 1 >= items.length ? '結果を見ます' : 'つぎの問題へ' }}
        </button>
      </section>
    </template>

    <p
      v-if="error"
      class="field-error"
      role="alert"
    >
      {{ error }}
    </p>
  </section>
</template>
