CREATE TYPE stage_exam_version_status AS ENUM ('draft', 'published');
CREATE TYPE stage_attempt_status AS ENUM ('open', 'passed', 'failed', 'expired');
CREATE TYPE idempotency_record_status AS ENUM ('in_progress', 'completed');

CREATE TABLE stage_exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_level text NOT NULL CHECK (exam_level = 'eiken_grade_3'),
  stage integer NOT NULL CHECK (stage > 0),
  code text NOT NULL CHECK (btrim(code) <> ''),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (exam_level, stage, code)
);

CREATE TABLE stage_exam_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES stage_exams(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  status stage_exam_version_status NOT NULL DEFAULT 'draft',
  pass_score numeric(7,6) NOT NULL CHECK (pass_score > 0 AND pass_score <= 1),
  duration_seconds integer NOT NULL CHECK (duration_seconds BETWEEN 60 AND 86400),
  content_hash bytea NOT NULL CHECK (octet_length(content_hash) = 32),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (status = 'draft' AND published_at IS NULL) OR
    (status = 'published' AND published_at IS NOT NULL)
  ),
  UNIQUE (exam_id, version),
  UNIQUE (id, exam_id)
);
CREATE INDEX stage_exam_versions_available_idx
  ON stage_exam_versions(exam_id, version DESC)
  WHERE status = 'published';

CREATE TABLE stage_exam_version_retirements (
  exam_version_id uuid PRIMARY KEY REFERENCES stage_exam_versions(id) ON DELETE RESTRICT,
  retired_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX stage_exam_version_retirements_time_idx
  ON stage_exam_version_retirements(retired_at);

CREATE TABLE stage_exam_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_version_id uuid NOT NULL REFERENCES stage_exam_versions(id) ON DELETE RESTRICT,
  item_ref text NOT NULL CHECK (btrim(item_ref) <> ''),
  ordinal integer NOT NULL CHECK (ordinal > 0),
  prompt text NOT NULL CHECK (btrim(prompt) <> ''),
  support text,
  points numeric(12,6) NOT NULL CHECK (points > 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (exam_version_id, item_ref),
  UNIQUE (exam_version_id, ordinal),
  UNIQUE (id, exam_version_id)
);
CREATE INDEX stage_exam_items_version_idx
  ON stage_exam_items(exam_version_id, ordinal);

CREATE TABLE stage_exam_item_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES stage_exam_items(id) ON DELETE RESTRICT,
  option_ref text NOT NULL CHECK (btrim(option_ref) <> ''),
  option_text text NOT NULL CHECK (btrim(option_text) <> ''),
  ordinal integer NOT NULL CHECK (ordinal > 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (item_id, option_ref),
  UNIQUE (item_id, ordinal),
  UNIQUE (item_id, id)
);
CREATE INDEX stage_exam_item_options_item_idx
  ON stage_exam_item_options(item_id, ordinal);

-- Private grading storage. Public question reads must never join this table.
CREATE TABLE stage_exam_item_answer_keys (
  item_id uuid PRIMARY KEY REFERENCES stage_exam_items(id) ON DELETE RESTRICT,
  correct_option_id uuid NOT NULL,
  grading_version integer NOT NULL DEFAULT 1 CHECK (grading_version > 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT stage_exam_answer_option_fk
    FOREIGN KEY (item_id, correct_option_id)
    REFERENCES stage_exam_item_options(item_id, id)
    ON DELETE RESTRICT
);
CREATE INDEX stage_exam_item_answer_keys_option_idx
  ON stage_exam_item_answer_keys(correct_option_id);

CREATE TABLE stage_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  exam_version_id uuid NOT NULL REFERENCES stage_exam_versions(id) ON DELETE RESTRICT,
  status stage_attempt_status NOT NULL DEFAULT 'open',
  started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz NOT NULL,
  submitted_at timestamptz,
  expired_at timestamptz,
  score numeric(20,12),
  passed boolean,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (expires_at > started_at),
  CHECK (submitted_at IS NULL OR submitted_at >= started_at),
  CHECK (updated_at >= created_at),
  CHECK (
    (status = 'open' AND submitted_at IS NULL AND expired_at IS NULL AND score IS NULL AND passed IS NULL) OR
    (status = 'passed' AND submitted_at IS NOT NULL AND expired_at IS NULL AND score IS NOT NULL AND passed IS TRUE) OR
    (status = 'failed' AND submitted_at IS NOT NULL AND expired_at IS NULL AND score IS NOT NULL AND passed IS FALSE) OR
    (status = 'expired' AND submitted_at IS NULL AND expired_at IS NOT NULL AND score IS NULL AND passed IS NULL)
  ),
  CHECK (score IS NULL OR (score >= 0 AND score <= 1)),
  UNIQUE (id, student_id),
  UNIQUE (id, exam_version_id)
);
CREATE UNIQUE INDEX stage_attempts_one_open_exam_idx
  ON stage_attempts(student_id, exam_version_id)
  WHERE status = 'open';
CREATE INDEX stage_attempts_student_created_idx
  ON stage_attempts(student_id, created_at DESC);
CREATE INDEX stage_attempts_expiry_idx
  ON stage_attempts(expires_at)
  WHERE status = 'open';

CREATE TABLE idempotency_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation_scope text NOT NULL CHECK (btrim(operation_scope) <> ''),
  idempotency_key text NOT NULL CHECK (
    length(idempotency_key) BETWEEN 8 AND 128 AND
    idempotency_key ~ '^[A-Za-z0-9._:-]+$'
  ),
  request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
  status idempotency_record_status NOT NULL DEFAULT 'in_progress',
  http_status integer CHECK (http_status BETWEEN 200 AND 499),
  response_headers jsonb CHECK (response_headers IS NULL OR jsonb_typeof(response_headers) = 'object'),
  response_body jsonb CHECK (response_body IS NULL OR jsonb_typeof(response_body) = 'object'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamptz,
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at),
  CHECK (
    (status = 'in_progress' AND http_status IS NULL AND response_headers IS NULL AND response_body IS NULL AND completed_at IS NULL) OR
    (status = 'completed' AND http_status IS NOT NULL AND response_headers IS NOT NULL AND response_body IS NOT NULL AND completed_at IS NOT NULL)
  ),
  UNIQUE (student_id, operation_scope, idempotency_key)
);
CREATE INDEX idempotency_records_expiry_idx
  ON idempotency_records(expires_at);
