-- 毎日ループを報酬台帳と習熟度に接続します。
-- 0017 までは日次の学習が XP・コイン・復習期日のどれにも反映されず、
-- 「毎日やっても何も動かない」状態でした。

-- 1) 報酬台帳が日次セッションを表現できるようにする
ALTER TABLE game_reward_ledger DROP CONSTRAINT game_reward_ledger_source_type_check;
ALTER TABLE game_reward_ledger
  ADD CONSTRAINT game_reward_ledger_source_type_check
  CHECK (source_type IN ('stage_attempt', 'guardian_verification', 'daily_session'));

ALTER TABLE game_reward_ledger DROP CONSTRAINT game_reward_ledger_reason_check;
ALTER TABLE game_reward_ledger
  ADD CONSTRAINT game_reward_ledger_reason_check
  CHECK (reason IN ('stage_attempt_passed', 'stage_attempt_completed', 'guardian_link_verified', 'daily_session_completed'));

-- 2) 日次解答の習熟度反映。stage attempt 側と同じく、二重計上を別台帳で防ぎます。
CREATE TABLE student_knowledge_applied_daily_answers (
  answer_id uuid PRIMARY KEY REFERENCES daily_answers(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL,
  knowledge_point_ref text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT student_knowledge_applied_daily_projection_fk
    FOREIGN KEY (student_id, knowledge_point_ref)
    REFERENCES student_knowledge(student_id, knowledge_point_ref)
    ON DELETE RESTRICT
);

CREATE INDEX student_knowledge_applied_daily_student_idx
  ON student_knowledge_applied_daily_answers(student_id, knowledge_point_ref, applied_at);

CREATE OR REPLACE FUNCTION reject_student_knowledge_applied_daily_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'applied daily answers ledger is append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER student_knowledge_applied_daily_mutation_trg
BEFORE UPDATE OR DELETE ON student_knowledge_applied_daily_answers
FOR EACH ROW EXECUTE FUNCTION reject_student_knowledge_applied_daily_mutation();
CREATE TRIGGER student_knowledge_applied_daily_truncate_trg
BEFORE TRUNCATE ON student_knowledge_applied_daily_answers
FOR EACH STATEMENT EXECUTE FUNCTION reject_student_knowledge_applied_daily_mutation();

-- タイムアウトは知識の誤りではないため、習熟度の母数にも入れません（P0-13）。
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

  WITH pending AS (
    SELECT da.*
    FROM daily_answers da
    LEFT JOIN student_knowledge_applied_daily_answers applied ON applied.answer_id = da.id
    WHERE da.session_id = p_session_id AND da.student_id = p_student_id
      AND da.timed_out = false AND applied.answer_id IS NULL
  ),
  grouped AS (
    SELECT student_id, knowledge_point_ref,
           sum(earned_score)::numeric(12,6) AS earned_delta,
           sum(max_score)::numeric(12,6) AS attempt_delta,
           max(occurred_at) AS occurred_at
    FROM pending
    GROUP BY student_id, knowledge_point_ref
  )
  INSERT INTO student_knowledge
    (student_id, knowledge_point_ref, raw_correct_total, raw_attempt_total,
     mastery_score, state, last_occurred_at, due_at)
  SELECT student_id, knowledge_point_ref, earned_delta, attempt_delta,
         calculate_student_knowledge_mastery(earned_delta, attempt_delta),
         calculate_student_knowledge_state(calculate_student_knowledge_mastery(earned_delta, attempt_delta)),
         occurred_at,
         calculate_student_knowledge_due_at(occurred_at, calculate_student_knowledge_mastery(earned_delta, attempt_delta))
  FROM grouped
  ON CONFLICT (student_id, knowledge_point_ref) DO UPDATE
  SET raw_correct_total = student_knowledge.raw_correct_total + EXCLUDED.raw_correct_total,
      raw_attempt_total = student_knowledge.raw_attempt_total + EXCLUDED.raw_attempt_total,
      mastery_score = calculate_student_knowledge_mastery(
        student_knowledge.raw_correct_total + EXCLUDED.raw_correct_total,
        student_knowledge.raw_attempt_total + EXCLUDED.raw_attempt_total),
      state = calculate_student_knowledge_state(calculate_student_knowledge_mastery(
        student_knowledge.raw_correct_total + EXCLUDED.raw_correct_total,
        student_knowledge.raw_attempt_total + EXCLUDED.raw_attempt_total)),
      last_occurred_at = greatest(student_knowledge.last_occurred_at, EXCLUDED.last_occurred_at),
      due_at = calculate_student_knowledge_due_at(
        greatest(student_knowledge.last_occurred_at, EXCLUDED.last_occurred_at),
        calculate_student_knowledge_mastery(
          student_knowledge.raw_correct_total + EXCLUDED.raw_correct_total,
          student_knowledge.raw_attempt_total + EXCLUDED.raw_attempt_total)),
      updated_at = greatest(CURRENT_TIMESTAMP, student_knowledge.updated_at);

  INSERT INTO student_knowledge_applied_daily_answers (answer_id, student_id, knowledge_point_ref)
  SELECT da.id, da.student_id, da.knowledge_point_ref
  FROM daily_answers da
  WHERE da.session_id = p_session_id AND da.student_id = p_student_id AND da.timed_out = false
  ON CONFLICT (answer_id) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION apply_daily_session_mastery_due(uuid, uuid) IS
  'Folds a daily session answers into student_knowledge using the same calculate_* rules as stage attempts. Timed-out answers are excluded so running out of time is never recorded as not knowing the answer.';
