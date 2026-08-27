<script setup lang="ts">
import { knowledgeGroups } from '../data/knowledge'
</script>

<template>
  <section
    class="mastery-panel"
    aria-labelledby="mastery-title"
  >
    <header class="mastery-header">
      <div>
        <p class="eyebrow">
          MY KNOWLEDGE
        </p>
        <h1 id="mastery-title">
          知識マップ
        </h1>
        <p class="mastery-lead">
          学んだことの今の手応えを見て、次の練習を選びましょう。
        </p>
        <p
          class="demo-notice"
          data-testid="mastery-demo-notice"
        >
          <strong>DEMO ONLY</strong> 表示中の掌握度はサンプルです。実際の学習データではありません。
        </p>
      </div>
      <div
        class="mastery-summary"
        aria-label="全体の掌握度"
      >
        <strong>68%</strong>
        <span>全体の掌握度</span>
      </div>
    </header>

    <div
      class="mastery-legend"
      aria-label="掌握度の見方"
    >
      <span><i
        class="legend-dot legend-dot--strong"
        aria-hidden="true"
      />安定している</span>
      <span><i
        class="legend-dot legend-dot--growing"
        aria-hidden="true"
      />伸びている</span>
      <span><i
        class="legend-dot legend-dot--review"
        aria-hidden="true"
      />もう一度</span>
    </div>

    <div class="knowledge-groups">
      <article
        v-for="group in knowledgeGroups"
        :key="group.id"
        class="knowledge-group"
      >
        <div class="group-heading">
          <div>
            <p class="group-kicker">
              KNOWLEDGE SET
            </p>
            <h2>{{ group.title }}</h2>
            <p>{{ group.description }}</p>
          </div>
          <span class="group-count">{{ group.points.length }}項目</span>
        </div>

        <ul class="knowledge-list">
          <li
            v-for="point in group.points"
            :key="point.id"
            class="knowledge-item"
          >
            <div class="knowledge-item__main">
              <div class="knowledge-item__title-row">
                <h3>{{ point.title }}</h3>
                <span
                  class="status-pill"
                  :class="`status-pill--${point.status}`"
                >
                  {{ point.statusLabel }}
                </span>
              </div>
              <p>{{ point.summary }}</p>
              <div class="mastery-meter-row">
                <div
                  class="mastery-meter"
                  role="progressbar"
                  :aria-label="`${point.title}の掌握度`"
                  :aria-valuenow="point.mastery"
                  aria-valuemin="0"
                  aria-valuemax="100"
                >
                  <span :style="{ width: `${point.mastery}%` }" />
                </div>
                <strong>{{ point.mastery }}%</strong>
              </div>
              <p class="last-practiced">
                最近の練習：{{ point.lastPracticed }}
              </p>
            </div>
            <button
              class="practice-button"
              type="button"
              disabled
              :aria-label="`${point.title}の練習はDemoでは利用できません`"
              data-testid="practice-unavailable"
            >
              練習する（Demoでは利用できません）
            </button>
          </li>
        </ul>
      </article>
    </div>
  </section>
</template>

