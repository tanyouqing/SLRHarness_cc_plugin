CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK(kind IN ('paper','experience')),
  current_revision integer, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE revisions (
  entity_id uuid NOT NULL REFERENCES entities(id), revision integer NOT NULL CHECK(revision > 0),
  content jsonb NOT NULL, content_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(entity_id,revision)
);
ALTER TABLE entities ADD FOREIGN KEY(id,current_revision) REFERENCES revisions(entity_id,revision) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX revisions_hash ON revisions(content_hash);
CREATE TABLE trajectories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), content text NOT NULL, content_hash text NOT NULL UNIQUE,
  line_count integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE experience_sources (
  experience_id uuid NOT NULL REFERENCES entities(id), trajectory_id uuid NOT NULL REFERENCES trajectories(id),
  start_line integer, end_line integer,
  CHECK ((start_line IS NULL AND end_line IS NULL) OR (start_line >= 1 AND end_line >= start_line)),
  UNIQUE NULLS NOT DISTINCT(experience_id,trajectory_id,start_line,end_line)
);
CREATE TABLE search_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_id uuid NOT NULL, revision integer NOT NULL,
  ordinal integer NOT NULL, location jsonb NOT NULL, text text NOT NULL,
  keywords tsvector NOT NULL, embedding vector(1024) NOT NULL, model_version text NOT NULL,
  FOREIGN KEY(entity_id,revision) REFERENCES revisions(entity_id,revision), UNIQUE(entity_id,revision,ordinal)
);
CREATE INDEX chunks_keywords ON search_chunks USING gin(keywords);
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK(kind IN ('ingest','distill')),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed')),
  payload jsonb NOT NULL, checkpoint jsonb, result jsonb, error text,
  attempts integer NOT NULL DEFAULT 0, run_after timestamptz NOT NULL DEFAULT now(),
  lease_token uuid, lease_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_queue ON jobs(status,run_after,created_at);
CREATE UNIQUE INDEX one_distill_per_trajectory ON jobs((payload->>'trajectory_id')) WHERE kind='distill';
CREATE TABLE ingestions (
  kind text NOT NULL, content_hash text NOT NULL, job_id uuid NOT NULL REFERENCES jobs(id),
  entity_id uuid REFERENCES entities(id), PRIMARY KEY(kind,content_hash)
);
CREATE TABLE decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES jobs(id),
  entity_id uuid NOT NULL REFERENCES entities(id), decision jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE conflicts (
  left_id uuid NOT NULL REFERENCES entities(id), right_id uuid NOT NULL REFERENCES entities(id), reason text NOT NULL,
  PRIMARY KEY(left_id,right_id)
);
CREATE VIEW papers AS SELECT e.id,e.current_revision,r.content->'metadata' AS metadata,r.content->>'note' AS note,e.created_at,e.updated_at
  FROM entities e JOIN revisions r ON r.entity_id=e.id AND r.revision=e.current_revision WHERE e.kind='paper';
CREATE VIEW experiences AS SELECT e.id,e.current_revision,r.content,e.created_at,e.updated_at
  FROM entities e JOIN revisions r ON r.entity_id=e.id AND r.revision=e.current_revision WHERE e.kind='experience';
CREATE FUNCTION immutable_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'revisions are immutable'; END $$;
CREATE TRIGGER immutable_revisions BEFORE UPDATE OR DELETE ON revisions FOR EACH ROW EXECUTE FUNCTION immutable_revision();
