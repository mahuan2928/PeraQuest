<script setup lang="ts">
// 出典表示。CEFR-J のライセンスは正しい署名を条件に商用利用を認めているため、
// この画面は体験セッションの有無にかかわらず常に開けるようにしています。
// content_items.attribution_location はこのページを指します。
const sources = [
  {
    name: 'CEFR-J Vocabulary Profile v1.5',
    holder: 'Yukio Tono, Tokyo University of Foreign Studies',
    via: 'Open Language Profiles',
    url: 'https://github.com/openlanguageprofiles/olp-en-cefrj',
    use: '語彙のレベル分けと知識ポイントの割り当てに使用しています。',
  },
  {
    name: 'CEFR-J Grammar Profile 20180315',
    holder: 'Yukio Tono, Tokyo University of Foreign Studies',
    via: 'Open Language Profiles',
    url: 'https://github.com/openlanguageprofiles/olp-en-cefrj',
    use: '文法項目のレベル分けに使用しています。',
  },
]
</script>

<template>
  <section
    class="credits-page"
    aria-labelledby="credits-title"
  >
    <h1 id="credits-title">
      出典と権利表示
    </h1>
    <p class="lead">
      本アプリの学習内容は、以下の資料をレベル分けの基礎として制作しています。
      問題文・例文・日本語の解説・音声は、すべて当チームが作成したものです。
    </p>

    <ul class="credits-list">
      <li
        v-for="source in sources"
        :key="source.name"
      >
        <strong>{{ source.name }}</strong>
        <span>{{ source.holder }}</span>
        <span>{{ source.via }}</span>
        <a
          :href="source.url"
          target="_blank"
          rel="noopener noreferrer"
        >{{ source.url }}</a>
        <small>{{ source.use }}</small>
      </li>
    </ul>

    <p class="credits-note">
      英検®は公益財団法人 日本英語検定協会の登録商標です。本アプリは同協会とは関係がなく、
      同協会の試験問題は使用していません。
    </p>

    <RouterLink
      class="secondary-action"
      to="/"
    >
      もどる
    </RouterLink>
  </section>
</template>
