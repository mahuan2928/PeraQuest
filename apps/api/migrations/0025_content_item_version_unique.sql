-- 0025: 題目の一意キー。
--
-- ここまで content_items には UNIQUE が 1 つもなく、投入側の `ON CONFLICT DO NOTHING` は
-- 衝突する相手がいないので一度も効いていませんでした。seed を 2 回流すと題数が倍になります
-- （実測：14 → 28）。14 題なら見苦しいだけですが、同じ知識ポイント内の重複は
-- 8 回の判定窓を壊します。窓の中に同じ問題が 2 回出れば、測っているのは
-- 「その知識ポイントを理解したか」ではなく「その問題を覚えたか」です。
--
-- 重複は削除しません。0016 のトリガが「題目は retire するもので delete するものではない」と
-- 決めており、答案（daily_answers）からも ON DELETE RESTRICT で参照されています。
-- 代わりに重複を retired にして、索引を retired 以外に限ります。履歴は残り、
-- 参照も切れず、生きている行の一意性だけが保たれます。

-- 生き残りは「答案がある行」を優先します。学習の履歴が retired 側に取り残されないためです。
-- 同点なら古いほうを残します。
WITH ranked AS (
  SELECT id, content_version,
         row_number() OVER (
           PARTITION BY content_version
           ORDER BY
             (EXISTS (SELECT 1 FROM daily_answers da WHERE da.content_item_id = content_items.id)) DESC,
             (status = 'published') DESC,
             created_at ASC,
             id ASC
         ) AS rank
  FROM content_items
  WHERE content_version IS NOT NULL
)
UPDATE content_items ci
SET status = 'retired'
FROM ranked
WHERE ci.id = ranked.id AND ranked.rank > 1 AND ci.status <> 'retired';

-- retired は索引から外れるので、0016 の retire→再公開の経路は残ります。
-- そのとき同じ content_version が二重に生きようとすれば、そこで初めて失敗します。
-- 黙って通すより、その場で止まるほうが正しい振る舞いです。
CREATE UNIQUE INDEX content_items_live_content_version_idx
  ON content_items(content_version)
  WHERE content_version IS NOT NULL AND status <> 'retired';

COMMENT ON INDEX content_items_live_content_version_idx IS
  'One live row per content_version. Retired rows are excluded so that withdrawing an item stays possible, and so that duplicates could be repaired without deleting rows the answer ledger refers to.';
