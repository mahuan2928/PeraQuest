-- 習熟度と復習間隔を切り離します。
-- 0010 では due_at が mastery_score から導かれていたため、
-- 「点が低い → 毎日出る → 点が動かない」という閉じた輪から出られませんでした。
--
--   習熟度  = 直近 8 回の作答（いま何ができるか）
--   復習間隔 = 実際に耐えた間隔の段位（どれだけ持つか）
--
-- 判定材料は追記専用の 2 つの台帳（knowledge_evidence / daily_answers）だけなので、
-- 履歴からいつでも再計算できます。

ALTER TABLE users ADD COLUMN exam_date date;
COMMENT ON COLUMN users.exam_date IS
  'Target Eiken sitting. Null until onboarding asks for it; the schedule squeeze only applies once it is known.';

ALTER TABLE student_knowledge
  ADD COLUMN window_correct integer NOT NULL DEFAULT 0 CHECK (window_correct >= 0),
  ADD COLUMN window_size integer NOT NULL DEFAULT 0 CHECK (window_size BETWEEN 0 AND 8),
  ADD COLUMN ladder_step integer NOT NULL DEFAULT 0 CHECK (ladder_step BETWEEN 0 AND 5),
  ADD CONSTRAINT student_knowledge_window_shape_chk CHECK (window_correct <= window_size);

-- 4 回未満は判定しません。まぐれ当たりで「習得」を名乗らせないためです。
ALTER TABLE student_knowledge DROP CONSTRAINT student_knowledge_state_check;
ALTER TABLE student_knowledge
  ADD CONSTRAINT student_knowledge_state_check
  CHECK (state IN ('unassessed', 'learning', 'review', 'mastered'));

-- 直近 8 回。2 つの台帳にまたがるので UNION で見ます。
-- 時間切れは知識の誤りではないので母数に入れません。
CREATE OR REPLACE FUNCTION knowledge_recent_window(p_student_id uuid, p_knowledge_point_ref text)
RETURNS TABLE (window_correct integer, window_size integer, last_occurred_at timestamptz)
LANGUAGE sql STABLE AS $$
  WITH history AS (
    SELECT occurred_at, (outcome = 'correct') AS correct
    FROM knowledge_evidence
    WHERE student_id = p_student_id AND knowledge_point_ref = p_knowledge_point_ref
    UNION ALL
    SELECT occurred_at, (outcome = 'correct') AS correct
    FROM daily_answers
    WHERE student_id = p_student_id AND knowledge_point_ref = p_knowledge_point_ref
      AND timed_out = false
  ),
  recent AS (
    SELECT * FROM history ORDER BY occurred_at DESC LIMIT 8
  )
  SELECT count(*) FILTER (WHERE correct)::int, count(*)::int, max(occurred_at)
  FROM recent;
$$;

-- 3 択なので当てずっぽうでも 1/3 は当たります。8 回中 7 回を偶然で通す確率は 0.26%。
-- 「習得」は満窓（8 回）でのみ名乗れます。窓が満ちていれば 1 問落としても
-- 7/8 = 0.875 で維持され、2 問落として初めて下がります。跳ねないことが目的です。
CREATE OR REPLACE FUNCTION calculate_knowledge_state(
  p_window_correct integer,
  p_window_size integer,
  p_ladder_step integer
)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_accuracy numeric;
BEGIN
  IF p_window_size < 4 THEN
    RETURN 'unassessed';
  END IF;
  v_accuracy := p_window_correct::numeric / p_window_size;
  IF v_accuracy < 0.625 THEN
    RETURN 'learning';
  END IF;
  -- 正答率だけでは足りません。実際の間隔を越えられたことも要求します。
  IF p_window_size = 8 AND v_accuracy >= 0.85 AND p_ladder_step >= 3 THEN
    RETURN 'mastered';
  END IF;
  RETURN 'review';
END;
$$;

CREATE OR REPLACE FUNCTION knowledge_ladder_days(p_ladder_step integer)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT (ARRAY[1, 2, 4, 7, 14, 30])[greatest(0, least(p_ladder_step, 5)) + 1];
$$;

-- 段位は履歴の畳み込みです。正解しただけでは上がらず、
-- 「その段の間隔の 6 割以上あけて正解した」ときにだけ上がります。
-- 毎日連続で解いただけの人が 30 日間隔に到達しないようにするためです。
CREATE OR REPLACE FUNCTION calculate_knowledge_ladder_step(p_student_id uuid, p_knowledge_point_ref text)
RETURNS integer LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_step integer := 0;
  v_previous timestamptz;
  v_wrong_streak integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT occurred_at, correct FROM (
      SELECT occurred_at, (outcome = 'correct') AS correct
      FROM knowledge_evidence
      WHERE student_id = p_student_id AND knowledge_point_ref = p_knowledge_point_ref
      UNION ALL
      SELECT occurred_at, (outcome = 'correct') AS correct
      FROM daily_answers
      WHERE student_id = p_student_id AND knowledge_point_ref = p_knowledge_point_ref
        AND timed_out = false
    ) AS history
    ORDER BY occurred_at
  LOOP
    IF r.correct THEN
      v_wrong_streak := 0;
      IF v_previous IS NOT NULL
         AND extract(epoch FROM (r.occurred_at - v_previous)) >= 0.6 * knowledge_ladder_days(v_step) * 86400 THEN
        v_step := least(v_step + 1, 5);
      END IF;
    ELSE
      v_wrong_streak := v_wrong_streak + 1;
      v_step := greatest(v_step - 2, 0);
      IF v_wrong_streak >= 2 THEN
        v_step := 0;
      END IF;
    END IF;
    v_previous := r.occurred_at;
  END LOOP;
  RETURN v_step;
