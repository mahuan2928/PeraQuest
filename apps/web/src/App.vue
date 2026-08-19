<script setup lang="ts">
import { computed, ref } from 'vue'
const consentReady = ref(false)
const statusLabel = computed(() => consentReady.value ? '音声機能の準備完了' : '保護者の同意が必要です')
</script>
<template>
  <main class="shell">
    <p class="eyebrow">
      LINGOQUEST JP · MVP
    </p><h1>英検3級を、毎日の小さな冒険に。</h1><p class="lead">
      学習、AI面接練習、保護者レポートを一つの安全な流れにまとめます。
    </p><section
      aria-labelledby="status-heading"
      class="status-card"
    >
      <h2 id="status-heading">
        開発ステータス
      </h2><p>{{ statusLabel }}</p><button
        type="button"
        @click="consentReady = !consentReady"
      >
        デモ状態を切り替える
      </button>
    </section>
  </main>
</template>