CREATE INDEX idempotency_records_in_progress_idx
  ON idempotency_records(created_at)
  WHERE status = 'in_progress';

CREATE OR REPLACE FUNCTION enforce_stage_exam_identity_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id OR
    NEW.exam_level IS DISTINCT FROM OLD.exam_level OR
    NEW.stage IS DISTINCT FROM OLD.stage OR
    NEW.code IS DISTINCT FROM OLD.code OR
    NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'stage exam business identity is immutable' USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM stage_exam_versions
    WHERE exam_id = OLD.id AND status = 'published'
  ) THEN
    RAISE EXCEPTION 'stage exam with a published version cannot be deleted' USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stage_exams_identity_immutability_trg
BEFORE UPDATE OR DELETE ON stage_exams
FOR EACH ROW EXECUTE FUNCTION enforce_stage_exam_identity_immutability();

CREATE OR REPLACE FUNCTION enforce_idempotency_record_identity_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR
     NEW.student_id IS DISTINCT FROM OLD.student_id OR
     NEW.operation_scope IS DISTINCT FROM OLD.operation_scope OR
     NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR
     NEW.request_hash IS DISTINCT FROM OLD.request_hash OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'idempotency record identity is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER idempotency_records_identity_immutability_trg
BEFORE UPDATE ON idempotency_records
FOR EACH ROW EXECUTE FUNCTION enforce_idempotency_record_identity_immutability();

CREATE OR REPLACE FUNCTION enforce_stage_exam_version_mutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' OR NEW.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'exam versions must be created as draft' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'published exam version is immutable' USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = 'published' THEN
    IF NEW.published_at IS DISTINCT FROM CURRENT_TIMESTAMP THEN
      RAISE EXCEPTION 'published_at must use database current time' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM stage_exam_items WHERE exam_version_id = NEW.id) OR EXISTS (
      SELECT 1
      FROM stage_exam_items i
      LEFT JOIN stage_exam_item_options o ON o.item_id = i.id
      LEFT JOIN stage_exam_item_answer_keys k ON k.item_id = i.id
      WHERE i.exam_version_id = NEW.id
      GROUP BY i.id
      HAVING count(DISTINCT o.id) < 2 OR count(DISTINCT k.item_id) <> 1
    ) THEN
      RAISE EXCEPTION 'published exam version is incomplete' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stage_exam_versions_mutability_trg
BEFORE INSERT OR UPDATE OR DELETE ON stage_exam_versions
FOR EACH ROW EXECUTE FUNCTION enforce_stage_exam_version_mutability();

CREATE OR REPLACE FUNCTION enforce_stage_exam_item_mutability()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_status stage_exam_version_status;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO v_status
    FROM stage_exam_versions
    WHERE id = OLD.exam_version_id
    FOR UPDATE;
    IF v_status = 'published' THEN
      RAISE EXCEPTION 'published exam content is immutable' USING ERRCODE = '55000';
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO v_status
    FROM stage_exam_versions
    WHERE id = NEW.exam_version_id
    FOR UPDATE;
    IF v_status = 'published' THEN
      RAISE EXCEPTION 'published exam content is immutable' USING ERRCODE = '55000';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stage_exam_items_mutability_trg
BEFORE INSERT OR UPDATE OR DELETE ON stage_exam_items
FOR EACH ROW EXECUTE FUNCTION enforce_stage_exam_item_mutability();

