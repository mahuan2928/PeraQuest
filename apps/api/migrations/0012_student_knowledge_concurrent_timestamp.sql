CREATE OR REPLACE FUNCTION enforce_student_knowledge_write()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_mastery_score numeric(7,6);
  v_state text;
  v_due_at timestamptz;
  v_expected_updated_at timestamptz;
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

  v_mastery_score := calculate_student_knowledge_mastery(NEW.raw_correct_total, NEW.raw_attempt_total);
  v_state := calculate_student_knowledge_state(v_mastery_score);
  v_due_at := calculate_student_knowledge_due_at(NEW.last_occurred_at, v_mastery_score);

  IF NEW.mastery_score IS DISTINCT FROM v_mastery_score OR
     NEW.state IS DISTINCT FROM v_state OR
     NEW.due_at IS DISTINCT FROM v_due_at THEN
    RAISE EXCEPTION 'student knowledge projection must match approved mastery and due rules' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.created_at IS DISTINCT FROM CURRENT_TIMESTAMP OR NEW.updated_at IS DISTINCT FROM CURRENT_TIMESTAMP THEN
      RAISE EXCEPTION 'student knowledge creation must use database current time' USING ERRCODE = '23514';
    END IF;
  ELSE
    v_expected_updated_at := greatest(CURRENT_TIMESTAMP, OLD.updated_at);
    IF NEW.updated_at IS DISTINCT FROM v_expected_updated_at THEN
      RAISE EXCEPTION 'student knowledge updates must use monotonic database time' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION apply_stage_attempt_mastery_due(p_attempt_id uuid, p_student_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_evidence_count integer;
  v_pending_count integer;
  v_knowledge_point_ref text;
BEGIN
  SELECT count(*)::int INTO v_evidence_count
  FROM knowledge_evidence
  WHERE attempt_id = p_attempt_id
    AND student_id = p_student_id;
  IF v_evidence_count = 0 THEN
    RAISE EXCEPTION 'mastery update requires knowledge evidence for the submitted attempt' USING ERRCODE = '23514';
  END IF;

  FOR v_knowledge_point_ref IN
    SELECT DISTINCT ev.knowledge_point_ref
    FROM knowledge_evidence ev
    LEFT JOIN student_knowledge_applied_evidence applied ON applied.evidence_id = ev.id
    WHERE ev.attempt_id = p_attempt_id
      AND ev.student_id = p_student_id
      AND applied.evidence_id IS NULL
    ORDER BY ev.knowledge_point_ref
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext(p_student_id::text), hashtext(v_knowledge_point_ref));
  END LOOP;

  SELECT count(*)::int INTO v_pending_count
  FROM knowledge_evidence ev
  LEFT JOIN student_knowledge_applied_evidence applied ON applied.evidence_id = ev.id
  WHERE ev.attempt_id = p_attempt_id
    AND ev.student_id = p_student_id
    AND applied.evidence_id IS NULL;

  IF v_pending_count = 0 THEN
    RETURN;
  END IF;

  WITH pending AS (
    SELECT ev.*
    FROM knowledge_evidence ev
    LEFT JOIN student_knowledge_applied_evidence applied ON applied.evidence_id = ev.id
    WHERE ev.attempt_id = p_attempt_id
      AND ev.student_id = p_student_id
      AND applied.evidence_id IS NULL
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
         calculate_student_knowledge_due_at(
           occurred_at,
           calculate_student_knowledge_mastery(earned_delta, attempt_delta)
         )
  FROM grouped
  ON CONFLICT (student_id, knowledge_point_ref) DO UPDATE
  SET raw_correct_total = student_knowledge.raw_correct_total + EXCLUDED.raw_correct_total,
      raw_attempt_total = student_knowledge.raw_attempt_total + EXCLUDED.raw_attempt_total,
      mastery_score = calculate_student_knowledge_mastery(
        student_knowledge.raw_correct_total + EXCLUDED.raw_correct_total,
        student_knowledge.raw_attempt_total + EXCLUDED.raw_attempt_total
      ),
      state = calculate_student_knowledge_state(calculate_student_knowledge_mastery(
        student_knowledge.raw_correct_total + EXCLUDED.raw_correct_total,
        student_knowledge.raw_attempt_total + EXCLUDED.raw_attempt_total
      )),
      last_occurred_at = greatest(student_knowledge.last_occurred_at, EXCLUDED.last_occurred_at),
      due_at = calculate_student_knowledge_due_at(
        greatest(student_knowledge.last_occurred_at, EXCLUDED.last_occurred_at),
        calculate_student_knowledge_mastery(
          student_knowledge.raw_correct_total + EXCLUDED.raw_correct_total,
          student_knowledge.raw_attempt_total + EXCLUDED.raw_attempt_total
        )
      ),
      updated_at = greatest(CURRENT_TIMESTAMP, student_knowledge.updated_at);

  INSERT INTO student_knowledge_applied_evidence
    (evidence_id, student_id, knowledge_point_ref)
  SELECT ev.id, ev.student_id, ev.knowledge_point_ref
  FROM knowledge_evidence ev
  LEFT JOIN student_knowledge_applied_evidence applied ON applied.evidence_id = ev.id
  WHERE ev.attempt_id = p_attempt_id
    AND ev.student_id = p_student_id
    AND applied.evidence_id IS NULL;
END;
$$;
