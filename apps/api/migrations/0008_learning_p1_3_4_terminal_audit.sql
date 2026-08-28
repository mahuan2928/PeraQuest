CREATE OR REPLACE FUNCTION enforce_learning_audit_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_attempt_status stage_attempt_status;
  v_started_at timestamptz;
  v_submitted_at timestamptz;
  v_expired_at timestamptz;
  v_score numeric(20,12);
  v_passed boolean;
  v_actor_role user_role;
BEGIN
  SELECT status, started_at, submitted_at, expired_at, score, passed
    INTO v_attempt_status, v_started_at, v_submitted_at, v_expired_at, v_score, v_passed
  FROM stage_attempts
  WHERE id = NEW.attempt_id AND student_id = NEW.student_id
  FOR KEY SHARE;

  IF v_started_at IS NULL THEN
    RAISE EXCEPTION 'learning audit attempt attribution is invalid' USING ERRCODE = '23514';
  END IF;

  IF NEW.event_type = 'attempt_started' THEN
    IF v_attempt_status <> 'open' OR NEW.occurred_at IS DISTINCT FROM v_started_at THEN
      RAISE EXCEPTION 'attempt_started must match an open attempt and its authoritative started_at' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.event_type = 'attempt_submitted' THEN
    IF v_attempt_status NOT IN ('passed', 'failed') OR
       v_submitted_at IS NULL OR
       v_expired_at IS NOT NULL OR
       v_score IS NULL OR
       v_passed IS NULL OR
       NEW.occurred_at IS DISTINCT FROM v_submitted_at THEN
      RAISE EXCEPTION 'attempt_submitted must match a submitted attempt and its authoritative submitted_at' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.event_type = 'attempt_expired' THEN
    IF v_attempt_status <> 'expired' OR
       v_expired_at IS NULL OR
       v_submitted_at IS NOT NULL OR
       v_score IS NOT NULL OR
       v_passed IS NOT NULL OR
       NEW.occurred_at IS DISTINCT FROM v_expired_at THEN
      RAISE EXCEPTION 'attempt_expired must match an expired attempt and its authoritative expired_at' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported learning audit event type' USING ERRCODE = '23514';
  END IF;

  SELECT role INTO v_actor_role
  FROM users
  WHERE id = NEW.actor_id AND deleted_at IS NULL
  FOR KEY SHARE;

  IF v_actor_role IS NULL OR NEW.actor_role IS DISTINCT FROM v_actor_role THEN
    RAISE EXCEPTION 'learning audit actor role snapshot is invalid' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM auth_identities
    WHERE user_id = NEW.actor_id
      AND provider = NEW.actor_auth_provider
      AND provider_subject = NEW.actor_provider_subject
  ) THEN
    RAISE EXCEPTION 'learning audit actor identity snapshot is invalid' USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (v_actor_role = 'student' AND NEW.actor_relationship = 'self' AND NEW.actor_id = NEW.student_id) OR
    (v_actor_role = 'guardian' AND NEW.actor_relationship = 'verified_guardian' AND EXISTS (
      SELECT 1
      FROM guardian_links
      WHERE guardian_id = NEW.actor_id
        AND student_id = NEW.student_id
        AND status = 'verified'
    )) OR
    (v_actor_role = 'admin' AND NEW.actor_relationship = 'admin')
  ) THEN
    RAISE EXCEPTION 'learning audit actor is not attributed to the target student and attempt' USING ERRCODE = '23514';
  END IF;

  IF NEW.recorded_at IS DISTINCT FROM CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'learning audit recorded_at must use database current time' USING ERRCODE = '23514';
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

  IF NEW.status = 'expired' THEN
    IF OLD.expires_at > CURRENT_TIMESTAMP THEN
      RAISE EXCEPTION 'stage attempts cannot expire before expires_at' USING ERRCODE = '23514';
    END IF;
    IF NEW.expired_at IS DISTINCT FROM CURRENT_TIMESTAMP OR
       NEW.updated_at IS DISTINCT FROM CURRENT_TIMESTAMP OR
       NEW.submitted_at IS NOT NULL OR
       NEW.score IS NOT NULL OR
       NEW.passed IS NOT NULL THEN
      RAISE EXCEPTION 'expired stage attempts must use database time and remain unscored' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
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
