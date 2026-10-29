ALTER TABLE entities ADD COLUMN strategy_status text NOT NULL DEFAULT 'active'
  CHECK(strategy_status IN ('active','disabled','need_revised'));
ALTER TABLE entities ADD COLUMN status_reason text CHECK(status_reason IN ('low_utility','process_conflict','inactive'));
ALTER TABLE entities ADD COLUMN status_detail text;
ALTER TABLE entities ADD COLUMN status_version integer NOT NULL DEFAULT 1;
ALTER TABLE entities ADD COLUMN status_updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE entities ADD COLUMN activity_started_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE entities ADD COLUMN last_retrieved_at timestamptz;
ALTER TABLE entities ADD COLUMN inactivity_days integer CHECK(inactivity_days > 0);
ALTER TABLE entities ADD COLUMN inactivity_exempt boolean NOT NULL DEFAULT false;
ALTER TABLE jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE jobs ADD CHECK(kind IN ('ingest','distill','feedback'));
ALTER TABLE worker_scheduler ADD COLUMN feedback_turn boolean NOT NULL DEFAULT true;
ALTER TABLE worker_scheduler ADD COLUMN inactivity_checked_at timestamptz;
CREATE TABLE strategy_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), fingerprint text NOT NULL UNIQUE,
  entity_id uuid NOT NULL REFERENCES entities(id), revision integer NOT NULL,
  input jsonb NOT NULL, job_id uuid NOT NULL REFERENCES jobs(id), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(entity_id,revision) REFERENCES revisions(entity_id,revision)
);
CREATE TABLE strategy_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_id uuid NOT NULL REFERENCES entities(id),
  job_id uuid REFERENCES jobs(id), event text NOT NULL, detail jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX strategy_events_entity ON strategy_events(entity_id,created_at);
CREATE TABLE strategy_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_id uuid NOT NULL REFERENCES entities(id),
  job_id uuid NOT NULL REFERENCES jobs(id), base_revision integer NOT NULL, status_version integer NOT NULL,
  content jsonb NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id,status_version)
);
CREATE TRIGGER immutable_strategy_drafts BEFORE UPDATE OR DELETE ON strategy_drafts
  FOR EACH ROW EXECUTE FUNCTION immutable_revision();
CREATE TRIGGER immutable_strategy_events BEFORE UPDATE OR DELETE ON strategy_events
  FOR EACH ROW EXECUTE FUNCTION immutable_revision();
