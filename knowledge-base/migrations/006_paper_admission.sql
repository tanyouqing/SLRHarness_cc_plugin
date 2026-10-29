CREATE TABLE paper_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES jobs(id),
  content_hash text NOT NULL, metadata_hash text NOT NULL, content jsonb NOT NULL, policy text NOT NULL DEFAULT 'paper-conflicts-v2',
  status text NOT NULL DEFAULT 'checking' CHECK(status IN ('checking','held','passed')),
  dossier jsonb NOT NULL DEFAULT '{"documents":[],"errors":[],"searched":false}',
  report jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(status<>'passed' OR COALESCE(report->'L1'->>'passed'='true' AND report->'L2'->>'passed'='true',false))
);
CREATE INDEX paper_checks_job ON paper_checks(job_id,created_at);
CREATE INDEX paper_checks_passed_hash ON paper_checks(content_hash) WHERE status='passed';
CREATE INDEX paper_checks_identity_hash ON paper_checks(metadata_hash) WHERE status='passed';
CREATE FUNCTION protect_paper_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status<>'checking' THEN RAISE EXCEPTION 'completed paper checks are immutable'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_completed_paper_checks BEFORE UPDATE OR DELETE ON paper_checks
FOR EACH ROW EXECUTE FUNCTION protect_paper_check();
-- Existing revisions remain unchanged. New paper revisions require approved evidence.
CREATE FUNCTION require_paper_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM entities WHERE id=NEW.entity_id AND kind='paper') AND
     NOT EXISTS(SELECT 1 FROM paper_checks WHERE content_hash=NEW.content_hash AND status='passed')
  THEN RAISE EXCEPTION 'paper revision requires L1 and L2 approval'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER paper_revision_admission BEFORE INSERT ON revisions FOR EACH ROW EXECUTE FUNCTION require_paper_admission();
