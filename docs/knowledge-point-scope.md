# 知識ポイントの範囲（A-1）

CEFR-J Grammar Profile 20180315 から英検3級の範囲を引き、
**学習者が独立して間違えられる単位**にまとめたものです。
機械可読な本体は [`content/knowledge-points.jsonl`](../content/knowledge-points.jsonl)、
引用の裏取り用に [`content/reference/`](../content/reference/NOTICE.md) に原典を置いています。

## いちばん大事な注意：CEFR-J のレベルは教える順ではありません

CEFR-J のレベルは**コーパスの出現頻度**で決まっています。実際にこうなっています。

| 項目 | CEFR-J レベル |
|---|---|
| `PASS.PRESENT`（受動態・現在） | **A1.2** |
| `PREL.that`（関係代名詞 that） | **A1.1** |
| `COMP.JJR.RBR.more`（more ＋ 形容詞） | **A2.2** |
| `TA.PAST.do.NEG`（didn't） | **A2.1** |

レベル順に並べると、**受動態と関係代名詞が be 動詞の過去形より先に来ます**。
頻度としては正しく、教材としては使えません。

そこで登録簿は 2 列に分けています。

- `cefrjLevels`：**出典**。0016 の公開台帳が「CEFR-J で難易度づけした自作題」と
  名乗る根拠がここにあります。CI が原典と突き合わせています。
- `teachingOrder`：**こちらの教学判断**。CEFR-J からは導けません。

## 数

CEFR-J の A1–A2 に格付けされた文法項目は **95 件**。これを 47 の文法ポイントにまとめ、
語彙 9 点を足して **出題可能な知識ポイントは 56** です。
95 件は全部どこかに割り当ててあり、取りこぼしも捏造もありません（CI で検査しています）。

### PRD の 120 という数字は、この根拠からは出ません

| | 点数 | × 12 回 ÷ 77 日 |
|---|---|---|
| PRD の想定 | 120 | 18.7 題/日 |
| **CEFR-J A1–A2 から実際に出た数** | **56** | **8.7 題/日** |

1 日 19 題を 77 日つづけると 1,463 回の曝露になり、56 点だと **1 点あたり 26 回**です。
PRD が想定した 12 回の倍以上で、これは悪いことではありません（練習量が増えるだけです）が、
**題庫の必要数は変わります**。

```
PRD:  120 点 × 10 題 = 1,200 題
実際:  56 点 × 12 題 =   672 題
```

判断が要るのは 1 点です。**56 点のまま 1 日 19 題で行く**（1 点を厚く回す）か、
**点をもっと細かく割って 120 に近づける**（前置詞を時／場所／方向に割る、場面別語彙を増やす、など）か。
前者を推します。細分は測定単位を細かくするだけで、学習が増えるわけではありません。
どちらにしても PRD の 120 と 1,200 は書き換えが要ります。

## 最初の 30 点

既存の題型（`mcq` / `word_order` / `article` / `katakana`）で出せるものだけです。
教学順の頭から連続して取っています——飛ばすと、飛ばした点が学習の途中で突然現れます。