<style scoped>
/* Knowledge mastery demo: use the shared ink/paper/green/lime/orange tokens and bold, readable blocks. */
.mastery-panel { width: min(920px, 100%); color: var(--ink); }
.mastery-header { display: flex; align-items: end; justify-content: space-between; gap: 28px; margin-bottom: 28px; }
.mastery-header h1 { font-size: clamp(2.5rem, 7vw, 5.2rem); }
.mastery-lead { max-width: 570px; margin: 18px 0 0; color: #53615c; line-height: 1.7; }
.demo-notice { display: inline-flex; flex-wrap: wrap; gap: 8px; max-width: 650px; margin: 14px 0 0; padding: 9px 11px; border: 1px solid var(--orange); color: var(--ink); background: #fff0e9; font-size: .78rem; font-weight: 700; line-height: 1.5; }
.demo-notice strong { color: #a72a13; letter-spacing: .08em; }
.mastery-summary { display: grid; flex: 0 0 136px; gap: 3px; padding: 16px; border: 2px solid var(--ink); background: var(--lime); box-shadow: 6px 6px 0 var(--ink); transform: rotate(2deg); }
.mastery-summary strong { font-size: 2.65rem; line-height: 1; letter-spacing: -.08em; }
.mastery-summary span { font-size: .72rem; font-weight: 900; }
.mastery-legend { display: flex; flex-wrap: wrap; gap: 12px 22px; margin-bottom: 34px; color: #53615c; font-size: .78rem; font-weight: 800; }
.mastery-legend span { display: inline-flex; align-items: center; gap: 7px; }
.legend-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--green); }
.legend-dot--growing { background: var(--orange); }
.legend-dot--review { background: var(--ink); }
.knowledge-groups { display: grid; gap: 26px; }
.knowledge-group { border: 2px solid var(--ink); background: var(--paper); box-shadow: 8px 8px 0 var(--ink); }
.group-heading { display: flex; align-items: start; justify-content: space-between; gap: 20px; padding: 22px 24px; border-bottom: 1px solid var(--line); }
.group-kicker { margin: 0 0 7px; color: var(--green); font-size: .68rem; font-weight: 900; letter-spacing: .14em; }
.group-heading h2 { margin: 0; font-size: clamp(1.35rem, 3vw, 2rem); }
.group-heading p:not(.group-kicker) { margin: 6px 0 0; color: #65706c; font-size: .86rem; line-height: 1.5; }
.group-count { flex: 0 0 auto; padding: 5px 8px; border: 1px solid var(--ink); font-size: .7rem; font-weight: 900; }
.knowledge-list { margin: 0; padding: 0; list-style: none; }
.knowledge-item { display: flex; align-items: end; justify-content: space-between; gap: 20px; padding: 22px 24px; border-bottom: 1px solid var(--line); transition: background .18s ease, transform .18s ease; }
.knowledge-item:last-child { border-bottom: 0; }
.knowledge-item__main { min-width: 0; flex: 1; }
.knowledge-item__title-row { display: flex; align-items: center; flex-wrap: wrap; gap: 9px 12px; }
.knowledge-item h3 { margin: 0; font-size: 1.12rem; }
.knowledge-item__main > p { margin: 7px 0 14px; color: #65706c; font-size: .86rem; line-height: 1.55; }
.status-pill { padding: 4px 7px; font-size: .68rem; font-weight: 900; }
.status-pill--mastered { color: white; background: var(--green); }
.status-pill--in-progress { color: var(--ink); background: #ffd9c9; }
.status-pill--review { color: white; background: var(--ink); }
.mastery-meter-row { display: flex; align-items: center; gap: 10px; max-width: 460px; }
.mastery-meter { height: 9px; flex: 1; overflow: hidden; border: 1px solid var(--ink); background: #eef0e5; }
.mastery-meter span { display: block; height: 100%; background: var(--green); transition: width .3s ease; }
.knowledge-item:nth-child(2) .mastery-meter span { background: var(--orange); }
.mastery-meter-row strong { min-width: 38px; font-size: .78rem; text-align: right; }
.last-practiced { margin: 9px 0 0 !important; font-size: .72rem !important; }
.practice-button { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 10px; min-height: 46px; padding: 9px 13px; border: 2px solid var(--ink); color: white; background: var(--green); font-size: .8rem; font-weight: 900; box-shadow: 4px 4px 0 var(--ink); transition: transform .16s ease, box-shadow .16s ease, background .16s ease; }
.practice-button span { font-size: 1.05rem; }
.practice-button:disabled { cursor: not-allowed; opacity: .62; box-shadow: 2px 2px 0 var(--ink); }
.practice-button:hover:disabled { transform: none; background: var(--green); }
.practice-button:focus-visible { outline: 4px solid #68bfff; outline-offset: 3px; }
@media (max-width: 680px) {
  .mastery-header { align-items: start; flex-direction: column; gap: 22px; }
  .mastery-summary { align-self: end; }
  .knowledge-item { align-items: stretch; flex-direction: column; gap: 18px; padding: 20px 18px; }
  .practice-button { justify-content: center; width: 100%; }
  .group-heading { padding: 20px 18px; }
}
@media (max-width: 360px) {
  .mastery-summary { align-self: stretch; grid-template-columns: auto 1fr; align-items: center; gap: 9px; }
  .mastery-summary strong { font-size: 2rem; }
  .mastery-legend { gap: 9px 14px; font-size: .72rem; }
  .group-heading { gap: 10px; }
  .group-count { font-size: .64rem; }
}
@media (prefers-reduced-motion: reduce) {
  .mastery-summary, .knowledge-item, .mastery-meter span, .practice-button { transform: none; transition: none; }
}
</style>
