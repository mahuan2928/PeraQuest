<script setup lang="ts">
import { inject } from 'vue'
import { studentExperienceKey } from '../composables/studentExperience'

const experience = inject(studentExperienceKey)!
const { knowledgeItems, reviewQuestOpen, reviewQuestCompleted, reviewReadAloudDone, reviewFocusRef, reviewRewriteText, masteryAverage, reviewQuestItems, reviewQuestReady, reviewTaskProgress, reviewQuestCanComplete, knowledgePointLabel, reviewStateLabel, startReviewQuest, completeReviewQuest } = experience
</script>

<template>
  <article
    id="review-panel"
    class="action-card"
  >
    <p class="card-kicker">
      復習予定
    </p>
    <h2>今日の復習</h2>
    <p>{{ knowledgeItems.length ? `${knowledgeItems.length} 件の復習予定があります。` : 'レベルチェックが終わると、復習予定がここに表示されます。' }}</p>
    <div
      v-if="knowledgeItems.length"
      class="mini-mastery"
    >
      <strong>{{ masteryAverage }}%</strong>
      <span>平均習熟度</span>
    </div>
    <section
      v-if="reviewQuestItems.length"
      class="review-route"
      aria-label="今日の復習クエスト"
    >
      <span>今日の復習クエスト</span>
      <strong>復習の森ルート</strong>
      <ol>
        <li
          v-for="item in reviewQuestItems"
          :key="item.knowledgePointRef"
        >
          <span>{{ reviewStateLabel(item.state) }}</span>
          <strong>{{ knowledgePointLabel(item.knowledgePointRef) }}</strong>
          <small>習熟度 {{ Math.round(item.masteryScore * 100) }}%</small>
        </li>
      </ol>
    </section>
    <button
      v-if="reviewQuestReady && !reviewQuestOpen"
      class="primary-action"
      type="button"
      @click="startReviewQuest"
    >
      復習クエストを始めます
    </button>
    <section
      v-if="reviewQuestOpen"
      class="review-quest-panel"
      aria-live="polite"
    >
      <span>森のルート</span>
      <strong>{{ reviewQuestItems.length }}つのポイントを確認中</strong>
      <p>声に出して例文を読み、間違えた理由を1つだけ思い出しましょう。</p>
      <div class="review-task-list">
        <label
          class="review-task"
          :class="{ done: reviewReadAloudDone }"
        >
          <input
            v-model="reviewReadAloudDone"
            type="checkbox"
            :disabled="reviewQuestCompleted"
          >
          <span>
            <strong>例文を声に出して読みました</strong>
            <small>今日の復習ポイントを1つ、ゆっくり読み上げます。</small>
          </span>
        </label>
        <fieldset
          class="review-focus-task"
          :disabled="reviewQuestCompleted"
        >
          <legend>今日いちばん復習したいポイント</legend>
          <label
            v-for="item in reviewQuestItems"
            :key="`focus-${item.knowledgePointRef}`"
            class="review-task"
            :class="{ done: reviewFocusRef === item.knowledgePointRef }"
          >
            <input
              v-model="reviewFocusRef"
              type="radio"
              name="review-focus"
              :value="item.knowledgePointRef"
            >
            <span>
              <strong>{{ knowledgePointLabel(item.knowledgePointRef) }}</strong>
              <small>習熟度 {{ Math.round(item.masteryScore * 100) }}%</small>
            </span>
          </label>
        </fieldset>
        <label
          class="review-task rewrite"
          :class="{ done: reviewRewriteText.trim().length >= 6 }"
        >
          <span>
            <strong>短い英文を1つ書き直しました</strong>
            <small>例: I finished my homework.</small>
          </span>
          <input
            v-model="reviewRewriteText"
            class="review-rewrite-input"
            type="text"
            placeholder="I finished my homework."
            :disabled="reviewQuestCompleted"
          >
        </label>
      </div>
      <p class="review-task-progress">
        {{ reviewTaskProgress }} / 3 タスク完了
      </p>
      <button
        class="secondary-action"
        type="button"
        :disabled="reviewQuestCompleted || !reviewQuestCanComplete"
        @click="completeReviewQuest"
      >
        {{ reviewQuestCompleted ? '復習済みです' : '今日の復習を完了します' }}
      </button>
      <p
        v-if="reviewQuestCompleted"
        class="review-complete"
      >
        今日の復習を完了しました。次は「次の島」の準備へ進みます。
      </p>
    </section>
  </article>
</template>
