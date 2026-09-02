<script setup lang="ts">
import { inject } from 'vue'
import { studentExperienceKey } from '../composables/studentExperience'

const experience = inject(studentExperienceKey)!
const { busy, voiceReady, guardianReady, learnReady, voiceEnabled, inventoryItems, badgeInventoryItems, lockedInventoryHints, inventoryCollectionCount, prepareVoicePractice } = experience
</script>

<template>
  <div class="collection-grid">
    <article class="action-card side-card inventory-card">
      <p class="card-kicker">
        コレクション
      </p>
      <h2>冒険バッグ</h2>
      <div class="inventory-count compact">
        <strong>{{ inventoryCollectionCount }}</strong>
        <span>コレクション</span>
      </div>
      <div class="inventory-resource-grid">
        <div
          v-for="item in inventoryItems"
          :key="item.id"
          class="inventory-item"
          :class="item.status"
        >
          <span>{{ item.status === 'collected' ? '✓' : '?' }}</span>
          <strong>{{ item.title }}</strong>
          <small>{{ item.detail }}</small>
        </div>
      </div>
      <section class="inventory-section">
        <h3>バッジ</h3>
        <p v-if="!badgeInventoryItems.length">
          最初のバッジは保護者確認で手に入ります。
        </p>
        <div
          v-else
          class="inventory-badge-grid"
        >
          <span
            v-for="badge in badgeInventoryItems"
            :key="badge.id"
          >
            {{ badge.title }}
          </span>
        </div>
      </section>
      <section
        v-if="lockedInventoryHints.length"
        class="inventory-section locked"
      >
        <h3>次に集めるもの</h3>
        <ul>
          <li
            v-for="item in lockedInventoryHints"
            :key="item.id"
          >
            <strong>{{ item.title }}</strong>
            <small>{{ item.detail }}</small>
          </li>
        </ul>
      </section>
    </article>

    <article class="action-card side-card">
      <p class="card-kicker">
        ステータス
      </p>
      <h2>準備の状況</h2>
      <ul class="safety-list compact">
        <li :class="{ done: guardianReady }">
          <span>{{ guardianReady ? '✓' : '1' }}</span>
          <div>
            <strong>保護者の確認</strong>
            <small>{{ guardianReady ? '完了しました。' : '確認を待っています。' }}</small>
          </div>
        </li>
        <li :class="{ done: learnReady }">
          <span>{{ learnReady ? '✓' : '2' }}</span>
          <div>
            <strong>学習の解放</strong>
            <small>{{ learnReady ? 'レベルチェックを開始できます。' : '確認後に解放されます。' }}</small>
          </div>
        </li>
        <li :class="{ done: voiceEnabled }">
          <span>{{ voiceEnabled ? '✓' : '3' }}</span>
          <div>
            <strong>音声練習</strong>
            <small>{{ voiceEnabled ? '利用できます。' : '保護者の同意が必要です。' }}</small>
          </div>
        </li>
      </ul>
      <button
        v-if="voiceEnabled"
        class="secondary-action"
        type="button"
        :disabled="busy || voiceReady"
        @click="prepareVoicePractice"
      >
        {{ voiceReady ? '提出準備が完了しました' : '音声練習を提出します' }}
      </button>
    </article>
  </div>
</template>
