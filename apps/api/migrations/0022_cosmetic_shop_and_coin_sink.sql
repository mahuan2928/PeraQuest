-- 0022: コインの出口。
--
-- ここまで `activity_coin_delta` も `activity_coins` も CHECK (>= 0) だったので、
-- スキーマが「使う」ことを表現できませんでした。毎日 10 枚配っているのに使い道がない通貨は
-- 数日で無視されます。配るなら使い道を用意するのが先です。
--
-- 残高が負にならないことは不変条件なので `student_game_state` の CHECK は残します。
-- 変えるのは台帳のほうで、しかも符号を自由にするのではなく、
-- 「買い物の行は必ずコインだけが減り、XP も段位もバッジも動かない」と対にして縛ります。
-- 整数列をひとつ無条件に開けると、いつか報酬の経路が事故で負のコインを配ります。

ALTER TABLE game_reward_ledger DROP CONSTRAINT game_reward_ledger_source_type_check;
ALTER TABLE game_reward_ledger
  ADD CONSTRAINT game_reward_ledger_source_type_check
  CHECK (source_type IN ('stage_attempt', 'guardian_verification', 'daily_session', 'shop_purchase'));

ALTER TABLE game_reward_ledger DROP CONSTRAINT game_reward_ledger_reason_check;
ALTER TABLE game_reward_ledger
  ADD CONSTRAINT game_reward_ledger_reason_check
  CHECK (reason IN (
    'stage_attempt_passed', 'stage_attempt_completed', 'guardian_link_verified',
    'daily_session_completed', 'cosmetic_purchased'
  ));

ALTER TABLE game_reward_ledger DROP CONSTRAINT game_reward_ledger_activity_coin_delta_check;
ALTER TABLE game_reward_ledger
  ADD CONSTRAINT game_reward_ledger_purchase_spends_only_coins
  CHECK (
    CASE WHEN source_type = 'shop_purchase'
      THEN activity_coin_delta < 0 AND xp_delta = 0 AND quest_step_delta = 0
           AND quest_chapter_unlocked IS NULL AND badge_codes = '{}'::text[]
      ELSE activity_coin_delta >= 0
    END
  );

-- 見た目だけのアイテムです。能力にも出題にも影響しません。
-- 期間限定フラグは持ちません。子ども向けの無料学習アプリで「今だけ」を作るのは、
-- PRD 2.4.4 の賭博化を避ける方針と正面からぶつかります。
CREATE TABLE IF NOT EXISTS cosmetic_items (
  code text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('accessory', 'theme', 'frame')),
  display_name text NOT NULL,
  price integer NOT NULL CHECK (price > 0),
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE (code, kind)
);

-- 価格は「毎日の関卡 10 枚」から逆算しています。
-- いちばん安いものが 4 日で届かないと、出口があること自体が伝わりません。
INSERT INTO cosmetic_items (code, kind, display_name, price, sort_order) VALUES
  ('hat_explorer', 'accessory', 'たんけん帽', 40, 1),
  ('theme_forest', 'theme', '森のいろ', 80, 2),
  ('cape_star', 'accessory', '星のマント', 120, 3),
  ('theme_night', 'theme', '夜空のいろ', 200, 4),
  ('frame_gold', 'frame', '金のフレーム', 300, 5)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS student_cosmetics (
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code text NOT NULL,
  kind text NOT NULL,
  equipped boolean NOT NULL DEFAULT false,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, code),
  FOREIGN KEY (code, kind) REFERENCES cosmetic_items(code, kind)
);

-- 種類ごとに 1 つだけ装備できます。部分ユニーク索引は結合の先を見られないので、
-- kind は目録から複製して持ちます。真実性は上の複合外部キーが保ちます。
CREATE UNIQUE INDEX IF NOT EXISTS student_cosmetics_one_equipped_per_kind_idx
  ON student_cosmetics(student_id, kind) WHERE equipped;

-- 支出は報酬とは別の関数です。applyGameReward は加算を前提に書かれていて、
-- 衝突時にゼロの報酬を返します。買い物がそれに乗ると「静かに成功したように見えて
-- 何も買えていない」経路ができます。ここで残高を確かめ、読める言葉で断ります。
-- CHECK (activity_coins >= 0) は最後の砦であって、唯一の砦ではありません。
CREATE OR REPLACE FUNCTION purchase_cosmetic(p_student_id uuid, p_code text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_item cosmetic_items%ROWTYPE;
  v_balance integer;
BEGIN
  SELECT * INTO v_item FROM cosmetic_items WHERE code = p_code;
  IF NOT FOUND THEN
    RETURN 'unknown_item';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_student_id::text), hashtext('cosmetic_purchase'));

  IF EXISTS (SELECT 1 FROM student_cosmetics WHERE student_id = p_student_id AND code = p_code) THEN
    RETURN 'already_owned';
  END IF;

  INSERT INTO student_game_state (student_id) VALUES (p_student_id)
  ON CONFLICT (student_id) DO UPDATE SET updated_at = student_game_state.updated_at;
  SELECT activity_coins INTO v_balance FROM student_game_state WHERE student_id = p_student_id FOR UPDATE;
  IF v_balance < v_item.price THEN
    RETURN 'insufficient_coins';
  END IF;

  INSERT INTO game_reward_ledger
    (id, student_id, source_type, source_ref, reason, xp_delta, activity_coin_delta)
  VALUES
    (gen_random_uuid(), p_student_id, 'shop_purchase', p_code, 'cosmetic_purchased', 0, -v_item.price);

  UPDATE student_game_state
  SET activity_coins = activity_coins - v_item.price, updated_at = CURRENT_TIMESTAMP
  WHERE student_id = p_student_id;

  INSERT INTO student_cosmetics (student_id, code, kind) VALUES (p_student_id, p_code, v_item.kind);
  RETURN 'purchased';
END;
$$;

CREATE OR REPLACE FUNCTION equip_cosmetic(p_student_id uuid, p_code text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_kind text;
BEGIN
  SELECT kind INTO v_kind FROM student_cosmetics WHERE student_id = p_student_id AND code = p_code;
  IF NOT FOUND THEN
    RETURN 'not_owned';
  END IF;
  -- 先に外してから着けます。逆にすると部分ユニーク索引に引っかかります。
  UPDATE student_cosmetics SET equipped = false
  WHERE student_id = p_student_id AND kind = v_kind AND equipped;
  UPDATE student_cosmetics SET equipped = true
  WHERE student_id = p_student_id AND code = p_code;
  RETURN 'equipped';
END;
$$;

COMMENT ON CONSTRAINT game_reward_ledger_purchase_spends_only_coins ON game_reward_ledger IS
  'A shop purchase may only reduce coins. Rewards may only add them. One unconstrained signed column is how a reward path eventually grants negative coins by accident.';
COMMENT ON FUNCTION purchase_cosmetic(uuid, text) IS
  'The spend path. Separate from applyGameReward, which assumes addition and answers a conflict with a zeroed reward — a shape that would report a failed purchase as success.';
