<script setup lang="ts">
import type { TrialQuestion } from '@peraquest/contracts'
import { computed, nextTick, ref } from 'vue'
import { completeTrialSession, submitTrialAnswer } from '../api/onboarding'

const props = defineProps<{ questions: TrialQuestion[]; sessionId: string }>()
const emit = defineEmits<{ complete: [score: number] }>()
const index = ref(0)
const selected = ref('')
const submitted = ref(false)
const submitting = ref(false)
const answerCorrect = ref(false)
const correctAnswer = ref('')
const explanation = ref('')
const serviceError = ref('')
const feedback = ref<HTMLElement | null>(null)
const current = computed<TrialQuestion>(() => props.questions[index.value]!)
const progress = computed(() => ((index.value + 1) / props.questions.length) * 100)

async function submitAnswer() {
  if (!selected.value || submitted.value || submitting.value) return
  submitting.value = true
  serviceError.value = ''
  try {
    const result = await submitTrialAnswer(props.sessionId, { questionId: current.value.id, answer: selected.value })
    answerCorrect.value = result.correct
    correctAnswer.value = result.correctAnswer
    explanation.value = result.explanation
    submitted.value = true
    await nextTick()
    feedback.value?.focus()
  } catch {
    serviceError.value = '答えを送信できませんでした。回答はそのままです。もう一度お試しください。'
  } finally {
    submitting.value = false
  }
}

async function next() {
  if (index.value === props.questions.length - 1) {
    submitting.value = true
    serviceError.value = ''
    try {
      const result = await completeTrialSession(props.sessionId)
      emit('complete', result.score)
    } catch {
      serviceError.value = '結果を確定できませんでした。もう一度お試しください。'
    } finally {
      submitting.value = false
    }
    return
  }
  index.value += 1
  selected.value = ''
  submitted.value = false
  answerCorrect.value = false
  correctAnswer.value = ''
  explanation.value = ''
}
</script>

<template>
  <section
    class="lesson-panel"
    aria-labelledby="question-title"
  >
    <header class="lesson-header">
      <div>
        <p class="eyebrow">
          TRIAL QUEST
        </p><strong>英検3級 · おためし</strong>
      </div>
      <p aria-live="polite">
        {{ index + 1 }} / {{ questions.length }}
      </p>
    </header>
    <div
      class="progress-track"
      role="progressbar"
      :aria-valuenow="index + 1"
      aria-valuemin="1"
      :aria-valuemax="questions.length"
      :aria-label="`問題 ${index + 1} / ${questions.length}`"
    >
      <span :style="{ width: `${progress}%` }" />
    </div>

    <article class="question-card">
      <span class="ability-tag">{{ current.ability === 'grammar' ? '文法' : '単語' }}</span>
      <h1 id="question-title">
        {{ current.prompt }}
      </h1>
      <p class="question-support">
        {{ current.support }}
      </p>
      <fieldset :disabled="submitted || submitting">
        <legend class="sr-only">
          答えを1つ選んでください
        </legend>
        <label
          v-for="choice in current.choices"
          :key="choice"
          class="choice"
          :class="{ selected: selected === choice }"
        >
          <input
            v-model="selected"
            type="radio"
            name="answer"
            :value="choice"
          >
          <span>{{ choice }}</span>
        </label>
      </fieldset>

      <div
        v-if="submitted"
        ref="feedback"
        class="feedback"
        :class="answerCorrect ? 'correct' : 'incorrect'"
        role="status"
        tabindex="-1"
      >
        <strong>{{ answerCorrect ? '正解！' : `正解は「${correctAnswer}」` }}</strong>
        <p>{{ explanation }}</p>
      </div>
      <p
        v-if="serviceError"
        class="field-error"
        role="alert"
      >
        {{ serviceError }}
      </p>

      <button
        v-if="!submitted"
        class="primary-action"
        data-testid="submit-answer"
        type="button"
        :disabled="!selected || submitting"
        @click="submitAnswer"
      >
        {{ submitting ? '送信中…' : '答えを確認する' }}
      </button>
      <button
        v-else
        class="primary-action"
        data-testid="next-question"
        type="button"
        :disabled="submitting"
        @click="next"
      >
        {{ submitting ? '確認中…' : index === questions.length - 1 ? '結果を見る' : '次の問題へ' }}
      </button>
    </article>
  </section>
</template>