END;
$$;

-- 状態は段位の上限だけを決めます。間隔そのものは段位が決めます。
CREATE OR REPLACE FUNCTION calculate_knowledge_due_at(
  p_last_occurred_at timestamptz,
  p_state text,
  p_ladder_step integer,
  p_exam_date date
)
RETURNS timestamptz LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_cap integer;
  v_days integer;
  v_remaining integer;
BEGIN
  v_cap := CASE p_state
    WHEN 'unassessed' THEN 0
    WHEN 'learning' THEN 1
    WHEN 'review' THEN 3
    ELSE 5
  END;
  v_days := knowledge_ladder_days(least(p_ladder_step, v_cap));

  IF p_exam_date IS NOT NULL THEN
    -- 受験日が近づくほど間隔を半分に詰め、当日までに必ず数回触れるようにします。
    v_remaining := (p_exam_date - (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo')::date);
    IF v_remaining > 0 THEN
      v_days := least(v_days, greatest(1, ceil(v_remaining / 2.0)::int));
    END IF;
    -- 30 日間隔の項目が試験の後ろに飛ばないよう、3 日前で打ち止めます。
    RETURN least(
      p_last_occurred_at + make_interval(days => v_days),
      (p_exam_date - 3)::timestamptz
    );
  END IF;

  RETURN p_last_occurred_at + make_interval(days => v_days);
END;
$$;

-- 投影は台帳から導出します。比較ではなく代入にすることで、
-- アプリが偽の値を書けないことと、関数と投影がずれないことを同時に保証します。
CREATE OR REPLACE FUNCTION enforce_student_knowledge_write()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_window record;
  v_exam_date date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'student knowledge projections are append-only by evidence and cannot be deleted' USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.student_id IS DISTINCT FROM OLD.student_id OR
    NEW.knowledge_point_ref IS DISTINCT FROM OLD.knowledge_point_ref OR
    NEW.created_at IS DISTINCT FROM OLD.created_at OR
    NEW.raw_correct_total < OLD.raw_correct_total OR
    NEW.raw_attempt_total < OLD.raw_attempt_total
  ) THEN
    RAISE EXCEPTION 'student knowledge identity and raw totals are immutable except monotonic evidence application' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_window FROM knowledge_recent_window(NEW.student_id, NEW.knowledge_point_ref);
  IF v_window.window_size IS NULL OR v_window.window_size = 0 THEN
    RAISE EXCEPTION 'student knowledge requires at least one recorded answer' USING ERRCODE = '23514';
  END IF;
  SELECT exam_date INTO v_exam_date FROM users WHERE id = NEW.student_id;

  NEW.window_correct := v_window.window_correct;
  NEW.window_size := v_window.window_size;
  NEW.last_occurred_at := v_window.last_occurred_at;
  NEW.ladder_step := calculate_knowledge_ladder_step(NEW.student_id, NEW.knowledge_point_ref);
  NEW.mastery_score := round(v_window.window_correct::numeric / v_window.window_size, 6);
  NEW.state := calculate_knowledge_state(NEW.window_correct, NEW.window_size, NEW.ladder_step);
  NEW.due_at := calculate_knowledge_due_at(NEW.last_occurred_at, NEW.state, NEW.ladder_step, v_exam_date);
  NEW.updated_at := greatest(CURRENT_TIMESTAMP, COALESCE(OLD.updated_at, CURRENT_TIMESTAMP));
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := CURRENT_TIMESTAMP;
    NEW.updated_at := CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION calculate_knowledge_state(integer, integer, integer) IS
  'Mastery over the last eight answers. Four answers are needed before any state is claimed, and mastered needs a full window plus evidence that a real interval was survived.';

-- 適用関数は生の累計と適用済み台帳だけを面倒みます。
-- 習熟度・状態・次回予定はトリガが台帳から導出するので、ここでは計算しません。
CREATE OR REPLACE FUNCTION apply_stage_attempt_mastery_due(p_attempt_id uuid, p_student_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_evidence_count integer;
  v_pending_count integer;
  v_knowledge_point_ref text;
BEGIN
  SELECT count(*)::int INTO v_evidence_count
  FROM knowledge_evidence
  WHERE attempt_id = p_attempt_id AND student_id = p_student_id;
  IF v_evidence_count = 0 THEN
    RAISE EXCEPTION 'mastery update requires knowledge evidence for the submitted attempt' USING ERRCODE = '23514';
  END IF;

  FOR v_knowledge_point_ref IN
    SELECT DISTINCT ev.knowledge_point_ref
    FROM knowledge_evidence ev
    LEFT JOIN student_knowledge_applied_evidence applied ON applied.evidence_id = ev.id
    WHERE ev.attempt_id = p_attempt_id AND ev.student_id = p_student_id AND applied.evidence_id IS NULL
    ORDER BY ev.knowledge_point_ref
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext(p_student_id::text), hashtext(v_knowledge_point_ref));
  END LOOP;

  SELECT count(*)::int INTO v_pending_count
  FROM knowledge_evidence ev
  LEFT JOIN student_knowledge_applied_evidence applied ON applied.evidence_id = ev.id
  WHERE ev.attempt_id = p_attempt_id AND ev.student_id = p_student_id AND applied.evidence_id IS NULL;
  IF v_pending_count = 0 THEN
    RETURN;
  END IF;

  INSERT INTO student_knowledge
    (student_id, knowledge_point_ref, raw_correct_total, raw_attempt_total,
     mastery_score, state, last_occurred_at, due_at)
  SELECT student_id, knowledge_point_ref,
         sum(earned_score)::numeric(12,6), sum(max_score)::numeric(12,6),
         0, 'unassessed', max(occurred_at), max(occurred_at)
  FROM knowledge_evidence ev
  WHERE ev.attempt_id = p_attempt_id AND ev.student_id = p_student_id
    AND NOT EXISTS (SELECT 1 FROM student_knowledge_applied_evidence a WHERE a.evidence_id = ev.id)
  GROUP BY student_id, knowledge_point_ref
  ON CONFLICT (student_id, knowledge_point_ref) DO UPDATE
  SET raw_correct_total = student_knowledge.raw_correct_total + EXCLUDED.raw_correct_total,
      raw_attempt_total = student_knowledge.raw_attempt_total + EXCLUDED.raw_attempt_total;

  INSERT INTO student_knowledge_applied_evidence (evidence_id, student_id, knowledge_point_ref)
  SELECT id, student_id, knowledge_point_ref
  FROM knowledge_evidence
  WHERE attempt_id = p_attempt_id AND student_id = p_student_id
  ON CONFLICT (evidence_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION apply_daily_session_mastery_due(p_session_id uuid, p_student_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_pending integer;
  v_knowledge_point_ref text;
BEGIN
  FOR v_knowledge_point_ref IN
    SELECT DISTINCT da.knowledge_point_ref
    FROM daily_answers da
    LEFT JOIN student_knowledge_applied_daily_answers applied ON applied.answer_id = da.id
    WHERE da.session_id = p_session_id AND da.student_id = p_student_id
      AND da.timed_out = false AND applied.answer_id IS NULL
    ORDER BY da.knowledge_point_ref
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext(p_student_id::text), hashtext(v_knowledge_point_ref));
  END LOOP;

  SELECT count(*)::int INTO v_pending
  FROM daily_answers da
  LEFT JOIN student_knowledge_applied_daily_answers applied ON applied.answer_id = da.id
  WHERE da.session_id = p_session_id AND da.student_id = p_student_id
    AND da.timed_out = false AND applied.answer_id IS NULL;
  IF v_pending = 0 THEN
    RETURN;
  END IF;

  INSERT INTO student_knowledge
    (student_id, knowledge_point_ref, raw_correct_total, raw_attempt_total,
     mastery_score, state, last_occurred_at, due_at)
  SELECT student_id, knowledge_point_ref,
         sum(earned_score)::numeric(12,6), sum(max_score)::numeric(12,6),
         0, 'unassessed', max(occurred_at), max(occurred_at)
  FROM daily_answers da
  WHERE da.session_id = p_session_id AND da.student_id = p_student_id AND da.timed_out = false
    AND NOT EXISTS (SELECT 1 FROM student_knowledge_applied_daily_answers a WHERE a.answer_id = da.id)
  GROUP BY student_id, knowledge_point_ref
  ON CONFLICT (student_id, knowledge_point_ref) DO UPDATE
  SET raw_correct_total = student_knowledge.raw_correct_total + EXCLUDED.raw_correct_total,
      raw_attempt_total = student_knowledge.raw_attempt_total + EXCLUDED.raw_attempt_total;

  INSERT INTO student_knowledge_applied_daily_answers (answer_id, student_id, knowledge_point_ref)
  SELECT da.id, da.student_id, da.knowledge_point_ref
  FROM daily_answers da
  WHERE da.session_id = p_session_id AND da.student_id = p_student_id AND da.timed_out = false
  ON CONFLICT (answer_id) DO NOTHING;
END;
$$;

-- 旧モデルの関数を残すと、名前が近いだけの別の閾値が並ぶことになります。
-- 0018 の適用関数は上で置き換え済みなので、参照は残っていません。
DROP FUNCTION IF EXISTS calculate_student_knowledge_due_at(timestamptz, numeric);
DROP FUNCTION IF EXISTS calculate_student_knowledge_state(numeric);
DROP FUNCTION IF EXISTS calculate_student_knowledge_mastery(numeric, numeric);
