<script setup lang="ts">
import { inject } from 'vue'
import { studentExperienceKey } from '../composables/studentExperience'

const experience = inject(studentExperienceKey)!
const { questProgress, questMapNodes, questIslands, currentQuestNode, selectedQuestNode, completedQuestCount, currentQuestIsland, questStatusLabel, selectQuestNode } = experience
</script>

<template>
  <article class="action-card quest-card">
    <p class="card-kicker">
      冒険
    </p>
    <h2>冒険マップ</h2>
    <div class="quest-current">
      <span>現在の目標</span>
      <strong>{{ currentQuestIsland.title }} · {{ currentQuestNode.title }}</strong>
      <p>{{ currentQuestNode.action }}</p>
    </div>
    <div class="quest-trail">
      <span :style="{ width: `${questProgress}%` }" />
    </div>
    <p class="quest-step">
      {{ completedQuestCount }} / {{ questMapNodes.length }} スポット達成
    </p>
    <ol
      class="quest-map"
      aria-label="冒険マップ"
    >
      <li
        v-for="island in questIslands"
        :key="island.id"
        class="quest-island"
        :class="island.status"
      >
        <div class="quest-island-heading">
          <span>{{ island.chapter }}</span>
          <strong>{{ island.title }}</strong>
          <small>{{ island.status === 'locked' ? 'ここから先は、次の目標を達成すると開きます。' : island.description }}</small>
        </div>
        <ol
          v-if="island.status !== 'locked'"
          class="quest-island-nodes"
        >
          <li
            v-for="node in island.nodes"
            :key="node.id"
            class="quest-node"
            :class="node.status"
          >
            <button
              class="quest-node-button"
              type="button"
              :aria-pressed="selectedQuestNode.id === node.id"
              @click="selectQuestNode(node)"
            >
              <span class="quest-pin">{{ node.status === 'done' ? '✓' : questMapNodes.findIndex((item) => item.id === node.id) + 1 }}</span>
              <div>
                <strong>
                  {{ node.title }}
                  <small class="quest-state-label">{{ questStatusLabel(node.status) }}</small>
                </strong>
                <small>{{ node.description }}</small>
                <em>{{ node.reward }}</em>
              </div>
              <span
                v-if="node.id === currentQuestNode.id"
                class="quest-avatar"
                aria-label="現在地"
              >
                LQ
              </span>
            </button>
          </li>
        </ol>
      </li>
    </ol>
    <section
      class="quest-detail compact"
      aria-live="polite"
    >
      <span>スポット詳細</span>
      <strong>{{ selectedQuestNode.title }}</strong>
      <p>{{ selectedQuestNode.action }}</p>
    </section>
  </article>
</template>