CREATE OR REPLACE FUNCTION enforce_stage_exam_item_child_mutability()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_status stage_exam_version_status;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT ev.status INTO v_status
    FROM stage_exam_items i
    JOIN stage_exam_versions ev ON ev.id = i.exam_version_id
    WHERE i.id = OLD.item_id
    FOR UPDATE OF ev;
    IF v_status = 'published' THEN
      RAISE EXCEPTION 'published exam item child is immutable' USING ERRCODE = '55000';
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT ev.status INTO v_status
    FROM stage_exam_items i
    JOIN stage_exam_versions ev ON ev.id = i.exam_version_id
    WHERE i.id = NEW.item_id
    FOR UPDATE OF ev;
    IF v_status = 'published' THEN
      RAISE EXCEPTION 'published exam item child is immutable' USING ERRCODE = '55000';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stage_exam_item_options_mutability_trg
BEFORE INSERT OR UPDATE OR DELETE ON stage_exam_item_options
FOR EACH ROW EXECUTE FUNCTION enforce_stage_exam_item_child_mutability();
CREATE TRIGGER stage_exam_item_answer_keys_mutability_trg
BEFORE INSERT OR UPDATE OR DELETE ON stage_exam_item_answer_keys
FOR EACH ROW EXECUTE FUNCTION enforce_stage_exam_item_child_mutability();

CREATE OR REPLACE FUNCTION validate_stage_exam_version_retirement()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_status stage_exam_version_status;
  v_published_at timestamptz;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'exam version retirement is append-only' USING ERRCODE = '55000';
  END IF;

  SELECT status, published_at INTO v_status, v_published_at
  FROM stage_exam_versions
  WHERE id = NEW.exam_version_id
  FOR UPDATE;
  IF v_status IS NULL OR v_status <> 'published' OR NEW.retired_at < v_published_at THEN
    RAISE EXCEPTION 'retirement requires a published version and valid time' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stage_exam_version_retirement_validate_trg
BEFORE INSERT OR UPDATE OR DELETE ON stage_exam_version_retirements
FOR EACH ROW EXECUTE FUNCTION validate_stage_exam_version_retirement();

CREATE OR REPLACE FUNCTION validate_stage_attempt_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_status stage_exam_version_status;
  v_duration_seconds integer;
  v_retired_at timestamptz;
  v_role user_role;
  v_deleted_at timestamptz;
BEGIN
  IF NEW.status <> 'open' OR NEW.submitted_at IS NOT NULL OR NEW.expired_at IS NOT NULL OR
     NEW.score IS NOT NULL OR NEW.passed IS NOT NULL OR
     NEW.started_at IS DISTINCT FROM CURRENT_TIMESTAMP OR
     NEW.created_at IS DISTINCT FROM CURRENT_TIMESTAMP OR
     NEW.updated_at IS DISTINCT FROM CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'new stage attempt must be an open row created at database current time' USING ERRCODE = '23514';
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
  RETURN NEW;
END;
$$;
CREATE TRIGGER stage_attempt_insert_validate_trg
BEFORE INSERT ON stage_attempts
FOR EACH ROW EXECUTE FUNCTION validate_stage_attempt_insert();

CREATE OR REPLACE FUNCTION enforce_stage_attempt_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stage attempts cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF OLD.status <> 'open' THEN
    RAISE EXCEPTION 'terminal stage attempt is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR
     NEW.student_id IS DISTINCT FROM OLD.student_id OR
     NEW.exam_version_id IS DISTINCT FROM OLD.exam_version_id OR
     NEW.started_at IS DISTINCT FROM OLD.started_at OR
     NEW.expires_at IS DISTINCT FROM OLD.expires_at OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'stage attempt identity and creation window are immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.status NOT IN ('passed', 'failed', 'expired') THEN
    RAISE EXCEPTION 'stage attempt may transition only once from open to terminal' USING ERRCODE = '23514';
  END IF;
  IF NEW.updated_at IS DISTINCT FROM CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'terminal transition must set updated_at to database current time' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('passed', 'failed') AND NEW.submitted_at IS DISTINCT FROM CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'submission transition must set submitted_at to database current time' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'expired' AND (
    NEW.expired_at IS DISTINCT FROM CURRENT_TIMESTAMP OR CURRENT_TIMESTAMP < OLD.expires_at
  ) THEN
    RAISE EXCEPTION 'expiry transition must occur at or after expiry using database current time' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stage_attempt_transition_trg
BEFORE UPDATE OR DELETE ON stage_attempts
FOR EACH ROW EXECUTE FUNCTION enforce_stage_attempt_transition();

-- Trial attempts are transient. Remove historical rows outside the new window,
-- then replace whichever real legacy expiry CHECK exists instead of guessing its name.
DELETE FROM trial_attempts
WHERE expires_at <= created_at OR expires_at > created_at + interval '30 minutes';

DO $$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'trial_attempts'::regclass
      AND contype = 'c'
      AND pg_get_expr(conbin, conrelid) =
        '(expires_at <= (created_at + ''24:00:00''::interval))'
  LOOP
    EXECUTE format('ALTER TABLE trial_attempts DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
END;
$$;

ALTER TABLE trial_attempts
  ADD CONSTRAINT trial_attempts_ttl_30m_check
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 minutes') NOT VALID;
ALTER TABLE trial_attempts VALIDATE CONSTRAINT trial_attempts_ttl_30m_check;
