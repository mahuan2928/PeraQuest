CREATE TABLE IF NOT EXISTS student_game_state (
  student_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_xp integer NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
  activity_coins integer NOT NULL DEFAULT 0 CHECK (activity_coins >= 0),
  quest_chapter integer NOT NULL DEFAULT 0 CHECK (quest_chapter >= 0),
  quest_step integer NOT NULL DEFAULT 0 CHECK (quest_step >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_reward_ledger (
  id uuid PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('stage_attempt', 'guardian_verification')),
  source_ref text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('stage_attempt_passed', 'stage_attempt_completed', 'guardian_link_verified')),
  xp_delta integer NOT NULL CHECK (xp_delta >= 0),
  activity_coin_delta integer NOT NULL CHECK (activity_coin_delta >= 0),
  quest_step_delta integer NOT NULL DEFAULT 0 CHECK (quest_step_delta >= 0),
  quest_chapter_unlocked integer CHECK (quest_chapter_unlocked IS NULL OR quest_chapter_unlocked >= 0),
  badge_codes text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, source_type, source_ref)
);

CREATE INDEX IF NOT EXISTS game_reward_ledger_student_created_at_idx
  ON game_reward_ledger(student_id, created_at DESC);
