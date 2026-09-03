<script setup lang="ts">
import { inject, onMounted, ref } from 'vue'
import { equipCosmetic, fetchCosmetics, purchaseCosmetic } from '../api/demoFlow'
import { studentExperienceKey } from '../composables/studentExperience'

const experience = inject(studentExperienceKey)!
const { busy, voiceReady, guardianReady, learnReady, voiceEnabled, inventoryItems, badgeInventoryItems, lockedInventoryHints, inventoryCollectionCount, prepareVoicePractice, session, refreshGameState } = experience

type CosmeticItem = {
  code: string
  kind: 'accessory' | 'theme' | 'frame'
  displayName: string
  price: number
  owned: boolean
  equipped: boolean
  affordable: boolean
}

// 見た目だけの店です。買っても出題も判定も変わりません。
// 期間限定は作りません（PRD 2.4.4 の賭博化を避ける方針）。
const cosmetics = ref<CosmeticItem[]>([])
const coins = ref(0)
const shopBusy = ref('')
const shopMessage = ref('')

const kindLabels: Record<CosmeticItem['kind'], string> = {
  accessory: 'そうしょく',
  theme: 'いろ',
  frame: 'フレーム',
}

function applyShop(body: unknown) {
  const shop = body as { activityCoins: number; items: CosmeticItem[] }
  coins.value = shop.activityCoins
  cosmetics.value = shop.items
}

async function loadCosmetics() {
  const result = await fetchCosmetics(session.value.studentToken)
  if (result.ok) applyShop(result.body)
}

async function buy(item: CosmeticItem) {
  if (shopBusy.value) return
  shopBusy.value = item.code
  shopMessage.value = ''
  try {
    const result = await purchaseCosmetic(session.value.studentToken, item.code)
    if (result.ok) {
      applyShop((result.body as { shop: unknown }).shop)
      shopMessage.value = `${item.displayName} を手に入れました。`
      await refreshGameState()
      return
    }
    // 「買えなかった」を黙って飲み込むと、押したのに何も起きない画面になります。
    shopMessage.value = 'コインが足りません。今日の学習をもう 1 回終えると増えます。'
  } finally {
    shopBusy.value = ''
  }
}

async function equip(item: CosmeticItem) {
  if (shopBusy.value) return
  shopBusy.value = item.code
  try {
    const result = await equipCosmetic(session.value.studentToken, item.code)
    if (result.ok) {
      applyShop((result.body as { shop: unknown }).shop)
      shopMessage.value = `${item.displayName} を身につけました。`
    }
  } finally {
    shopBusy.value = ''
  }
}

onMounted(loadCosmetics)
</script>

<template>
  <div class="collection-grid">
    <article class="action-card side-card inventory-card">
      <p class="card-kicker">
        記録
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
        状況
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
    <article class="action-card side-card shop-card">
      <p class="card-kicker">
        こうかん
      </p>
      <h2>ひみつの店</h2>
      <div class="inventory-count compact">
        <strong>{{ coins }}</strong>
        <span>もっているコイン</span>
      </div>
      <p class="shop-note">
        見た目だけのアイテムです。もらえる問題や採点は変わりません。
      </p>
      <ul class="shop-list">
        <li
          v-for="item in cosmetics"
          :key="item.code"
          :class="{ owned: item.owned, equipped: item.equipped }"
        >
          <span class="shop-kind">{{ kindLabels[item.kind] }}</span>
          <strong>{{ item.displayName }}</strong>
          <small v-if="item.equipped">身につけています</small>
          <small v-else-if="item.owned">もっています</small>
          <small v-else>{{ item.price }} コイン</small>
          <button
            v-if="!item.owned"
            type="button"
            class="secondary-action"
            :disabled="!item.affordable || shopBusy === item.code"
            @click="buy(item)"
          >
            {{ item.affordable ? 'こうかんする' : 'あと ' + (item.price - coins) + ' コイン' }}
          </button>
          <button
            v-else-if="!item.equipped"
            type="button"
            class="secondary-action"
            :disabled="shopBusy === item.code"
            @click="equip(item)"
          >
            身につける
          </button>
        </li>
      </ul>
      <p
        v-if="shopMessage"
        class="shop-message"
        role="status"
      >
        {{ shopMessage }}
      </p>
    </article>
  </div>
</template>
