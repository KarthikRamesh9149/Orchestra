CREATE TABLE desktop_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','cancelled')),
  owner_token uuid,
  fence bigint NOT NULL DEFAULT 0,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  failure_code text,
  UNIQUE(name, idempotency_key)
);
CREATE INDEX desktop_jobs_ready_idx ON desktop_jobs (available_at, created_at) WHERE status = 'queued';
CREATE INDEX desktop_jobs_lease_idx ON desktop_jobs (lease_until) WHERE status = 'running';
ALTER TABLE desktop_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY desktop_jobs_owner ON desktop_jobs TO CURRENT_USER USING (true) WITH CHECK (true);
