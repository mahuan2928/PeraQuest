CREATE TABLE student_knowledge (
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  knowledge_point_ref text NOT NULL CHECK (btrim(knowledge_point_ref) <> ''),
  raw_correct_total numeric(12,6) NOT NULL CHECK (raw_correct_total >= 0),
  raw_attempt_total numeric(12,6) NOT NULL CHECK (raw_attempt_total > 0),
  mastery_score numeric(7,6) NOT NULL CHECK (mastery_score >= 0 AND mastery_score <= 1),
  state text NOT NULL CHECK (state IN ('learning', 'review', 'mastered')),
  last_occurred_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (student_id, knowledge_point_ref),
  CHECK (raw_correct_total <= raw_attempt_total),
  CHECK (updated_at >= created_at)
);
CREATE INDEX student_knowledge_due_idx
  ON student_knowledge(student_id, due_at);
CREATE INDEX student_knowledge_state_idx
  ON student_knowledge(student_id, state);

CREATE TABLE student_knowledge_applied_evidence (
  evidence_id uuid PRIMARY KEY REFERENCES knowledge_evidence(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL,
  knowledge_point_ref text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT student_knowledge_applied_projection_fk
    FOREIGN KEY (student_id, knowledge_point_ref)
    REFERENCES student_knowledge(student_id, knowledge_point_ref)
    ON DELETE RESTRICT
);
CREATE INDEX student_knowledge_applied_student_idx
  ON student_knowledge_applied_evidence(student_id, knowledge_point_ref, applied_at);

CREATE OR REPLACE FUNCTION calculate_student_knowledge_mastery(
  p_raw_correct_total numeric,
  p_raw_attempt_total numeric
)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_raw_attempt_total <= 0 THEN
    RAISE EXCEPTION 'student knowledge mastery requires positive attempt total' USING ERRCODE = '23514';
  END IF;
  RETURN round(p_raw_correct_total / p_raw_attempt_total, 6);
END;
$$;

CREATE OR REPLACE FUNCTION calculate_student_knowledge_state(p_mastery_score numeric)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_mastery_score < 0.600000 THEN
    RETURN 'learning';
  ELSIF p_mastery_score < 0.800000 THEN
    RETURN 'review';
  END IF;
  RETURN 'mastered';
END;
$$;

CREATE OR REPLACE FUNCTION calculate_student_knowledge_due_at(
  p_occurred_at timestamptz,
  p_mastery_score numeric
)
RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_mastery_score < 0.600000 THEN
    RETURN p_occurred_at + interval '1 day';
  ELSIF p_mastery_score < 0.800000 THEN
    RETURN p_occurred_at + interval '3 days';
  END IF;
  RETURN p_occurred_at + interval '14 days';
END;
$$;

CREATE OR REPLACE FUNCTION enforce_student_knowledge_write()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_mastery_score numeric(7,6);
  v_state text;
  v_due_at timestamptz;
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
  IF NEW.updated_at IS DISTINCT FROM CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'student knowledge updates must use database current time' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.created_at IS DISTINCT FROM CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'student knowledge creation must use database current time' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER student_knowledge_write_trg
BEFORE INSERT OR UPDATE OR DELETE ON student_knowledge
FOR EACH ROW EXECUTE FUNCTION enforce_student_knowledge_write();

CREATE OR REPLACE FUNCTION enforce_student_knowledge_applied_evidence_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM knowledge_evidence ev
    WHERE ev.id = NEW.evidence_id
      AND ev.student_id = NEW.student_id
      AND ev.knowledge_point_ref = NEW.knowledge_point_ref
  ) THEN
    RAISE EXCEPTION 'applied knowledge evidence must match the source evidence' USING ERRCODE = '23514';
  END IF;
  IF NEW.applied_at IS DISTINCT FROM CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'applied knowledge evidence time must use database current time' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER student_knowledge_applied_evidence_insert_trg
BEFORE INSERT ON student_knowledge_applied_evidence
FOR EACH ROW EXECUTE FUNCTION enforce_student_knowledge_applied_evidence_insert();

CREATE OR REPLACE FUNCTION reject_student_knowledge_applied_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'applied knowledge evidence ledger is append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER student_knowledge_applied_evidence_mutation_trg
BEFORE UPDATE OR DELETE ON student_knowledge_applied_evidence
FOR EACH ROW EXECUTE FUNCTION reject_student_knowledge_applied_evidence_mutation();
CREATE TRIGGER student_knowledge_applied_evidence_truncate_trg
BEFORE TRUNCATE ON student_knowledge_applied_evidence
FOR EACH STATEMENT EXECUTE FUNCTION reject_student_knowledge_applied_evidence_mutation();

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
      updated_at = CURRENT_TIMESTAMP;

  INSERT INTO student_knowledge_applied_evidence
    (evidence_id, student_id, knowledge_point_ref)
  SELECT id, student_id, knowledge_point_ref
  FROM knowledge_evidence
  WHERE attempt_id = p_attempt_id
    AND student_id = p_student_id
  ON CONFLICT (evidence_id) DO NOTHING;
END;
$$;
