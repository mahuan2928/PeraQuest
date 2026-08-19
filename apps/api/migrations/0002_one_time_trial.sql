CREATE TABLE trial_redemptions (
  student_id uuid PRIMARY KEY REFERENCES users(id),
  redeemed_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE trial_redemptions IS 'Minimal one-time eligibility marker. Never stores answers, scores, or long-term learning progress.';

CREATE TABLE trial_attempts (
  id uuid PRIMARY KEY,
  student_id uuid NOT NULL UNIQUE REFERENCES users(id),
  current_index integer NOT NULL DEFAULT 0 CHECK (current_index BETWEEN 0 AND 12),
  transient_score integer NOT NULL DEFAULT 0 CHECK (transient_score BETWEEN 0 AND 12),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at <= created_at + interval '24 hours')
);

COMMENT ON TABLE trial_attempts IS 'Short-lived operational state only; delete on completion/expiry. Raw answers and durable learning progress are prohibited.';

CREATE INDEX trial_attempts_expiry_idx ON trial_attempts(expires_at);
