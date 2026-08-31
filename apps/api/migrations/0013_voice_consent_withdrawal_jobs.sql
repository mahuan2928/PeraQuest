CREATE TABLE voice_consent_audit_events (
  id uuid PRIMARY KEY,
  consent_record_id uuid NOT NULL REFERENCES consent_records(id),
  student_id uuid NOT NULL REFERENCES users(id),
  guardian_id uuid REFERENCES users(id),
  status consent_status NOT NULL,
  version text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('voice_consent_recorded')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX voice_consent_audit_events_student_idx
  ON voice_consent_audit_events(student_id, occurred_at DESC);

CREATE TABLE voice_data_deletion_jobs (
  id uuid PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES users(id),
  guardian_id uuid REFERENCES users(id),
  source_consent_record_id uuid NOT NULL REFERENCES consent_records(id),
  reason text NOT NULL CHECK (reason IN ('voice_consent_withdrawn')),
  status text NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')) DEFAULT 'pending',
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  UNIQUE (source_consent_record_id)
);

CREATE INDEX voice_data_deletion_jobs_pending_idx
  ON voice_data_deletion_jobs(requested_at, id)
  WHERE status = 'pending';

CREATE INDEX voice_data_deletion_jobs_student_idx
  ON voice_data_deletion_jobs(student_id, requested_at DESC);
