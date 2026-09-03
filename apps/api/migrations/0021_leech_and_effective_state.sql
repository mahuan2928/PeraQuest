-- 0021: leech（連続でつまずく項目）と、読み取り時に効く「証拠の鮮度」。
--
-- この 2 つは性質が違うので、置き場所も分けます。
--   leech は台帳から導出でき、時間が経っても答えが変わりません → 列にして書き込み時に確定。
--   鮮度は now() の関数です。投影は次に答えたときにしか書き換わらないのに、
--   期限切れは「答える前に」出題したいものなので、保存すると必ず手遅れになります
--   → 何も保存せず、読み取り側の関数で被せます。
--
-- 新規知識ポイントの投入上限はキューの組み立て方であって不変条件ではないので、
-- ここではなく startDailySession の問い合わせ側に置いています。

ALTER TABLE student_knowledge
  ADD COLUMN leech boolean NOT NULL DEFAULT false;

-- 「3 セッション連続の誤答」を、学習した日単位で判定します。
-- 一度の座学で 3 回間違えたのは 3 回の失敗ではなく 1 回の悪い日なので、
-- 同じ日の答えはまとめ、直近 3 日ぶんが全滅したときだけ leech とします。
CREATE OR REPLACE FUNCTION knowledge_is_leech(p_student_id uuid, p_knowledge_point_ref text)
RETURNS boolean LANGUAGE sql STABLE AS $$
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
  by_day AS (
    SELECT (occurred_at AT TIME ZONE 'Asia/Tokyo')::date AS study_date, bool_or(correct) AS any_correct
    FROM history
    GROUP BY 1
  ),
  recent AS (
    SELECT any_correct FROM by_day ORDER BY study_date DESC LIMIT 3
  )
  SELECT count(*) = 3 AND bool_and(NOT any_correct) FROM recent;
$$;

-- 引数を増やすと CREATE OR REPLACE は「置き換え」ではなく「多重定義」になり、
-- トリガの 4 引数呼び出しは古い本体に解決され続けます。明示的に消します。
DROP FUNCTION IF EXISTS calculate_knowledge_due_at(timestamptz, text, integer, date);

CREATE FUNCTION calculate_knowledge_due_at(
  p_last_occurred_at timestamptz,
  p_state text,
  p_ladder_step integer,
  p_exam_date date,
  p_leech boolean
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
  END IF;

  -- leech は下限です。上限ではありません。
  -- つまずいている項目は learning に落ちて毎日出題されますが、同じ問題を 4 日続けて外すのは
  -- 学習ではなく消耗なので、間隔を広げていったん手を離し、教え直し導線に渡します。
  -- 受験直前の詰め込みより優先します（詰め込んでも当たらない項目だからです）。
  IF p_leech THEN
    v_days := greatest(v_days, 3);
  END IF;

  IF p_exam_date IS NOT NULL THEN
    -- 30 日間隔の項目が試験の後ろに飛ばないよう、3 日前で打ち止めます。
    RETURN least(
      p_last_occurred_at + make_interval(days => v_days),
      (p_exam_date - 3)::timestamptz
    );
  END IF;

  RETURN p_last_occurred_at + make_interval(days => v_days);
END;
$$;

-- 鮮度の判定。習得と名乗っている項目にだけ効きます。
--   45 日検証されていない、または
--   試験まで 14 日を切っていて直近 14 日に検証がない。
-- 忘却曲線をモデル化しているのではなく、古い証拠を信じないだけです。
CREATE OR REPLACE FUNCTION knowledge_is_stale(
  p_state text,
  p_last_occurred_at timestamptz,
  p_exam_date date
)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_state = 'mastered'
     AND p_last_occurred_at IS NOT NULL
     AND (
       p_last_occurred_at < CURRENT_TIMESTAMP - interval '45 days'
       OR (
         p_exam_date IS NOT NULL
         AND p_exam_date - (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo')::date BETWEEN 0 AND 14
         AND p_last_occurred_at < CURRENT_TIMESTAMP - interval '14 days'
       )
     );
$$;

-- 読み取り側はこの 2 つだけを使ってください。
-- 出題キュー・保護者画面・滞留の判定が同じ述語を見ることが大事で、
-- 問い合わせに now() の条件を直書きすると必ずどれかがずれます。
CREATE OR REPLACE FUNCTION knowledge_effective_state(
  p_state text,
  p_last_occurred_at timestamptz,
  p_exam_date date
)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN knowledge_is_stale(p_state, p_last_occurred_at, p_exam_date) THEN 'review' ELSE p_state END;
$$;

CREATE OR REPLACE FUNCTION knowledge_effective_due_at(
  p_due_at timestamptz,
  p_state text,
  p_last_occurred_at timestamptz,
  p_exam_date date
)
RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN knowledge_is_stale(p_state, p_last_occurred_at, p_exam_date) THEN least(p_due_at, CURRENT_TIMESTAMP)
    ELSE p_due_at
  END;
$$;

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
  NEW.leech := knowledge_is_leech(NEW.student_id, NEW.knowledge_point_ref);
  NEW.mastery_score := round(v_window.window_correct::numeric / v_window.window_size, 6);
  NEW.state := calculate_knowledge_state(NEW.window_correct, NEW.window_size, NEW.ladder_step);
  NEW.due_at := calculate_knowledge_due_at(NEW.last_occurred_at, NEW.state, NEW.ladder_step, v_exam_date, NEW.leech);
  NEW.updated_at := greatest(CURRENT_TIMESTAMP, COALESCE(OLD.updated_at, CURRENT_TIMESTAMP));
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := CURRENT_TIMESTAMP;
    NEW.updated_at := CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON COLUMN student_knowledge.leech IS
  'Three consecutive study days on this point with no correct answer. Derived from the ledgers on write; widens the interval and hands the point to reteaching instead of drilling it again.';
COMMENT ON FUNCTION knowledge_is_stale(text, timestamptz, date) IS
  'Read-time only. Staleness depends on now(), and the projection is only rewritten when the student answers, so storing it would always demote one answer too late.';
