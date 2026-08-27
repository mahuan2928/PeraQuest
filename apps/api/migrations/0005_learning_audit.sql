CREATE TYPE learning_audit_event_type AS ENUM (
  'attempt_started',
  'attempt_submitted',
  'attempt_expired'
);

CREATE TABLE learning_audit_events (
  event_id uuid PRIMARY KEY,
  event_type learning_audit_event_type NOT NULL,
  actor_id uuid NOT NULL,
  student_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  request_id text NOT NULL CHECK (
    length(request_id) BETWEEN 8 AND 128 AND
    request_id ~ '^[A-Za-z0-9._:-]+$'
  ),
  reason text NOT NULL CHECK (
    length(btrim(reason)) BETWEEN 1 AND 256
  ),
  occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
  CONSTRAINT learning_audit_student_request_unique
    UNIQUE (student_id, request_id),
  CONSTRAINT learning_audit_attempt_event_unique
    UNIQUE (attempt_id, event_type)
);
CREATE INDEX learning_audit_student_time_idx
  ON learning_audit_events(student_id, occurred_at DESC);
CREATE INDEX learning_audit_attempt_time_idx
  ON learning_audit_events(attempt_id, occurred_at);

CREATE OR REPLACE FUNCTION enforce_learning_audit_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_started_at timestamptz;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'learning audit events are append-only' USING ERRCODE = '55000';
  END IF;

  SELECT started_at INTO v_started_at
  FROM stage_attempts
  WHERE id = NEW.attempt_id AND student_id = NEW.student_id
  FOR KEY SHARE;

  IF v_started_at IS NULL OR NEW.occurred_at < v_started_at THEN
    RAISE EXCEPTION 'learning audit event time cannot precede the attempt' USING ERRCODE = '23514';
  END IF;
  IF NEW.recorded_at IS DISTINCT FROM CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'learning audit recorded_at must use database current time' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER learning_audit_append_only_trg
BEFORE INSERT OR UPDATE OR DELETE ON learning_audit_events
FOR EACH ROW EXECUTE FUNCTION enforce_learning_audit_append_only();
