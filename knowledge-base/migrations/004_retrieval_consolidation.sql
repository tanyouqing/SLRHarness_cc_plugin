-- Private, versioned working indexes. Never join these into public search.
CREATE TABLE distillation_candidate_indexes (
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  candidate_id text NOT NULL,
  content_version text NOT NULL,
  role text NOT NULL CHECK(role IN ('worker','manager','scoper','paper')),
  model_version text NOT NULL,
  PRIMARY KEY(job_id,candidate_id,content_version,model_version)
);
CREATE TABLE distillation_candidate_chunks (
  job_id uuid NOT NULL,
  candidate_id text NOT NULL,
  content_version text NOT NULL,
  model_version text NOT NULL,
  ordinal integer NOT NULL,
  keywords tsvector NOT NULL,
  embedding vector(1024) NOT NULL,
  PRIMARY KEY(job_id,candidate_id,content_version,model_version,ordinal),
  FOREIGN KEY(job_id,candidate_id,content_version,model_version)
    REFERENCES distillation_candidate_indexes ON DELETE CASCADE
);
CREATE INDEX distillation_chunks_keywords ON distillation_candidate_chunks USING gin(keywords);
ALTER TABLE worker_scheduler ADD COLUMN completion_streak integer NOT NULL DEFAULT 0;
