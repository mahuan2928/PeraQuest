<script setup lang="ts">
import { computed, ref } from 'vue'

defineProps<{ submitting?: boolean; submitError?: string; demoSubmitting?: boolean; demoSlowStart?: boolean }>()
const emit = defineEmits<{ submit: [birthMonth: string], startDemo: [] }>()
const birthMonth = ref('')
const attempted = ref(false)
const maxMonth = new Date().toISOString().slice(0, 7)
const valid = computed(() => /^\d{4}-\d{2}$/.test(birthMonth.value) && birthMonth.value <= maxMonth)

function submit() {
  attempted.value = true
  if (valid.value) emit('submit', birthMonth.value)
}
</script>

<template>
  <section
    class="onboarding-panel"
    aria-labelledby="welcome-title"
  >
    <div
      class="quest-mark"
      aria-hidden="true"
    >
      Q
    </div>
    <p class="eyebrow">
      英検3級・学習アプリ
    </p>
    <h1 id="welcome-title">
      学習成果が、<br><span>冒険の進みになる。</span>
    </h1>
    <p class="lead">
      レベルチェック、復習クエスト、バッジ、保護者レポートまでをアプリでそのまま確認できます。
    </p>
    <div class="demo-promise">
      <strong>3分でわかること</strong>
      <ul>
        <li>生徒は冒険マップに沿って英検3級の学習を進めます。</li>
        <li>XP、コイン、バッジが冒険バッグに集まります。</li>
        <li>保護者は今日の学習成果と次のおすすめを確認できます。</li>
      </ul>
    </div>
    <div
      class="landing-value-grid"
      aria-label="PeraQuest の特徴"
    >
      <article>
        <span>生徒向け</span>
        <strong>続けたくなる学習</strong>
        <p>短い問題、復習クエスト、ごほうびで、毎日の英検3級学習を冒険に変えます。</p>
      </article>
      <article>
        <span>保護者向け</span>
        <strong>見守れるレポート</strong>
        <p>得意、復習ポイント、次のおすすめを親子で話しやすい言葉にまとめます。</p>
      </article>
      <article>
        <span>こんな方に</span>
        <strong>親子で始める英検準備</strong>
        <p>はじめて英検3級に挑戦する小中学生の、最初の習慣づくりに向いています。</p>
      </article>
    </div>
    <div
      class="trial-readiness-note"
      aria-label="安心して試せること"
    >
      <strong>安心して試せること</strong>
      <ul>
        <li>氏名・学校名・地域は入力しません。</li>
        <li>記録はいつでもリセットできます。</li>
        <li>お支払いは発生しません。</li>
      </ul>
    </div>
    <button
      class="primary-action demo-start-button"
      type="button"
      data-testid="start-product-demo"
      :disabled="demoSubmitting"
      @click="emit('startDemo')"
    >
      {{ demoSubmitting ? '準備しています…' : '無料ではじめる' }}
    </button>
    <p
      v-if="demoSubmitting"
      class="demo-start-note"
      role="status"
    >
      {{ demoSlowStart ? '起動しています。少し時間がかかる場合があります。' : 'アカウントを準備しています。' }}
    </p>

    <form
      class="birth-form"
      novalidate
      @submit.prevent="submit"
    >
      <div class="field-heading">
        <label for="birth-month">生まれた年月</label>
        <span>必須</span>
      </div>
      <input
        id="birth-month"
        v-model="birthMonth"
        data-testid="birth-month"
        type="month"
        :max="maxMonth"
        aria-describedby="birth-help birth-error"
        :aria-invalid="attempted && !valid"
      >
      <p
        id="birth-help"
        class="field-help"
      >
        年齢に合った安全な設定のために使います。氏名・学校名・地域は入力しません。
      </p>
      <p
        v-if="attempted && !valid"
        id="birth-error"
        class="field-error"
        role="alert"
      >
        正しい生年月を入力してください。
      </p>
      <button
        class="primary-action"
        data-testid="onboarding-submit"
        type="submit"
        :disabled="submitting"
      >
        {{ submitting ? '安全設定を確認中…' : '生年月から登録する' }} <span aria-hidden="true">→</span>
      </button>
      <p
        v-if="submitError"
        class="field-error"
        role="alert"
      >
        {{ submitError }}
      </p>
    </form>
    <p class="privacy-note">
      <span aria-hidden="true">●</span> 入力情報は安全設定の判定にのみ使用します
    </p>
  </section>
</template>
