-- 毎日ループ・生命値・復習上限。
-- knowledge_evidence(0009) は提出済み formal attempt を要求するため毎日復習は書けません。
-- ここでは別系統の表を立て、習熟度への反映は 0010 の calculate_* 関数をそのまま使います。

CREATE TABLE daily_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  session_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'expired')),
  -- PRD: 1 関卡 12-15 題
  target_count integer NOT NULL CHECK (target_count BETWEEN 12 AND 15),
  completed_count integer NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
  review_count integer NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamptz,
  UNIQUE (student_id, session_date),
  CONSTRAINT daily_sessions_completed_within_target_chk CHECK (completed_count <= target_count)
);

CREATE INDEX daily_sessions_student_idx ON daily_sessions(student_id, session_date DESC);

CREATE TABLE daily_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES daily_sessions(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  content_item_id uuid NOT NULL REFERENCES content_items(id) ON DELETE RESTRICT,
  knowledge_point_ref text NOT NULL CHECK (btrim(knowledge_point_ref) <> ''),
  is_review boolean NOT NULL DEFAULT false,
  outcome stage_attempt_answer_outcome NOT NULL,
  -- 冠詞センサーのタイムアウトは知識の誤りとして扱いません（P0-13）。
  timed_out boolean NOT NULL DEFAULT false,
  earned_score numeric(12,6) NOT NULL CHECK (earned_score >= 0),
  max_score numeric(12,6) NOT NULL CHECK (max_score > 0),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (session_id, content_item_id),
  CONSTRAINT daily_answers_score_within_max_chk CHECK (earned_score <= max_score),
  CONSTRAINT daily_answers_timed_out_is_skipped_chk CHECK (NOT timed_out OR outcome = 'skipped')
);

CREATE INDEX daily_answers_session_idx ON daily_answers(session_id, created_at);
CREATE INDEX daily_answers_student_idx ON daily_answers(student_id, occurred_at DESC);

-- 生命値。残数は投影、増減はすべて台帳に残します（0015 と同じ形）。
CREATE TABLE student_lives (
  student_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  lives integer NOT NULL DEFAULT 5 CHECK (lives BETWEEN 0 AND 5),
  -- 回復の起点。cron を持たず、読み出し時に経過時間から回復量を算出します。
  refill_anchor_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE life_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta integer NOT NULL CHECK (delta <> 0),
  reason text NOT NULL CHECK (reason IN ('wrong_answer', 'time_refill')),
  source_ref text NOT NULL CHECK (btrim(source_ref) <> ''),
  lives_after integer NOT NULL CHECK (lives_after BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- P0-10「二重に減算しない」。同じ誤答での再試行は一意キーで弾きます。
  UNIQUE (student_id, reason, source_ref)
);

CREATE INDEX life_ledger_student_idx ON life_ledger(student_id, created_at DESC);

CREATE OR REPLACE FUNCTION reject_life_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'life ledger is append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER life_ledger_mutation_trg
BEFORE UPDATE OR DELETE ON life_ledger
FOR EACH ROW EXECUTE FUNCTION reject_life_ledger_mutation();
CREATE TRIGGER life_ledger_truncate_trg
BEFORE TRUNCATE ON life_ledger
FOR EACH STATEMENT EXECUTE FUNCTION reject_life_ledger_mutation();

CREATE OR REPLACE FUNCTION reject_daily_answer_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'daily answers are append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER daily_answers_mutation_trg
BEFORE UPDATE OR DELETE ON daily_answers
FOR EACH ROW EXECUTE FUNCTION reject_daily_answer_mutation();

-- 経過時間ぶんの回復を確定させます。30 分で 1、上限 5。
-- 端数は anchor に残すので、確認するたびに回復が遅れることはありません。
CREATE OR REPLACE FUNCTION settle_life_refill(p_student_id uuid)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_lives integer;
  v_anchor timestamptz;
  v_recovered integer;
BEGIN
  INSERT INTO student_lives (student_id) VALUES (p_student_id)
  ON CONFLICT (student_id) DO NOTHING;

  SELECT lives, refill_anchor_at INTO v_lives, v_anchor
  FROM student_lives WHERE student_id = p_student_id FOR UPDATE;

  IF v_lives >= 5 THEN
    UPDATE student_lives
    SET refill_anchor_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE student_id = p_student_id;
    RETURN v_lives;
  END IF;

  v_recovered := floor(extract(epoch FROM (CURRENT_TIMESTAMP - v_anchor)) / 1800)::int;
  IF v_recovered <= 0 THEN
    RETURN v_lives;
  END IF;
  v_recovered := least(v_recovered, 5 - v_lives);

  INSERT INTO life_ledger (student_id, delta, reason, source_ref, lives_after)
  VALUES (p_student_id, v_recovered, 'time_refill',
          to_char(v_anchor, 'YYYYMMDD"T"HH24MISS'), v_lives + v_recovered)
  ON CONFLICT (student_id, reason, source_ref) DO NOTHING;

  UPDATE student_lives
  SET lives = v_lives + v_recovered,
      refill_anchor_at = v_anchor + make_interval(secs => v_recovered * 1800),
      updated_at = CURRENT_TIMESTAMP
  WHERE student_id = p_student_id
  RETURNING lives INTO v_lives;

  RETURN v_lives;
END;
$$;

-- 誤答で 1 減らします。同じ source_ref では二度減りません。
CREATE OR REPLACE FUNCTION spend_life(p_student_id uuid, p_source_ref text)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_lives integer;
  v_inserted integer;
BEGIN
  v_lives := settle_life_refill(p_student_id);
  IF v_lives <= 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO life_ledger (student_id, delta, reason, source_ref, lives_after)
  VALUES (p_student_id, -1, 'wrong_answer', p_source_ref, v_lives - 1)
  ON CONFLICT (student_id, reason, source_ref) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN v_lives;
  END IF;

  UPDATE student_lives
  SET lives = v_lives - 1,
      -- 満タンから減った瞬間に回復の時計を動かし始めます。
      refill_anchor_at = CASE WHEN v_lives = 5 THEN CURRENT_TIMESTAMP ELSE refill_anchor_at END,
      updated_at = CURRENT_TIMESTAMP
  WHERE student_id = p_student_id
  RETURNING lives INTO v_lives;

  RETURN v_lives;
END;
$$;

-- 復習上限（P0-11a）。新規は 20、それ以降は 60。
-- 「新規」の境目は完了セッション 7 回未満とし、値は本関数だけで管理します。
CREATE OR REPLACE FUNCTION daily_review_cap(p_student_id uuid)
RETURNS integer LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_completed integer;
BEGIN
  SELECT count(*)::int INTO v_completed
  FROM daily_sessions
  WHERE student_id = p_student_id AND status = 'completed';
  RETURN CASE WHEN v_completed < 7 THEN 20 ELSE 60 END;
END;
$$;

COMMENT ON FUNCTION daily_review_cap(uuid) IS
  'PRD: new learners may review at most 20 items a day, established learners 60. The boundary of seven completed sessions is a working default and needs product confirmation.';
