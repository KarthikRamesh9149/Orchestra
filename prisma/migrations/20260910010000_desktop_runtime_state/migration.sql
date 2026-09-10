CREATE TABLE desktop_limit_state (
  key text PRIMARY KEY,
  data jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE desktop_job_cancellations (
  job_id uuid PRIMARY KEY REFERENCES desktop_jobs(id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE desktop_limit_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE desktop_job_cancellations ENABLE ROW LEVEL SECURITY;
CREATE POLICY desktop_limits_owner ON desktop_limit_state TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY desktop_cancellations_owner ON desktop_job_cancellations TO CURRENT_USER USING (true) WITH CHECK (true);
