CREATE TYPE learning_audit_event_type AS ENUM (
  'attempt_started',
  'attempt_submitted',
  'attempt_expired'
);
CREATE TYPE learning_audit_actor_relationship AS ENUM (
  'self',
  'verified_guardian',
  'admin'
);

CREATE TABLE learning_audit_events (
  event_id uuid PRIMARY KEY,
  event_type learning_audit_event_type NOT NULL,
  actor_id uuid NOT NULL,
  actor_role user_role NOT NULL,
  actor_auth_provider text NOT NULL CHECK (actor_auth_provider IN ('apple', 'google', 'email_magic_link')),
  actor_provider_subject text NOT NULL CHECK (btrim(actor_provider_subject) <> ''),
  actor_relationship learning_audit_actor_relationship NOT NULL,
  student_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  request_id text NOT NULL UNIQUE CHECK (
    length(request_id) BETWEEN 8 AND 128 AND
    request_id ~ '^[A-Za-z0-9._:-]+$'
  ),
  reason text NOT NULL CHECK (
    length(btrim(reason)) BETWEEN 1 AND 256
  ),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT learning_audit_attempt_student_fk
    FOREIGN KEY (attempt_id, student_id)
    REFERENCES stage_attempts(id, student_id)
    ON DELETE RESTRICT,
  CONSTRAINT learning_audit_actor_fk
    FOREIGN KEY (actor_id)
    REFERENCES users(id)
    ON DELETE RESTRICT,
  CONSTRAINT learning_audit_recording_time_check CHECK (
    occurred_at <= recorded_at AND
    recorded_at <= occurred_at + interval '5 minutes'
  ),
  CONSTRAINT learning_audit_attempt_event_unique
    UNIQUE (attempt_id, event_type)
);
CREATE INDEX learning_audit_student_time_idx
  ON learning_audit_events(student_id, occurred_at DESC);
CREATE INDEX learning_audit_attempt_time_idx
  ON learning_audit_events(attempt_id, occurred_at);

CREATE OR REPLACE FUNCTION enforce_learning_audit_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_attempt_status stage_attempt_status;
  v_started_at timestamptz;
  v_actor_role user_role;
BEGIN
  SELECT status, started_at INTO v_attempt_status, v_started_at
  FROM stage_attempts
  WHERE id = NEW.attempt_id AND student_id = NEW.student_id
  FOR KEY SHARE;

  IF v_started_at IS NULL THEN
    RAISE EXCEPTION 'learning audit attempt attribution is invalid' USING ERRCODE = '23514';
  END IF;

  -- P1.2 installs only the audit foundation. Terminal events remain disabled until
  -- the submit/expiry runtimes are introduced in a later migration.
  IF NEW.event_type <> 'attempt_started' THEN
    RAISE EXCEPTION 'terminal learning audit events are not enabled in P1.2' USING ERRCODE = '23514';
  END IF;
  IF v_attempt_status <> 'open' OR NEW.occurred_at IS DISTINCT FROM v_started_at THEN
    RAISE EXCEPTION 'attempt_started must match an open attempt and its authoritative started_at' USING ERRCODE = '23514';
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
CREATE TRIGGER learning_audit_insert_trg
BEFORE INSERT ON learning_audit_events
FOR EACH ROW EXECUTE FUNCTION enforce_learning_audit_insert();

CREATE OR REPLACE FUNCTION reject_learning_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'learning audit events are append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER learning_audit_update_delete_trg
BEFORE UPDATE OR DELETE ON learning_audit_events
FOR EACH ROW EXECUTE FUNCTION reject_learning_audit_mutation();
CREATE TRIGGER learning_audit_truncate_trg
BEFORE TRUNCATE ON learning_audit_events
FOR EACH STATEMENT EXECUTE FUNCTION reject_learning_audit_mutation();
