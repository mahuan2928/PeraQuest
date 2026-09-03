-- 題庫基盤。PRD 3.4 の「発布台帳」を列として持ち、
-- 台帳が欠けた内容が公開されないことをデータベース側で保証します。

CREATE TABLE content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_kind text NOT NULL CHECK (item_kind IN ('word_order', 'article', 'katakana', 'pronunciation', 'mcq')),
  exam_level text NOT NULL DEFAULT 'eiken_grade_3' CHECK (exam_level = 'eiken_grade_3'),
  knowledge_point_ref text NOT NULL CHECK (btrim(knowledge_point_ref) <> ''),
  skill_ref text NOT NULL CHECK (btrim(skill_ref) <> ''),
  payload jsonb NOT NULL,

  -- 発布台帳（PRD 3.4）。下書きの間は NULL を許し、公開時に全項目を要求します。
  dataset_version text,
  content_version text,
  source_name text,
  source_url text,
  license_name text,
  license_scope text,
  commercial_allowed boolean,
  attribution_text text,
  attribution_location text,
  author text,
  reviewer text,
  reviewed_at timestamptz,
  evidence_link text,

  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'published', 'retired')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (updated_at >= created_at)
);

CREATE INDEX content_items_published_idx
  ON content_items(exam_level, item_kind, knowledge_point_ref)
  WHERE status = 'published';

CREATE INDEX content_items_review_idx
  ON content_items(status, updated_at DESC);

-- 公開ゲート。台帳のどれか一つでも欠けていれば公開できません。
CREATE OR REPLACE FUNCTION enforce_content_item_publish()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_missing text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'content items are retired, not deleted' USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'published' THEN
    -- 公開済みの内容を書き換えると reviewed_at の審査根拠が失われます。
    -- 変更したい場合は retire して新しい content_version を作ります。
    IF NEW.item_kind IS DISTINCT FROM OLD.item_kind
       OR NEW.knowledge_point_ref IS DISTINCT FROM OLD.knowledge_point_ref
       OR NEW.skill_ref IS DISTINCT FROM OLD.skill_ref
       OR NEW.payload IS DISTINCT FROM OLD.payload
       OR NEW.content_version IS DISTINCT FROM OLD.content_version
       OR NEW.dataset_version IS DISTINCT FROM OLD.dataset_version
       OR NEW.license_name IS DISTINCT FROM OLD.license_name
       OR NEW.reviewer IS DISTINCT FROM OLD.reviewer
       OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at THEN
      RAISE EXCEPTION 'published content items are immutable; retire and publish a new content_version'
        USING ERRCODE = '55000';
    END IF;
    IF NEW.status NOT IN ('published', 'retired') THEN
      RAISE EXCEPTION 'published content items may only be retired' USING ERRCODE = '23514';
    END IF;
  END IF;

  -- retired から公開へ戻すときは、必ず審査をやり直します。
  IF TG_OP = 'UPDATE' AND OLD.status = 'retired' AND NEW.status = 'published'
     AND NEW.reviewed_at IS NOT DISTINCT FROM OLD.reviewed_at THEN
    RAISE EXCEPTION 'retired content items require a fresh review before publishing again'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'published' THEN
    v_missing := ARRAY(
      SELECT column_name FROM (VALUES
        ('dataset_version', NEW.dataset_version),
        ('content_version', NEW.content_version),
        ('source_name', NEW.source_name),
        ('source_url', NEW.source_url),
        ('license_name', NEW.license_name),
        ('license_scope', NEW.license_scope),
        ('attribution_text', NEW.attribution_text),
        ('attribution_location', NEW.attribution_location),
        ('author', NEW.author),
        ('reviewer', NEW.reviewer),
        ('evidence_link', NEW.evidence_link)
      ) AS ledger(column_name, value)
      WHERE value IS NULL OR btrim(value) = ''
    );
    IF NEW.commercial_allowed IS NULL THEN
      v_missing := array_append(v_missing, 'commercial_allowed');
    END IF;
    IF NEW.reviewed_at IS NULL THEN
      v_missing := array_append(v_missing, 'reviewed_at');
    END IF;
    IF array_length(v_missing, 1) IS NOT NULL THEN
      RAISE EXCEPTION 'content item cannot be published without its publication ledger: %',
        array_to_string(v_missing, ', ') USING ERRCODE = '23514';
    END IF;
    IF NEW.commercial_allowed IS NOT TRUE THEN
      RAISE EXCEPTION 'content item cannot be published unless the source allows commercial use'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER content_items_publish_trg
BEFORE INSERT OR UPDATE OR DELETE ON content_items
FOR EACH ROW EXECUTE FUNCTION enforce_content_item_publish();

CREATE OR REPLACE FUNCTION reject_content_item_truncate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'content items are retired, not truncated' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER content_items_truncate_trg
BEFORE TRUNCATE ON content_items
FOR EACH STATEMENT EXECUTE FUNCTION reject_content_item_truncate();

COMMENT ON TABLE content_items IS
  'Eiken Grade 3 item bank. The publication ledger columns come from PRD 3.4: an item cannot reach published without source, licence, attribution, author, reviewer, and evidence, and only when the source permits commercial use.';
