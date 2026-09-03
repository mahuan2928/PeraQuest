# 題庫（content/items）

英検3級の自作題を置く場所です。**PRD 3.4 により、題目・例文・日本語解説はすべてチーム原創**
または明示的な商用許諾が必要です。CEFR-J は「どの語・どの文法がこの級で合法か」を決める根拠
であって問題集ではないので、そこから問題を写すことはできません。

## ファイルの形

知識ポイントごとに 1 ファイル、1 行 1 題の JSONL です。
`seed-content.ts` のような TS 配列にしないのは、1,200 題を 1 ファイルに書くと
**1 題ずつのレビューも差分も取れなくなる**ためです。

```
content/items/<knowledge_point_ref>.jsonl
```

```json
{"itemKind":"mcq","contentVersion":"mcq-vocab-context-001","knowledgePointRef":"vocabulary.context","skillRef":"vocabulary","payload":{"sentence":"It started to rain, so I opened my ___.","choices":["umbrella","window","letter","bottle"],"answer":"umbrella","explanation":"「雨がふってきた」から、次にすることを考えます。"}}
```

`contentVersion` は**生きている行の一意キー**（0025）です。重複すると投入時に止まります。

## 題型

| itemKind | payload | 備考 |
|---|---|---|
| `mcq` | `sentence` / `choices` / `answer` / `explanation` | 英検3級 大問1 と同じ四択。制限時間なし |
| `article` | `sentence` / `choices` / `answer` / `timeLimitSeconds` / `explanation` | 冠詞センサー。制限時間あり |
| `word_order` | `japanese` / `blocks` / `answers` / `explanation` | 並べ替え。`answers` は複数可 |
| `katakana` | `katakana` / `choices` / `answer` / `explanation` | 和製英語と英語の違い |

検証は形だけでなく**解けるかどうか**も見ます。`answer` が `choices` に無い、選択肢が重複している、
並べ替えの答えが配ったブロックだけでできていない――これらは投入前に落とします。
「絶対に正解できない問題」が公開まで進むのを防ぐためです。

## 手順

```bash
npm run content -w @peraquest/api validate     # ファイルだけ検証（DB 不要）
npm run content -w @peraquest/api import       # 検証して in_review で投入
npm run content -w @peraquest/api coverage     # 知識ポイントごとの充足を見る
npm run content -w @peraquest/api publish -- --knowledge-point vocabulary.context --reviewer "名前"
```

**投入は必ず `in_review` です。** publish だけが `reviewer` と `reviewed_at` を記録し、
0016 の公開ゲートを通します。日本語母語の教研レビューを経ていないものを published に
できてしまうと、そのゲートは形だけになります。

## 何題必要か

判定窓が 8 回なので、**1 知識ポイントあたり最低 8 題、推奨 12 題**。
窓の中に同じ問題が 2 回出ると、測っているのは「その知識ポイントを理解したか」ではなく
「その問題を覚えたか」になります。`publish` は 8 題に満たないポイントを断ります。

見るべきは合計ではなく**いちばん薄いポイント**です。1,200 題あっても 40 ポイントに
偏っていれば 2 日目に同じ問題が出ます。`coverage` が最小値を出すのはそのためです。

## 最初の目標は 1,200 題ではありません

1,200 は全課程（120 知識ポイント × 10–12 題）の量です。いま詰まっているのは
「2 日目に同じ問題が出る」ことで、それは **30 ポイント × 12 題 = 360 題**で解けます
（新規投入は 1 日 3 ポイントまでなので 10 日ぶん、30 × 12 回の曝露 ÷ 19 題/日 ≈ 19 日ぶんの学習）。
360 題は 1 人で数日レビューできる量で、1,200 題はそうではありません。
管線ができた今、1,200 は新しい仕事ではなく同じ仕事の繰り返しです。
