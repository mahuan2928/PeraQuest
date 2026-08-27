<script setup lang="ts">
defineProps<{
  trialRedeemed: boolean
  trialPending?: boolean
  trialError?: string
  trialStatus?: 'idle' | 'loading' | 'error' | 'expired' | 'complete'
}>()
const emit = defineEmits<{ startTrial: [] }>()
</script>

<template>
  <section
    class="guardian-panel"
    aria-labelledby="guardian-title"
  >
    <div
      class="status-orbit"
      aria-hidden="true"
    >
      <span>✓</span>
    </div>
    <p class="eyebrow">
      SAFETY CHECK
    </p>
    <h1 id="guardian-title">
      保護者の方との<br>連携を待っています
    </h1>
    <p class="lead">
      あなたの学習記録と音声を安全に守るため、保護者の方の確認が必要です。
    </p>

    <ol
      class="safety-list"
      aria-label="保護者連携の状況"
    >
      <li class="done">
        <span aria-hidden="true">1</span><div><strong>年齢に合った設定</strong><small>安全モードを有効にしました</small></div>
      </li>
      <li><span aria-hidden="true">2</span><div><strong>保護者と連携</strong><small>招待リンクから確認してもらいましょう</small></div></li>
      <li><span aria-hidden="true">3</span><div><strong>すべての冒険を解放</strong><small>学習記録・AI面接・レポート</small></div></li>
    </ol>

    <div class="trial-card">
      <div>
        <p class="card-kicker">
          待っている間に
        </p><h2>英検3級 おためしクエスト</h2><p>記録を残さず、12問だけ体験できます。</p>
      </div>
      <button
        class="primary-action"
        data-testid="start-trial"
        type="button"
        :disabled="trialRedeemed || trialPending"
        @click="emit('startTrial')"
      >
        {{ trialStatus === 'expired' || trialRedeemed ? 'おためし済みです' : trialPending ? '確認中…' : trialStatus === 'error' ? 'もう一度試す' : '1回だけ体験する' }}
      </button>
    </div>
    <p
      v-if="trialError"
      class="field-error"
      role="alert"
      aria-live="assertive"
    >
      {{ trialError }}
    </p>
    <p
      v-if="trialStatus === 'loading'"
      class="status-note"
      role="status"
      aria-live="polite"
    >
      安全な接続を確認しています。
    </p>
    <p
      v-if="trialRedeemed || trialStatus === 'expired'"
      class="redeemed-note"
      role="status"
    >
      このアカウントのおためしクエストは完了しています。保護者連携後に続きから学べます。
    </p>
    <p class="restriction-note">
      保護者連携までは、音声アップロード・購入・長期学習記録は利用できません。
    </p>
  </section>
</template>
