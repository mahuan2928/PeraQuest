<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { TrialQuestion } from '@peraquest/contracts'
import { submitTrialAnswer } from '../api/onboarding'

const props = defineProps<{
  studentId: string
  attemptId: string
  questionCount: number
  firstQuestion: TrialQuestion
}>()
const emit = defineEmits<{ complete: [score: number] }>()
const index = ref(0)
const current = ref<TrialQuestion>(props.firstQuestion)
const selected = ref('')
const submitted = ref(false)
const submitting = ref(false)
const answerError = ref('')
const correct = ref(false)
const correctAnswer = ref('')
const explanation = ref('')
const nextQuestion = ref<TrialQuestion | null>(null)
const finalScore = ref<number | null>(null)
const feedback = ref<HTMLElement | null>(null)
const progress = computed(() => ((index.value + 1) / props.questionCount) * 100)

async function submitAnswer() {
  if (!selected.value || submitted.value || submitting.value) return
  submitting.value = true
  answerError.value = ''
  try {
    const result = await submitTrialAnswer(props.studentId, props.attemptId, {
      questionId: current.value.id,
      answer: selected.value,
    })
    correct.value = result.correct
    correctAnswer.value = result.correctAnswer
    explanation.value = result.explanation
    nextQuestion.value = result.nextQuestion
    finalScore.value = result.score
    submitted.value = true
    await nextTick()
    feedback.value?.focus()
  } catch {
    answerError.value = '回答を送信できませんでした。選択内容はそのままです。もう一度お試しください。'
  } finally {
    submitting.value = false
  }
}

function next() {
  if (!nextQuestion.value) {
    emit('complete', finalScore.value ?? 0)
    return
  }
  current.value = nextQuestion.value
  index.value += 1
  selected.value = ''
  submitted.value = false
  correct.value = false
  correctAnswer.value = ''
  explanation.value = ''
  nextQuestion.value = null
  finalScore.value = null
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
        {{ index + 1 }} / {{ questionCount }}
      </p>
    </header>
    <div
      class="progress-track"
      role="progressbar"
      :aria-valuenow="index + 1"
      aria-valuemin="1"
      :aria-valuemax="questionCount"
      :aria-label="`問題 ${index + 1} / ${questionCount}`"
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
      <p
        v-if="answerError"
        role="alert"
        class="restriction-note"
      >
        {{ answerError }}
      </p>
      <div
        v-if="submitted"
        ref="feedback"
        class="feedback"
        :class="correct ? 'correct' : 'incorrect'"
        role="status"
        tabindex="-1"
      >
        <strong>{{ correct ? '正解！' : `正解は「${correctAnswer}」` }}</strong>
        <p>{{ explanation }}</p>
      </div>
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
        @click="next"
      >
        {{ nextQuestion ? '次の問題へ' : '結果を見る' }}
      </button>
    </article>
  </section>
</template>
