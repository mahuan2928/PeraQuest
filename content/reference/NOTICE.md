# 参照データ

## cefrj-grammar-profile-20180315.csv

CEFR-J Grammar Profile Version 20180315。Tono Laboratory (Tokyo University of Foreign Studies) 著作。
出典：https://github.com/openlanguageprofiles/olp-en-cefrj （原典 http://www.cefr-j.org/download.html ）

> CEFR-J vocabulary and grammar profile datasets can be used for research and commercial
> purposes with no charge, provided that you cite the dataset properly.

**用途は 1 つだけです。** `content/knowledge-points.jsonl` が引用している CEFR-J コードが
実在することを CI で確かめるためです。ここから問題を作ることはしません
（そもそも文法項目表であって問題集ではありません）。

**同梱していないもの**：同じリポジトリにある `octanove-vocabulary-profile-c1c2-1.0.csv` は
CC BY-SA 4.0 で、ShareAlike が内容庫に伝染します。PRD 3.4 のホワイトリストにも入っていません。
取り込まないでください。

`cefrj-vocabulary-profile-1.5.csv`（A1+A2 で 2,575 語）も同じ条件で使えますが、
いまは参照する仕組みが無いので入れていません。出題語彙が 3 級の範囲に収まっているかを
検証する機能を足すときに、そこで初めて持ち込みます。
