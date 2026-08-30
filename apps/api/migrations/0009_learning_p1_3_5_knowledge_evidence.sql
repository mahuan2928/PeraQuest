CREATE TABLE knowledge_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  exam_version_id uuid NOT NULL,
  item_snapshot_id uuid NOT NULL,
  answer_id uuid NOT NULL REFERENCES stage_attempt_answers(id) ON DELETE RESTRICT,
  source_item_id uuid NOT NULL REFERENCES stage_exam_items(id) ON DELETE RESTRICT,
  skill_ref text NOT NULL CHECK (btrim(skill_ref) <> ''),
  knowledge_point_ref text NOT NULL CHECK (btrim(knowledge_point_ref) <> ''),
  outcome stage_attempt_answer_outcome NOT NULL,
  earned_score numeric(12,6) NOT NULL CHECK (earned_score >= 0),
  max_score numeric(12,6) NOT NULL CHECK (max_score > 0 AND earned_score <= max_score),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT knowledge_evidence_attempt_student_fk
    FOREIGN KEY (attempt_id, student_id)
    REFERENCES stage_attempts(id, student_id)
    ON DELETE RESTRICT,
  CONSTRAINT knowledge_evidence_attempt_version_fk
    FOREIGN KEY (attempt_id, exam_version_id)
    REFERENCES stage_attempts(id, exam_version_id)
    ON DELETE RESTRICT,
  CONSTRAINT knowledge_evidence_item_fk
    FOREIGN KEY (attempt_id, item_snapshot_id)
    REFERENCES stage_attempt_item_snapshots(attempt_id, id)
    ON DELETE RESTRICT,
  UNIQUE (attempt_id, item_snapshot_id),
  UNIQUE (answer_id)
);
CREATE INDEX knowledge_evidence_student_occurred_idx
  ON knowledge_evidence(student_id, occurred_at DESC);
CREATE INDEX knowledge_evidence_student_knowledge_idx
  ON knowledge_evidence(student_id, knowledge_point_ref, occurred_at DESC);

CREATE OR REPLACE FUNCTION enforce_knowledge_evidence_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_student_id uuid;
  v_exam_version_id uuid;
  v_status stage_attempt_status;
  v_submitted_at timestamptz;
  v_answer_attempt_id uuid;
  v_item_snapshot_id uuid;
  v_source_item_id uuid;
  v_skill_ref text;
  v_knowledge_point_ref text;
  v_outcome stage_attempt_answer_outcome;
  v_earned_score numeric(12,6);
  v_max_score numeric(12,6);
BEGIN
  SELECT a.student_id, a.exam_version_id, a.status, a.submitted_at,
         ans.attempt_id, ans.item_snapshot_id, item.source_item_id,
         item.skill_ref, item.knowledge_point_ref,
         ans.outcome, ans.earned_score, ans.max_score
    INTO v_student_id, v_exam_version_id, v_status, v_submitted_at,
         v_answer_attempt_id, v_item_snapshot_id, v_source_item_id,
         v_skill_ref, v_knowledge_point_ref,
         v_outcome, v_earned_score, v_max_score
  FROM stage_attempts a
  JOIN stage_attempt_answers ans ON ans.id = NEW.answer_id
  JOIN stage_attempt_item_snapshots item ON item.id = ans.item_snapshot_id
  WHERE a.id = NEW.attempt_id
  FOR KEY SHARE OF a;

  IF v_student_id IS NULL OR v_status NOT IN ('passed', 'failed') OR v_submitted_at IS NULL THEN
    RAISE EXCEPTION 'knowledge evidence requires a submitted formal attempt' USING ERRCODE = '23514';
  END IF;
  IF v_answer_attempt_id IS DISTINCT FROM NEW.attempt_id OR
     v_student_id IS DISTINCT FROM NEW.student_id OR
     v_exam_version_id IS DISTINCT FROM NEW.exam_version_id OR
     v_item_snapshot_id IS DISTINCT FROM NEW.item_snapshot_id OR
     v_source_item_id IS DISTINCT FROM NEW.source_item_id OR
     v_skill_ref IS DISTINCT FROM NEW.skill_ref OR
     v_knowledge_point_ref IS DISTINCT FROM NEW.knowledge_point_ref OR
     v_outcome IS DISTINCT FROM NEW.outcome OR
     v_earned_score IS DISTINCT FROM NEW.earned_score OR
     v_max_score IS DISTINCT FROM NEW.max_score THEN
    RAISE EXCEPTION 'knowledge evidence must match the scored answer and immutable item snapshot' USING ERRCODE = '23514';
  END IF;
  IF NEW.occurred_at IS DISTINCT FROM v_submitted_at OR
     NEW.created_at IS DISTINCT FROM CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'knowledge evidence times must use database authoritative timestamps' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER knowledge_evidence_insert_trg
BEFORE INSERT ON knowledge_evidence
FOR EACH ROW EXECUTE FUNCTION enforce_knowledge_evidence_insert();

CREATE OR REPLACE FUNCTION reject_knowledge_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'knowledge evidence is append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER knowledge_evidence_mutation_trg
BEFORE UPDATE OR DELETE ON knowledge_evidence
FOR EACH ROW EXECUTE FUNCTION reject_knowledge_evidence_mutation();
CREATE TRIGGER knowledge_evidence_truncate_trg
BEFORE TRUNCATE ON knowledge_evidence
FOR EACH STATEMENT EXECUTE FUNCTION reject_knowledge_evidence_mutation();

CREATE OR REPLACE FUNCTION create_stage_attempt_knowledge_evidence(p_attempt_id uuid, p_student_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_item_count integer;
  v_answer_count integer;
  v_evidence_count integer;
BEGIN
  INSERT INTO knowledge_evidence
    (student_id, attempt_id, exam_version_id, item_snapshot_id, answer_id,
     source_item_id, skill_ref, knowledge_point_ref, outcome, earned_score,
     max_score, occurred_at)
  SELECT a.student_id, a.id, a.exam_version_id, item.id, ans.id,
         item.source_item_id, item.skill_ref, item.knowledge_point_ref,
         ans.outcome, ans.earned_score, ans.max_score, a.submitted_at
  FROM stage_attempts a
  JOIN stage_attempt_answers ans ON ans.attempt_id = a.id
  JOIN stage_attempt_item_snapshots item ON item.id = ans.item_snapshot_id
  WHERE a.id = p_attempt_id
    AND a.student_id = p_student_id
    AND a.status IN ('passed', 'failed')
  ON CONFLICT (attempt_id, item_snapshot_id) DO NOTHING;

  SELECT count(*)::int INTO v_item_count
  FROM stage_attempt_item_snapshots
  WHERE attempt_id = p_attempt_id;
  SELECT count(*)::int INTO v_answer_count
  FROM stage_attempt_answers
  WHERE attempt_id = p_attempt_id;
  SELECT count(*)::int INTO v_evidence_count
  FROM knowledge_evidence
  WHERE attempt_id = p_attempt_id
    AND student_id = p_student_id;

  IF v_item_count = 0 OR v_answer_count <> v_item_count OR v_evidence_count <> v_item_count THEN
    RAISE EXCEPTION 'knowledge evidence requires exactly one evidence row per scored attempt item' USING ERRCODE = '23514';
  END IF;
END;
$$;