| 順 | 知識ポイント | 日本語 | CEFR-J | 題型 |
|---|---|---|---|---|
| 1 | `grammar.be_present` | be動詞の現在形 | A1.1 | mcq, word_order |
| 2 | `grammar.be_negative` | be動詞の否定文 | A1.1 | mcq, word_order |
| 3 | `grammar.be_question` | be動詞の疑問文 | A1.1/A1.3 | word_order, mcq |
| 4 | `grammar.present_simple` | 一般動詞の現在形 | A1.1 | mcq, word_order |
| 5 | `vocabulary.context` | 文脈から語彙を選ぶ力 | A1/A2 | mcq |
| 6 | `grammar.third_person_s` | 三人称単数現在の s | A1.1 | mcq |
| 7 | `grammar.present_negative` | 一般動詞の否定文（don't / doesn't） | A1.2 | mcq, word_order |
| 8 | `grammar.present_question` | 一般動詞の疑問文（Do / Does） | A1.2 | word_order, mcq |
| 9 | `vocabulary.school_life` | 学校生活の語彙 | A1/A2 | mcq |
| 10 | `grammar.pronoun_case` | 代名詞の所有格・目的格 | A1.1 | mcq |
| 11 | `grammar.article` | 冠詞の使い分け（a / an / the / 無冠詞） | A1.1 | article, mcq |
| 12 | `grammar.word_order` | 英語の語順（主語＋動詞＋目的語） | A1.1/A1.2/A2.1 | word_order |
| 13 | `grammar.question_order` | 疑問詞のある疑問文 | A1.1/A1.2/A1.3 | word_order, mcq |
| 14 | `vocabulary.daily_life` | 家庭・買い物・食事の語彙 | A1/A2 | mcq |
| 15 | `grammar.imperative` | 命令文と Let's | A1.1/A1.3 | word_order, mcq |
| 16 | `grammar.there_be` | there ＋ be 動詞 | A1.2 | word_order, mcq |
| 17 | `grammar.preposition` | 前置詞（時・場所） | A1.1 | mcq |
| 18 | `vocabulary.loanword` | カタカナ語と英語の違い | A1/A2 | katakana, mcq |
| 19 | `grammar.conjunction` | 等位接続詞（and / but / or） | A1.1 | mcq, word_order |
| 20 | `grammar.some_any` | some / any / no の使い分け | A1.1/A1.2/A2.1 | mcq |
| 21 | `grammar.present_progressive` | 現在進行形 | A1.3 | mcq, word_order |
| 22 | `vocabulary.collocation` | 語と語の相性（do homework / take a bath） | A1/A2 | mcq |
| 23 | `grammar.be_past` | be動詞の過去形 | A1.3/A2.1 | mcq |
| 24 | `grammar.past_tense` | 一般動詞の過去形 | A1.3 | mcq, word_order |
| 25 | `grammar.past_negative_question` | 過去の否定文・疑問文（didn't / Did） | A2.1 | mcq, word_order |
| 26 | `grammar.modal_can` | 助動詞 can | A1.2 | mcq, word_order |
| 27 | `vocabulary.travel_place` | 道案内・旅行・場所の語彙 | A1/A2 | mcq |
| 28 | `grammar.future` | 未来を表す will と be going to | A2.1/A2.2 | mcq, word_order |
| 29 | `grammar.comparative` | 比較級 | A1.3/A2.2 | mcq, word_order |
| 30 | `grammar.superlative` | 最上級 | A1.1/A2.1 | mcq, word_order |

**30 点 × 12 題 = 360 題。** 1 題 3–5 分の教研レビューで、1 人で数日の量です。
1,200 題はそうではありません。

## 残りの範囲（26 点）

