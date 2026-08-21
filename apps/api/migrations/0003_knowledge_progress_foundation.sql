CREATE TABLE knowledge_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_level text NOT NULL CHECK (exam_level = 'eiken_grade_3'),
  skill text NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  version text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  prerequisite_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exam_level, version, code)
);

COMMENT ON TABLE knowledge_nodes IS 'Versioned knowledge catalog. Published rows are immutable by application policy.';

CREATE TABLE student_knowledge (
  student_id uuid NOT NULL REFERENCES users(id),
  knowledge_node_id uuid NOT NULL REFERENCES knowledge_nodes(id),
  mastery_score numeric(5,4) NOT NULL DEFAULT 0 CHECK (mastery_score BETWEEN 0 AND 1),
  state text NOT NULL DEFAULT 'new' CHECK (state IN ('new', 'learning', 'review', 'mastered', 'suspended')),
  stability_days numeric NOT NULL DEFAULT 0 CHECK (stability_days >= 0),
  due_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  correct_count integer NOT NULL DEFAULT 0 CHECK (correct_count >= 0 AND correct_count <= attempt_count),
  last_attempt_at timestamptz,
  version text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, knowledge_node_id)
);

CREATE INDEX student_knowledge_due_idx ON student_knowledge(student_id, due_at) WHERE state IN ('learning', 'review');

CREATE TABLE knowledge_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES users(id),
  knowledge_node_id uuid NOT NULL REFERENCES knowledge_nodes(id),
  source text NOT NULL CHECK (source IN ('lesson', 'daily_review', 'stage_exam', 'cross_stage_challenge')),
  outcome text NOT NULL CHECK (outcome IN ('correct', 'incorrect', 'skipped')),
  difficulty numeric(5,4) CHECK (difficulty BETWEEN 0 AND 1),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (student_id, idempotency_key)
);

CREATE INDEX knowledge_events_student_time_idx ON knowledge_events(student_id, occurred_at DESC);

COMMENT ON TABLE knowledge_events IS 'Append-only learning facts; must not contain raw voice or answer content.';
