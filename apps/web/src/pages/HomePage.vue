<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { studentExperienceKey } from '../composables/studentExperience'

const experience = inject(studentExperienceKey)!
const {
  nextMission, missionBusy, missionStepIndex, runMission, invitationCode,
  displayedTotalXp, displayedActivityCoins, displayedBadges, completedQuestCount,
  questMapNodes, masteryAverage, knowledgeItems, resultSummary, learnReady,
  journeySummaryVisible, journeyHighlights, latestBadgeLabels, journeyNextStep,
  comingSoonOpen,
  nextIslandReady, nextIslandPreviewOpen, openNextIslandPreview,
  listeningDemoOpen, listeningDemoAnswer, listeningDemoSubmitted, listeningDemoOptions,
  listeningDemoCorrect, startListeningDemo, submitListeningDemo,
} = experience

const codeCopied = ref(false)
// コードは生成時点で 5 文字ずつ区切られています。そのまま表示します。
const groupedInvitationCode = computed(() => invitationCode.value)

async function copyInvitationCode() {
  try {
    await navigator.clipboard.writeText(invitationCode.value)
    codeCopied.value = true
    window.setTimeout(() => { codeCopied.value = false }, 2000)
  } catch {
    // クリップボードが使えない場合は、表示されたコードを手入力していただきます。
  }
}

const entries = [
  { to: '/daily', kicker: '学習', title: '今日の学習', body: '12問の関卡で、今日のぶんを進めます。' },
  { to: '/level-check', kicker: '学習', title: 'レベルチェック', body: '今の得意と、復習したいところを確かめます。' },
  { to: '/review', kicker: '学習', title: '今日の復習', body: '苦手なところを短く確認します。' },
  { to: '/map', kicker: '記録', title: '冒険マップ', body: '学習の成果が、冒険の進み具合になります。' },
  { to: '/collection', kicker: '記録', title: '冒険バッグ', body: '集めた XP・コイン・バッジを確認します。' },
]
</script>

