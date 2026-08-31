ALTER TABLE guardian_links
  ADD COLUMN invitation_code_hash text,
  ADD COLUMN invitation_expires_at timestamptz,
  ADD COLUMN invitation_created_at timestamptz;

CREATE UNIQUE INDEX guardian_links_pending_invitation_code_hash_idx
  ON guardian_links(invitation_code_hash)
  WHERE status = 'pending' AND invitation_code_hash IS NOT NULL;
