<script setup lang="ts">
defineProps<{ score: number; total: number }>()
</script>
<template>
  <section
    class="result-panel"
    aria-labelledby="result-title"
  >
    <div
      class="result-burst"
      aria-hidden="true"
    >
      ★
    </div>
    <p class="eyebrow">
      QUEST COMPLETE
    </p>
    <h1 id="result-title">
      はじめての冒険、<br>クリア！
    </h1>
    <p class="score">
      <strong>{{ score }}</strong><span>/ {{ total }} 問</span>
    </p>
    <p class="lead">
      この結果は保存されません。保護者の方との連携が完了すると、学習記録を残して続けられます。
    </p>
    <div class="next-step">
      <strong>次のステップ</strong><p>保護者の方に招待リンクを確認してもらいましょう。</p>
    </div>
  </section>
</template>
