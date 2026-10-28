CREATE TABLE trajectory_origins (
  trajectory_id uuid NOT NULL REFERENCES trajectories(id),
  metadata_hash text NOT NULL, metadata jsonb NOT NULL,
  PRIMARY KEY(trajectory_id,metadata_hash)
);
CREATE TABLE trajectory_transfers (
  id text PRIMARY KEY, content_hash text NOT NULL, part_count integer NOT NULL CHECK(part_count>0),
  metadata jsonb, receipt jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE trajectory_transfer_parts (
  transfer_id text NOT NULL REFERENCES trajectory_transfers(id) ON DELETE CASCADE,
  part_index integer NOT NULL CHECK(part_index>=0), content text NOT NULL, content_hash text NOT NULL,
  PRIMARY KEY(transfer_id,part_index)
);
ALTER TABLE jobs ADD COLUMN scheduled_at timestamptz;
CREATE TABLE worker_scheduler (id boolean PRIMARY KEY DEFAULT true CHECK(id), ingest_streak integer NOT NULL DEFAULT 0);
INSERT INTO worker_scheduler(id) VALUES(true);
