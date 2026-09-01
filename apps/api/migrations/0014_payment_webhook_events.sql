ALTER TABLE subscription_entitlements
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id uuid PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('web_checkout')),
  external_event_id text NOT NULL,
  event_type text NOT NULL,
  payment_channel payment_channel NOT NULL,
  payload_hash text NOT NULL,
  processing_status text NOT NULL CHECK (processing_status IN ('processing', 'processed', 'failed')),
  error_code text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, external_event_id)
);

CREATE INDEX IF NOT EXISTS payment_webhook_events_received_at_idx
  ON payment_webhook_events(received_at DESC);
