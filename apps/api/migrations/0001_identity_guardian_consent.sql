BEGIN;

CREATE TYPE user_role AS ENUM ('student', 'guardian', 'admin');
CREATE TYPE client_platform AS ENUM ('ios', 'android', 'pc');
CREATE TYPE guardian_link_status AS ENUM ('pending', 'verified', 'rejected', 'revoked');
CREATE TYPE consent_status AS ENUM ('granted', 'denied', 'withdrawn');
CREATE TYPE payment_channel AS ENUM ('apple_app_store', 'google_play', 'web_checkout');

CREATE TABLE users (
  id uuid PRIMARY KEY,
  role user_role NOT NULL,
  birth_month date,
  is_minor boolean NOT NULL DEFAULT false,
  target_exam text NOT NULL DEFAULT 'eiken_grade_3' CHECK (target_exam = 'eiken_grade_3'),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE auth_identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  provider text NOT NULL CHECK (provider IN ('apple', 'google', 'email_magic_link')),
  provider_subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject)
);

CREATE TABLE user_devices (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  platform client_platform NOT NULL,
  device_id_hash text NOT NULL,
  app_version text,
  os_version text,
  push_token_encrypted text,
  push_enabled boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_id_hash)
);

CREATE TABLE guardian_links (
  id uuid PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES users(id),
  guardian_id uuid REFERENCES users(id),
  status guardian_link_status NOT NULL DEFAULT 'pending',
  purchase_allowed boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX guardian_links_one_active_student_idx ON guardian_links(student_id) WHERE status IN ('pending', 'verified');

CREATE TABLE consent_records (
  id uuid PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES users(id),
  guardian_id uuid REFERENCES users(id),
  consent_type text NOT NULL CHECK (consent_type IN ('voice_processing')),
  status consent_status NOT NULL,
  version text NOT NULL,
  processing_region text,
  vendor text,
  granted_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consent_records_latest_idx ON consent_records(student_id, consent_type, created_at DESC);

CREATE TABLE subscription_entitlements (
  id uuid PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES users(id),
  purchaser_guardian_id uuid NOT NULL REFERENCES users(id),
  payment_channel payment_channel NOT NULL,
  external_subscription_id text NOT NULL,
  entitlement_code text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'grace_period', 'expired', 'revoked')),
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_channel, external_subscription_id, entitlement_code)
);

CREATE TABLE line_links (
  id uuid PRIMARY KEY,
  guardian_id uuid NOT NULL REFERENCES users(id),
  line_subject text NOT NULL UNIQUE,
  return_target text NOT NULL CHECK (return_target IN ('app_deep_link', 'web_https')),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