| 順 | 知識ポイント | 日本語 | CEFR-J | 題型 |
|---|---|---|---|---|
| 31 | `grammar.adverb_frequency` | 頻度の副詞と位置 | A1.1/A1.2 | word_order, mcq |
| 32 | `grammar.how_adjective` | How ＋ 形容詞・副詞 | A1.1 | word_order, mcq |
| 33 | `grammar.past_progressive` | 過去進行形 | A2.1 | mcq |
| 34 | `vocabulary.fixed_expression` | 決まった言い方（be good at / look forward to） | A1/A2 | mcq |
| 35 | `grammar.modal_should_must` | 助動詞 should / have to / need | A2/A2.1/A2.2 | mcq |
| 36 | `grammar.modal_would` | would like などのていねいな言い方 | A2.1 | mcq |
| 37 | `grammar.infinitive_noun` | to 不定詞（名詞的用法） | A1.1/A1.2 | mcq, word_order |
| 38 | `grammar.gerund` | 動名詞 | A1.1/A1.2/A1.3 | mcq, word_order |
| 39 | `vocabulary.opposite` | 対になる語 | A1/A2 | mcq |
| 40 | `grammar.infinitive_object` | 動詞＋目的語＋to 不定詞 | A1.2 | word_order, mcq |
| 41 | `grammar.gerund_or_infinitive` | 動名詞と to 不定詞の使い分け | A2.2 | mcq |
| 42 | `grammar.passive` | 受動態 | A1.2/A2.1 | mcq, word_order |
| 43 | `grammar.present_perfect` | 現在完了 | A2.1 | mcq, word_order |
| 44 | `grammar.that_clause` | think / know ＋ that 節 | A1.2/A2.1 | word_order, mcq |
| 45 | `vocabulary.polysemy` | 多義語の使い分け | A1/A2 | mcq |
| 46 | `grammar.subordinate_clause` | when / if / because などの副詞節 | A1.1/A1.2/A2.1 | word_order, mcq |
| 47 | `grammar.relative_pronoun` | 関係代名詞 who / that | A1.1/A1.3/A2.1 | word_order, mcq |
| 48 | `grammar.indirect_question` | 間接疑問 | A2.1 | word_order, mcq |
| 49 | `grammar.phrasal_verb` | 句動詞 | A1.1/A1.2/A2.1 | mcq |
| 50 | `grammar.demonstrative` | this / that ＋ 名詞 | A2.1 | mcq |
| 51 | `grammar.indefinite_pronoun` | something / anyone などの不定代名詞 | A1.2/A2.1 | mcq |
| 52 | `grammar.quantifier` | 数量を表す語（much / many / a lot of） | A2.2 | mcq |
| 53 | `grammar.participle_modifier` | 分詞の前置・後置修飾 | A1.2/A1.3/A2.1 | word_order, mcq |
| 54 | `grammar.preposition_stranding` | 前置詞の残留（Who are you talking to?） | A1.1 | word_order, mcq |
| 55 | `grammar.indirect_speech` | say / tell を使った間接話法 | A2.2 | mcq |
| 56 | `grammar.causative` | have / let / make ＋ 原形不定詞 | A2.1 | mcq |

## 出題できない 12 点

範囲には入りますが、いま作っても出せません。題型が無いか、決定待ちです。

| 知識ポイント | 日本語 | 止まっている理由 |
|---|---|---|
| `listening.conversation` | 会話の内容をつかむ力 | 音声ベンダー未決（C-1） |
| `listening.passage` | 短い文章の内容をつかむ力 | 音声ベンダー未決（C-1） |
| `listening.response` | 応答を選ぶ力 | 音声ベンダー未決（C-1） |
| `listening.time` | 数字・時刻を聞き取る力 | 音声ベンダー未決（C-1） |
| `reading.detail` | 細部を読み取る力 | 題型なし（読解の題型が未実装） |
| `reading.dialogue` | 会話文の流れをつかむ力 | 題型なし（読解の題型が未実装） |
| `reading.main_idea` | 文章の要点をつかむ力 | 題型なし（読解の題型が未実装） |
| `reading.reason` | 理由を読み取る力 | 題型なし（読解の題型が未実装） |
| `reading.reference` | 指示語が指すものをつかむ力 | 題型なし（読解の題型が未実装） |
| `speaking.interview` | 二次試験の受け答え | 音声ベンダー未決（C-1） |
| `writing.email_reply` | E メールへの返信を書く力 | 題型なし（英作文の採点が未実装） |
| `writing.opinion` | 意見と理由を書く力 | 題型なし（英作文の採点が未実装） |

## 進み具合の見かた

```bash
npm run content -w @peraquest/api coverage -- --first-30
```

合計ではなく**まだ 1 題も無い点の数**と**いちばん薄い点**を出します。
登録簿の側から数えているので、0 題の点も行として現れます。
`content_items` を集計するだけだと、未着手の点は行が無く、
「30 点中 29 点が未着手」という肝心のことが言えません。
