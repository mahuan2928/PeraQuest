ALTER TABLE stage_exam_items
  ADD COLUMN skill_ref text NOT NULL DEFAULT 'diagnostic' CHECK (btrim(skill_ref) <> ''),
  ADD COLUMN knowledge_point_ref text NOT NULL DEFAULT 'unassigned' CHECK (btrim(knowledge_point_ref) <> '');

ALTER TABLE stage_attempts
  ADD COLUMN mode text NOT NULL DEFAULT 'formal' CHECK (mode = 'formal'),
  ADD COLUMN snapshot_hash text CHECK (snapshot_hash IS NULL OR snapshot_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN snapshot_created_at timestamptz;

DROP TRIGGER stage_attempt_transition_trg ON stage_attempts;

CREATE TYPE stage_attempt_answer_status AS ENUM ('answered', 'skipped');

CREATE TABLE stage_attempt_item_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES stage_attempts(id) ON DELETE RESTRICT,
  source_item_id uuid NOT NULL REFERENCES stage_exam_items(id) ON DELETE RESTRICT,
  item_ref text NOT NULL CHECK (btrim(item_ref) <> ''),
  position integer NOT NULL CHECK (position > 0),
  prompt text NOT NULL CHECK (btrim(prompt) <> ''),
  support text,
  skill_ref text NOT NULL CHECK (btrim(skill_ref) <> ''),
  knowledge_point_ref text NOT NULL CHECK (btrim(knowledge_point_ref) <> ''),
  max_score numeric(12,6) NOT NULL CHECK (max_score > 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (attempt_id, id),
  UNIQUE (attempt_id, source_item_id),
  UNIQUE (attempt_id, position)
);
CREATE INDEX stage_attempt_item_snapshots_attempt_idx
  ON stage_attempt_item_snapshots(attempt_id, position);

CREATE TABLE stage_attempt_item_option_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_snapshot_id uuid NOT NULL REFERENCES stage_attempt_item_snapshots(id) ON DELETE RESTRICT,
  source_option_id uuid NOT NULL REFERENCES stage_exam_item_options(id) ON DELETE RESTRICT,
  option_ref text NOT NULL CHECK (btrim(option_ref) <> ''),
  option_text text NOT NULL CHECK (btrim(option_text) <> ''),
  position integer NOT NULL CHECK (position > 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (item_snapshot_id, id),
  UNIQUE (item_snapshot_id, source_option_id),
  UNIQUE (item_snapshot_id, position)
);
CREATE INDEX stage_attempt_item_option_snapshots_item_idx
  ON stage_attempt_item_option_snapshots(item_snapshot_id, position);

CREATE TABLE stage_attempt_answer_key_snapshots (
  item_snapshot_id uuid PRIMARY KEY REFERENCES stage_attempt_item_snapshots(id) ON DELETE RESTRICT,
  correct_option_snapshot_id uuid NOT NULL,
  source_answer_item_id uuid NOT NULL REFERENCES stage_exam_item_answer_keys(item_id) ON DELETE RESTRICT,
  grading_version integer NOT NULL CHECK (grading_version > 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT stage_attempt_answer_key_option_snapshot_fk
    FOREIGN KEY (item_snapshot_id, correct_option_snapshot_id)
    REFERENCES stage_attempt_item_option_snapshots(item_snapshot_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE stage_attempt_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES stage_attempts(id) ON DELETE RESTRICT,
  item_snapshot_id uuid NOT NULL,
  answer_status stage_attempt_answer_status NOT NULL,
  selected_option_snapshot_id uuid,
  idempotency_key text NOT NULL CHECK (
    length(idempotency_key) BETWEEN 8 AND 128 AND
    idempotency_key ~ '^[A-Za-z0-9._:-]+$'
  ),
  answered_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT stage_attempt_answers_item_fk
    FOREIGN KEY (attempt_id, item_snapshot_id)
    REFERENCES stage_attempt_item_snapshots(attempt_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT stage_attempt_answers_option_fk
    FOREIGN KEY (item_snapshot_id, selected_option_snapshot_id)
    REFERENCES stage_attempt_item_option_snapshots(item_snapshot_id, id)
    ON DELETE RESTRICT,
  CHECK (answered_at = created_at),
  CHECK (
    (answer_status = 'answered' AND selected_option_snapshot_id IS NOT NULL) OR
    (answer_status = 'skipped' AND selected_option_snapshot_id IS NULL)
  ),
  UNIQUE (attempt_id, item_snapshot_id),
  UNIQUE (attempt_id, idempotency_key)
);
CREATE INDEX stage_attempt_answers_attempt_idx
  ON stage_attempt_answers(attempt_id, created_at);

CREATE TABLE stage_attempt_start_idempotency (
  student_id uuid NOT NULL,
  exam_id uuid NOT NULL REFERENCES stage_exams(id) ON DELETE RESTRICT,
  operation_scope text NOT NULL CHECK (operation_scope LIKE 'stage_attempt.start:v1:%'),
  idempotency_key text NOT NULL,
  attempt_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (student_id, exam_id, operation_scope, idempotency_key),
  CONSTRAINT stage_attempt_start_idempotency_record_fk
    FOREIGN KEY (student_id, operation_scope, idempotency_key)
    REFERENCES idempotency_records(student_id, operation_scope, idempotency_key)
    ON DELETE RESTRICT,
  CONSTRAINT stage_attempt_start_attempt_fk
    FOREIGN KEY (attempt_id, student_id)
    REFERENCES stage_attempts(id, student_id)
    ON DELETE RESTRICT,
  UNIQUE (attempt_id)
);

CREATE OR REPLACE FUNCTION enforce_stage_attempt_start_idempotency_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_attempt_student_id uuid;
  v_attempt_exam_id uuid;
BEGIN
  SELECT a.student_id, ev.exam_id INTO v_attempt_student_id, v_attempt_exam_id
  FROM stage_attempts a
  JOIN stage_exam_versions ev ON ev.id = a.exam_version_id
  WHERE a.id = NEW.attempt_id
  FOR KEY SHARE OF a;

  IF v_attempt_student_id IS NULL OR
     v_attempt_student_id IS DISTINCT FROM NEW.student_id OR
     v_attempt_exam_id IS DISTINCT FROM NEW.exam_id THEN
    RAISE EXCEPTION 'stage attempt start idempotency must match the target student and exam' USING ERRCODE = '23514';
  END IF;
  IF NEW.operation_scope IS DISTINCT FROM ('stage_attempt.start:v1:' || NEW.exam_id::text) THEN
    RAISE EXCEPTION 'stage attempt start idempotency scope must match the target exam' USING ERRCODE = '23514';
  END IF;
  IF NEW.created_at IS DISTINCT FROM CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'stage attempt start idempotency time must use database current time' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stage_attempt_start_idempotency_insert_trg
BEFORE INSERT ON stage_attempt_start_idempotency
FOR EACH ROW EXECUTE FUNCTION enforce_stage_attempt_start_idempotency_insert();

CREATE OR REPLACE FUNCTION enforce_stage_attempt_snapshot_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'stage attempt snapshots can be created only by the attempt snapshot trigger' USING ERRCODE = '55000';
  END IF;
  IF NEW.created_at IS DISTINCT FROM CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'stage attempt snapshot times must use database current time' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION compute_stage_attempt_snapshot_hash(p_exam_version_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_payload text;
BEGIN
  SELECT string_agg(item_payload, E'\x1e' ORDER BY ordinal) INTO v_payload
  FROM (
    SELECT
      i.ordinal,
      concat_ws(
        E'\x1f',
        i.id::text,
        i.item_ref,
        i.ordinal::text,
        i.prompt,
        coalesce(i.support, ''),
        i.skill_ref,
        i.knowledge_point_ref,
        i.points::text,
        k.correct_option_id::text,
        k.grading_version::text,
        string_agg(
          concat_ws(E'\x1d', o.id::text, o.option_ref, o.option_text, o.ordinal::text),
          E'\x1c' ORDER BY o.ordinal
        )
      ) AS item_payload
    FROM stage_exam_items i
    JOIN stage_exam_item_options o ON o.item_id = i.id
    JOIN stage_exam_item_answer_keys k ON k.item_id = i.id
    WHERE i.exam_version_id = p_exam_version_id
    GROUP BY i.id, i.item_ref, i.ordinal, i.prompt, i.support, i.skill_ref,
             i.knowledge_point_ref, i.points, k.correct_option_id, k.grading_version
  ) payloads;

  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'attempt snapshot requires published exam content' USING ERRCODE = '23514';
  END IF;

  RETURN md5(v_payload) || md5('p1.3:' || v_payload);
END;
$$;

CREATE OR REPLACE FUNCTION validate_stage_attempt_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_status stage_exam_version_status;
  v_duration_seconds integer;
  v_retired_at timestamptz;
  v_role user_role;
  v_deleted_at timestamptz;
BEGIN
  IF NEW.status <> 'open' OR NEW.mode <> 'formal' OR
     NEW.submitted_at IS NOT NULL OR NEW.expired_at IS NOT NULL OR
     NEW.score IS NOT NULL OR NEW.passed IS NOT NULL OR
     NEW.snapshot_hash IS NOT NULL OR NEW.snapshot_created_at IS NOT NULL OR
     NEW.started_at IS DISTINCT FROM CURRENT_TIMESTAMP OR
     NEW.created_at IS DISTINCT FROM CURRENT_TIMESTAMP OR
     NEW.updated_at IS DISTINCT FROM CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'new stage attempt must be an open formal row created at database current time' USING ERRCODE = '23514';
  END IF;

  SELECT role, deleted_at INTO v_role, v_deleted_at
  FROM users
  WHERE id = NEW.student_id
  FOR KEY SHARE;
  IF v_role IS NULL OR v_role <> 'student' OR v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'attempt requires an active student' USING ERRCODE = '23514';
  END IF;

  SELECT ev.status, ev.duration_seconds, r.retired_at
    INTO v_status, v_duration_seconds, v_retired_at
  FROM stage_exam_versions ev
  LEFT JOIN stage_exam_version_retirements r ON r.exam_version_id = ev.id
  WHERE ev.id = NEW.exam_version_id
  FOR UPDATE OF ev;
  IF v_status IS NULL OR v_status <> 'published' OR
     (v_retired_at IS NOT NULL AND v_retired_at <= CURRENT_TIMESTAMP) THEN
    RAISE EXCEPTION 'attempt requires an available published exam version' USING ERRCODE = '23514';
  END IF;
  IF NEW.expires_at IS DISTINCT FROM CURRENT_TIMESTAMP + make_interval(secs => v_duration_seconds) THEN
    RAISE EXCEPTION 'attempt expiry must derive from database current time and exam duration' USING ERRCODE = '23514';
  END IF;

  NEW.snapshot_hash := compute_stage_attempt_snapshot_hash(NEW.exam_version_id);
  NEW.snapshot_created_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION create_stage_attempt_snapshot_for(p_attempt_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_attempt stage_attempts%ROWTYPE;
  v_source_items integer;
  v_snapshot_items integer;
  v_source_options integer;
  v_snapshot_options integer;
BEGIN
  SELECT * INTO v_attempt
  FROM stage_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;
  IF v_attempt.id IS NULL THEN
    RAISE EXCEPTION 'stage attempt does not exist' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM stage_attempt_item_snapshots WHERE attempt_id = p_attempt_id) THEN
    RAISE EXCEPTION 'stage attempt snapshot already exists' USING ERRCODE = '55000';
  END IF;

  INSERT INTO stage_attempt_item_snapshots
    (attempt_id, source_item_id, item_ref, position, prompt, support, skill_ref, knowledge_point_ref, max_score)
  SELECT v_attempt.id, id, item_ref, ordinal, prompt, support, skill_ref, knowledge_point_ref, points
  FROM stage_exam_items
  WHERE exam_version_id = v_attempt.exam_version_id
  ORDER BY ordinal;

  INSERT INTO stage_attempt_item_option_snapshots
    (item_snapshot_id, source_option_id, option_ref, option_text, position)
  SELECT s.id, o.id, o.option_ref, o.option_text, o.ordinal
  FROM stage_attempt_item_snapshots s
  JOIN stage_exam_item_options o ON o.item_id = s.source_item_id
  WHERE s.attempt_id = v_attempt.id
  ORDER BY s.position, o.ordinal;

  INSERT INTO stage_attempt_answer_key_snapshots
    (item_snapshot_id, correct_option_snapshot_id, source_answer_item_id, grading_version)
  SELECT s.id, os.id, k.item_id, k.grading_version
  FROM stage_attempt_item_snapshots s
  JOIN stage_exam_item_answer_keys k ON k.item_id = s.source_item_id
  JOIN stage_attempt_item_option_snapshots os
    ON os.item_snapshot_id = s.id AND os.source_option_id = k.correct_option_id
  WHERE s.attempt_id = v_attempt.id;

  SELECT count(*)::int INTO v_source_items
  FROM stage_exam_items
  WHERE exam_version_id = v_attempt.exam_version_id;
  SELECT count(*)::int INTO v_snapshot_items
  FROM stage_attempt_item_snapshots
  WHERE attempt_id = v_attempt.id;
  SELECT count(*)::int INTO v_source_options
  FROM stage_exam_item_options o
  JOIN stage_exam_items i ON i.id = o.item_id
  WHERE i.exam_version_id = v_attempt.exam_version_id;
  SELECT count(*)::int INTO v_snapshot_options
  FROM stage_attempt_item_option_snapshots os
  JOIN stage_attempt_item_snapshots s ON s.id = os.item_snapshot_id
  WHERE s.attempt_id = v_attempt.id;

  IF v_source_items = 0 OR v_snapshot_items <> v_source_items OR v_snapshot_options <> v_source_options THEN
    RAISE EXCEPTION 'stage attempt snapshot is incomplete' USING ERRCODE = '23514';
  END IF;

  IF v_attempt.snapshot_hash IS NULL OR v_attempt.snapshot_created_at IS NULL THEN
    UPDATE stage_attempts
    SET snapshot_hash = compute_stage_attempt_snapshot_hash(v_attempt.exam_version_id),
        snapshot_created_at = CURRENT_TIMESTAMP
    WHERE id = v_attempt.id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION create_stage_attempt_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM create_stage_attempt_snapshot_for(NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER stage_attempt_snapshot_create_trg
AFTER INSERT ON stage_attempts
FOR EACH ROW EXECUTE FUNCTION create_stage_attempt_snapshot();

CREATE OR REPLACE FUNCTION reject_stage_attempt_snapshot_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stage attempt snapshots are immutable' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER stage_attempt_item_snapshots_mutation_trg
BEFORE UPDATE OR DELETE ON stage_attempt_item_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_stage_attempt_snapshot_mutation();
CREATE TRIGGER stage_attempt_item_snapshots_truncate_trg
BEFORE TRUNCATE ON stage_attempt_item_snapshots
FOR EACH STATEMENT EXECUTE FUNCTION reject_stage_attempt_snapshot_mutation();
CREATE TRIGGER stage_attempt_item_option_snapshots_mutation_trg
BEFORE UPDATE OR DELETE ON stage_attempt_item_option_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_stage_attempt_snapshot_mutation();
CREATE TRIGGER stage_attempt_item_option_snapshots_truncate_trg
BEFORE TRUNCATE ON stage_attempt_item_option_snapshots
FOR EACH STATEMENT EXECUTE FUNCTION reject_stage_attempt_snapshot_mutation();
CREATE TRIGGER stage_attempt_answer_key_snapshots_mutation_trg
BEFORE UPDATE OR DELETE ON stage_attempt_answer_key_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_stage_attempt_snapshot_mutation();
CREATE TRIGGER stage_attempt_answer_key_snapshots_truncate_trg
BEFORE TRUNCATE ON stage_attempt_answer_key_snapshots
FOR EACH STATEMENT EXECUTE FUNCTION reject_stage_attempt_snapshot_mutation();

CREATE OR REPLACE FUNCTION enforce_stage_attempt_answer_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_status stage_attempt_status;
  v_attempt_id uuid;
BEGIN
  SELECT a.status INTO v_status
  FROM stage_attempts a
  WHERE a.id = NEW.attempt_id
  FOR KEY SHARE;
  IF v_status IS NULL OR v_status <> 'open' THEN
    RAISE EXCEPTION 'stage attempt answers require an open attempt' USING ERRCODE = '23514';
  END IF;
  IF NEW.answered_at IS DISTINCT FROM CURRENT_TIMESTAMP OR NEW.created_at IS DISTINCT FROM CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'stage attempt answer times must use database current time' USING ERRCODE = '23514';
  END IF;
  SELECT attempt_id INTO v_attempt_id
  FROM stage_attempt_item_snapshots
  WHERE id = NEW.item_snapshot_id;
  IF v_attempt_id IS DISTINCT FROM NEW.attempt_id THEN
    RAISE EXCEPTION 'stage attempt answer item does not belong to the attempt' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stage_attempt_answers_insert_trg
BEFORE INSERT ON stage_attempt_answers
FOR EACH ROW EXECUTE FUNCTION enforce_stage_attempt_answer_insert();

CREATE OR REPLACE FUNCTION reject_stage_attempt_answer_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stage attempt answers are append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER stage_attempt_answers_mutation_trg
BEFORE UPDATE OR DELETE ON stage_attempt_answers
FOR EACH ROW EXECUTE FUNCTION reject_stage_attempt_answer_mutation();
CREATE TRIGGER stage_attempt_answers_truncate_trg
BEFORE TRUNCATE ON stage_attempt_answers
FOR EACH STATEMENT EXECUTE FUNCTION reject_stage_attempt_answer_mutation();

CREATE OR REPLACE FUNCTION reject_stage_attempt_start_idempotency_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stage attempt start idempotency records are append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER stage_attempt_start_idempotency_mutation_trg
BEFORE UPDATE OR DELETE ON stage_attempt_start_idempotency
FOR EACH ROW EXECUTE FUNCTION reject_stage_attempt_start_idempotency_mutation();
CREATE TRIGGER stage_attempt_start_idempotency_truncate_trg
BEFORE TRUNCATE ON stage_attempt_start_idempotency
FOR EACH STATEMENT EXECUTE FUNCTION reject_stage_attempt_start_idempotency_mutation();

SELECT create_stage_attempt_snapshot_for(id)
FROM stage_attempts
WHERE snapshot_hash IS NULL OR snapshot_created_at IS NULL;

ALTER TABLE stage_attempts
  ALTER COLUMN snapshot_hash SET NOT NULL,
  ALTER COLUMN snapshot_created_at SET NOT NULL;

CREATE TRIGGER stage_attempt_item_snapshots_insert_trg
BEFORE INSERT ON stage_attempt_item_snapshots
FOR EACH ROW EXECUTE FUNCTION enforce_stage_attempt_snapshot_insert();
CREATE TRIGGER stage_attempt_item_option_snapshots_insert_trg
BEFORE INSERT ON stage_attempt_item_option_snapshots
FOR EACH ROW EXECUTE FUNCTION enforce_stage_attempt_snapshot_insert();
CREATE TRIGGER stage_attempt_answer_key_snapshots_insert_trg
BEFORE INSERT ON stage_attempt_answer_key_snapshots
FOR EACH ROW EXECUTE FUNCTION enforce_stage_attempt_snapshot_insert();

CREATE TRIGGER stage_attempt_transition_trg
BEFORE UPDATE OR DELETE ON stage_attempts
FOR EACH ROW EXECUTE FUNCTION enforce_stage_attempt_transition();