<template>
  <div class="home-page">
    <section
      class="mission-bar"
      :class="`mission-${nextMission.id}`"
      aria-label="今日のミッション"
    >
      <div class="mission-main">
        <p class="mission-step">
          {{ nextMission.step }}
        </p>
        <h2>{{ nextMission.title }}</h2>
        <p class="mission-detail">
          {{ nextMission.detail }}
        </p>
        <button
          v-if="nextMission.ctaLabel"
          class="primary-action mission-cta"
          type="button"
          :disabled="missionBusy"
          @click="runMission"
        >
          {{ nextMission.ctaLabel }}
        </button>
        <p
          v-else
          class="mission-waiting"
          role="status"
        >
          {{ nextMission.id === 'await-guardian' ? '保護者の確認をお待ちください。' : '次の操作はありません。' }}
        </p>
        <div
          v-if="invitationCode"
          class="mission-code"
        >
          <span>招待コード</span>
          <strong class="invitation-code">{{ groupedInvitationCode }}</strong>
          <div class="mission-code-actions">
            <button
              type="button"
              class="secondary-action"
              @click="copyInvitationCode"
            >
              {{ codeCopied ? 'コピーしました' : 'コードをコピー' }}
            </button>
            <small>画面上部の「保護者」に切り替えて貼り付けてください。</small>
          </div>
        </div>
      </div>

      <div class="mission-side">
        <dl class="mission-stats">
          <div>
            <dt>XP</dt>
            <dd>{{ displayedTotalXp }}</dd>
          </div>
          <div>
            <dt>コイン</dt>
            <dd>{{ displayedActivityCoins }}</dd>
          </div>
          <div>
            <dt>スポット</dt>
            <dd>{{ completedQuestCount }} / {{ questMapNodes.length }}</dd>
          </div>
        </dl>
        <ol class="mission-track">
          <li
            v-for="(label, index) in ['保護者の確認', 'レベルチェック', '復習', '音声練習']"
            :key="label"
            :class="{ done: missionStepIndex > index, current: missionStepIndex === index }"
          >
            <span>{{ missionStepIndex > index ? '✓' : index + 1 }}</span>
            <small>{{ label }}</small>
          </li>
        </ol>
      </div>
    </section>

    <section
      class="home-stats"
      aria-label="学習の記録"
    >
      <article>
        <span>XP</span><strong>{{ displayedTotalXp }}</strong>
      </article>
      <article>
        <span>コイン</span><strong>{{ displayedActivityCoins }}</strong>
      </article>
      <article>
        <span>達成スポット</span><strong>{{ completedQuestCount }} <small>/ {{ questMapNodes.length }}</small></strong>
      </article>
      <article>
        <span>平均習熟度</span><strong>{{ masteryAverage }}<small>%</small></strong>
      </article>
      <article>
        <span>復習予定</span><strong>{{ knowledgeItems.length }} <small>件</small></strong>
      </article>
      <article>
        <span>バッジ</span><strong>{{ displayedBadges.length }} <small>個</small></strong>
      </article>
    </section>

    <nav
      class="home-entries"
      aria-label="学習メニュー"
    >
      <RouterLink
        v-for="entry in entries"
        :key="entry.to"
        class="home-entry"
        :to="entry.to"
      >
        <span class="card-kicker">{{ entry.kicker }}</span>
        <strong>{{ entry.title }}</strong>
        <p>{{ entry.body }}</p>
        <small v-if="entry.to === '/level-check'">{{ resultSummary ? '受験できました' : learnReady ? 'いつでも始められます' : '保護者の確認が必要です' }}</small>
        <small v-else-if="entry.to === '/review'">{{ knowledgeItems.length ? `${knowledgeItems.length} 件の予定` : 'レベルチェックのあとに表示されます' }}</small>
        <small v-else-if="entry.to === '/map'">{{ completedQuestCount }} / {{ questMapNodes.length }} スポット達成</small>
        <small v-else>{{ displayedBadges.length }} 個のバッジ</small>
      </RouterLink>
    </nav>

    <section
      v-if="journeySummaryVisible"
      class="journey-summary-card"
      aria-label="学習旅程サマリー"
    >
      <p class="card-kicker">
        記録
      </p>
      <h2>今日の冒険まとめ</h2>
      <div class="journey-score-grid">
        <div>
          <strong>{{ completedQuestCount }}</strong>
          <span>達成スポット</span>
        </div>
        <div>
          <strong>{{ displayedTotalXp }}</strong>
          <span>XP</span>
        </div>
        <div>
          <strong>{{ displayedActivityCoins }}</strong>
          <span>コイン</span>
        </div>
        <div>
          <strong>{{ masteryAverage }}%</strong>
          <span>平均習熟度</span>
        </div>
      </div>
      <ul class="journey-highlight-list">
        <li
          v-for="highlight in journeyHighlights"
          :key="highlight"
        >
          {{ highlight }}
        </li>
      </ul>
      <div
        v-if="latestBadgeLabels.length"
        class="journey-badges"
      >
        <span>獲得バッジ</span>
        <strong>{{ latestBadgeLabels.join(' / ') }}</strong>
      </div>
      <p class="journey-next-step">
        {{ journeyNextStep }}
      </p>
    </section>

    <section class="coming-soon">
      <button
        class="coming-soon-toggle"
        type="button"
        :aria-expanded="comingSoonOpen"
        @click="comingSoonOpen = !comingSoonOpen"
      >
        <span>近日公開</span>
        <strong>学習プラン ・ 次の島 ・ リスニング入り江を開発しています</strong>
        <small>{{ comingSoonOpen ? '閉じる' : '開く' }}</small>
      </button>
      <div
        v-if="comingSoonOpen"
        class="coming-soon-body"
      >
        <article class="future-card">
          <h3>学習プラン</h3>
          <p>現在は無料でご利用いただけます。保護者の確認が終われば、すべての学習に進めます。</p>
          <span class="plan-badge">無料プラン</span>
        </article>
        <article class="future-card">
          <h3>次の島</h3>
          <p>{{ nextIslandReady ? '復習の森を越えました。次のステージの予告を確認できます。' : '復習クエストを完了すると、次の島の予告が開きます。' }}</p>
          <button
            class="secondary-action"
            type="button"
            :disabled="!nextIslandReady"
            @click="openNextIslandPreview"
          >
            {{ nextIslandReady ? '次の島をプレビューします' : '復習後にプレビューできます' }}
          </button>
        </article>
        <article
          v-if="nextIslandPreviewOpen"
          class="future-card wide"
        >
          <h3>リスニング入り江</h3>
          <p>短い会話を聞き取り、時間・理由・気持ちを選ぶ新しい冒険です。</p>
          <ul class="future-list">
            <li>3分で挑戦できる短い会話</li>
            <li>復習の森で見つけた苦手ポイントを反映</li>
            <li>保護者レポートに次のおすすめとして表示予定</li>
          </ul>
          <button
            class="secondary-action"
            type="button"
            :disabled="listeningDemoSubmitted"
            @click="startListeningDemo"
          >
            {{ listeningDemoSubmitted ? 'ためしました' : '1問ためしてみる' }}
          </button>
          <section
            v-if="listeningDemoOpen"
            class="listening-demo"
            aria-live="polite"
          >
            <span>リスニングをためす</span>
            <strong>どこで会いますか？</strong>
            <p class="listening-script">
              A: Let&apos;s meet at the library after school.<br>
              B: OK. See you there at four.
            </p>
            <fieldset :disabled="listeningDemoSubmitted">
              <legend class="sr-only">
                会話に合う答えを1つ選んでください
              </legend>
              <label
                v-for="option in listeningDemoOptions"
                :key="option.id"
                class="choice compact-choice"
                :class="{ selected: listeningDemoAnswer === option.id }"
              >
                <input
                  v-model="listeningDemoAnswer"
                  type="radio"
                  name="listening-demo"
                  :value="option.id"
                >
                <span>{{ option.text }}</span>
              </label>
            </fieldset>
            <button
              class="secondary-action"
              type="button"
              :disabled="!listeningDemoAnswer || listeningDemoSubmitted"
              @click="submitListeningDemo"
            >
              答えを確認します
            </button>
            <p
              v-if="listeningDemoSubmitted"
              class="listening-feedback"
              :class="{ correct: listeningDemoCorrect }"
            >
              {{ listeningDemoCorrect ? '正解です。library は「図書館」です。' : '惜しいです。library という場所の言葉を聞き取りましょう。' }}
            </p>
          </section>
        </article>
      </div>
    </section>
  </div>
</template>
