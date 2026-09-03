<script setup lang="ts">
import { inject } from 'vue'
import { studentExperienceKey } from '../composables/studentExperience'

const experience = inject(studentExperienceKey)!
const { busy, attempt, selected, resultSummary, earnedReward, learnReady, answered, startLevelCheck, submitLevelCheck } = experience
</script>

<template>
  <section
    id="level-check-panel"
    class="lesson-panel"
    :aria-busy="busy"
  >
    <header class="lesson-header">
      <div>
        <p class="eyebrow">
          学習
        </p>
        <strong>英検3級 · レベルチェック</strong>
      </div>
      <p>{{ attempt ? `${attempt.items.length} 問` : learnReady ? '準備できました' : '保護者の確認後に開始できます' }}</p>
    </header>

    <p
      v-if="!attempt && !learnReady"
      class="panel-empty"
    >
      まだレベルチェックは始められません。保護者の確認が完了すると、ここから開始できます。
    </p>

    <div
      v-else-if="busy && !attempt"
      class="skeleton-block"
      aria-hidden="true"
    >
      <span class="skeleton-line wide" />
      <span class="skeleton-line" />
      <span class="skeleton-line short" />
      <span class="skeleton-line wide" />
      <span class="skeleton-line" />
    </div>

    <button
      v-else-if="!attempt"
      class="primary-action"
      type="button"
      :disabled="busy"
      @click="startLevelCheck"
    >
      レベルチェックを開始します
    </button>

    <article
      v-else-if="!resultSummary"
      class="question-card"
    >
      <div
        v-for="(item, index) in attempt.items"
        :key="item.itemId"
        class="stage-question"
      >
        <span class="ability-tag">問題 {{ index + 1 }}</span>
        <h2>{{ item.prompt }}</h2>
        <p class="question-support">
          {{ item.support }}
        </p>
        <fieldset :disabled="busy">
          <legend class="sr-only">
            答えを1つ選んでください
          </legend>
          <label
            v-for="option in item.options"
            :key="option.optionId"
            class="choice"
            :class="{ selected: selected[item.itemId] === option.optionId }"
          >
            <input
              v-model="selected[item.itemId]"
              type="radio"
              :name="item.itemId"
              :value="option.optionId"
            >
            <span>{{ option.text }}</span>
          </label>
        </fieldset>
      </div>
      <button
        class="primary-action"
        type="button"
        :disabled="busy || !answered"
        @click="submitLevelCheck"
      >
        答えを提出します
      </button>
    </article>

    <article
      v-else
      class="result-card"
    >
      <strong>{{ resultSummary.passed ? '合格ラインに到達しました' : '復習から始めましょう' }}</strong>
      <p>今回の結果をもとに、復習予定を更新しました。</p>
      <p class="score-line">
        {{ resultSummary.maxScore }} 問中
        <strong>{{ resultSummary.rawScore }} 問</strong>
        正解
      </p>
      <p class="score-rate">
        正答率 {{ Math.round((resultSummary.score ?? 0) * 100) }}%
      </p>
      <div
        v-if="earnedReward"
        class="reward-summary"
      >
        <span>+{{ earnedReward.xpAwarded }} XP</span>
        <span>+{{ earnedReward.activityCoinsAwarded }} コイン</span>
        <span v-if="earnedReward.questStepDelta">
          クエスト +{{ earnedReward.questStepDelta }}
        </span>
      </div>
    </article>
  </section>
</template>
