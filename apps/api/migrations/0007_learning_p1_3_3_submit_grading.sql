CREATE TYPE stage_attempt_answer_outcome AS ENUM ('correct', 'incorrect', 'skipped');

ALTER TABLE stage_attempt_answers
  ADD COLUMN outcome stage_attempt_answer_outcome,
  ADD COLUMN earned_score numeric(12,6),
  ADD COLUMN max_score numeric(12,6),
  ADD COLUMN scored_at timestamptz;

UPDATE stage_attempt_answers answers
SET outcome = CASE
      WHEN answers.answer_status = 'skipped' THEN 'skipped'::stage_attempt_answer_outcome
      WHEN answers.selected_option_snapshot_id = keys.correct_option_snapshot_id THEN 'correct'::stage_attempt_answer_outcome
      ELSE 'incorrect'::stage_attempt_answer_outcome
    END,
    earned_score = CASE
      WHEN answers.answer_status = 'answered' AND answers.selected_option_snapshot_id = keys.correct_option_snapshot_id
        THEN items.max_score
      ELSE 0
    END,
    max_score = items.max_score,
    scored_at = answers.created_at
FROM stage_attempt_item_snapshots items
JOIN stage_attempt_answer_key_snapshots keys ON keys.item_snapshot_id = items.id
WHERE answers.item_snapshot_id = items.id;

ALTER TABLE stage_attempt_answers
  ALTER COLUMN outcome SET NOT NULL,
  ALTER COLUMN earned_score SET NOT NULL,
  ALTER COLUMN max_score SET NOT NULL,
  ALTER COLUMN scored_at SET NOT NULL,
  ADD CONSTRAINT stage_attempt_answers_score_shape_chk CHECK (
    max_score > 0 AND
    earned_score >= 0 AND
    earned_score <= max_score AND
    scored_at = created_at AND
    (
      (outcome = 'correct' AND answer_status = 'answered' AND earned_score = max_score) OR
      (outcome = 'incorrect' AND answer_status = 'answered' AND earned_score = 0) OR
      (outcome = 'skipped' AND answer_status = 'skipped' AND earned_score = 0)
    )
  );

CREATE OR REPLACE FUNCTION enforce_stage_attempt_answer_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_status stage_attempt_status;
  v_expires_at timestamptz;
  v_attempt_id uuid;
  v_max_score numeric(12,6);
  v_correct_option_snapshot_id uuid;
BEGIN
  SELECT a.status, a.expires_at INTO v_status, v_expires_at
  FROM stage_attempts a
  WHERE a.id = NEW.attempt_id
  FOR KEY SHARE;
  IF v_status IS NULL OR v_status <> 'open' THEN
    RAISE EXCEPTION 'stage attempt answers require an open attempt' USING ERRCODE = '23514';
  END IF;
  IF v_expires_at <= CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'stage attempt is expired' USING ERRCODE = '23514';
  END IF;
  IF NEW.answered_at IS DISTINCT FROM CURRENT_TIMESTAMP OR
     NEW.created_at IS DISTINCT FROM CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'stage attempt answer times must use database current time' USING ERRCODE = '23514';
  END IF;

  SELECT s.attempt_id, s.max_score, k.correct_option_snapshot_id
    INTO v_attempt_id, v_max_score, v_correct_option_snapshot_id
  FROM stage_attempt_item_snapshots s
  JOIN stage_attempt_answer_key_snapshots k ON k.item_snapshot_id = s.id
  WHERE s.id = NEW.item_snapshot_id;

  IF v_attempt_id IS DISTINCT FROM NEW.attempt_id THEN
    RAISE EXCEPTION 'stage attempt answer item does not belong to the attempt' USING ERRCODE = '23514';
  END IF;

  NEW.max_score := v_max_score;
  NEW.scored_at := CURRENT_TIMESTAMP;
  IF NEW.answer_status = 'skipped' THEN
    NEW.outcome := 'skipped';
    NEW.earned_score := 0;
  ELSIF NEW.selected_option_snapshot_id = v_correct_option_snapshot_id THEN
    NEW.outcome := 'correct';
    NEW.earned_score := v_max_score;
  ELSE
    NEW.outcome := 'incorrect';
    NEW.earned_score := 0;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_stage_attempt_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_item_count integer;
  v_answer_count integer;
  v_earned_score numeric(12,6);
  v_max_score numeric(12,6);
  v_score numeric(12,6);
  v_pass_score numeric(5,4);
  v_passed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stage attempts are immutable after creation' USING ERRCODE = '55000';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id OR
     NEW.student_id IS DISTINCT FROM OLD.student_id OR
     NEW.exam_version_id IS DISTINCT FROM OLD.exam_version_id OR
     NEW.mode IS DISTINCT FROM OLD.mode OR
     NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash OR
     NEW.snapshot_created_at IS DISTINCT FROM OLD.snapshot_created_at OR
     NEW.started_at IS DISTINCT FROM OLD.started_at OR
     NEW.expires_at IS DISTINCT FROM OLD.expires_at OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'stage attempt identity is immutable' USING ERRCODE = '55000';
  END IF;

  IF OLD.status <> 'open' THEN
    RAISE EXCEPTION 'terminal stage attempts are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.expires_at <= CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'expired stage attempts cannot be submitted' USING ERRCODE = '23514';
  END IF;

  IF NEW.status NOT IN ('passed', 'failed') THEN
    RAISE EXCEPTION 'stage attempt terminal transitions require P1.3 grading runtime' USING ERRCODE = '23514';
  END IF;

  IF NEW.submitted_at IS DISTINCT FROM CURRENT_TIMESTAMP OR
     NEW.updated_at IS DISTINCT FROM CURRENT_TIMESTAMP OR
     NEW.expired_at IS NOT NULL OR
     NEW.score IS NULL OR
     NEW.passed IS NULL THEN
    RAISE EXCEPTION 'submitted stage attempts must use database time and grading fields' USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::int, coalesce(sum(max_score), 0)
    INTO v_item_count, v_max_score
  FROM stage_attempt_item_snapshots
  WHERE attempt_id = OLD.id;

  SELECT count(*)::int, coalesce(sum(earned_score), 0), coalesce(sum(max_score), 0)
    INTO v_answer_count, v_earned_score, v_max_score
  FROM stage_attempt_answers
  WHERE attempt_id = OLD.id;

  IF v_item_count = 0 OR v_answer_count <> v_item_count OR v_max_score <= 0 THEN
    RAISE EXCEPTION 'stage attempt submission requires exactly one scored answer per item' USING ERRCODE = '23514';
  END IF;

  SELECT pass_score INTO v_pass_score
  FROM stage_exam_versions
  WHERE id = OLD.exam_version_id;
  v_score := round(v_earned_score / v_max_score, 6);
  v_passed := v_score >= v_pass_score;

  IF NEW.score IS DISTINCT FROM v_score OR NEW.passed IS DISTINCT FROM v_passed THEN
    RAISE EXCEPTION 'stage attempt score must match scored answers' USING ERRCODE = '23514';
  END IF;
  IF (v_passed AND NEW.status <> 'passed') OR ((NOT v_passed) AND NEW.status <> 'failed') THEN
    RAISE EXCEPTION 'stage attempt status must match pass threshold' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
