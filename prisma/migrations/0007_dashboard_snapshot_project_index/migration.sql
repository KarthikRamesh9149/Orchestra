CREATE INDEX IF NOT EXISTS "dashboard_snapshots_project_scope_idx"
  ON "dashboard_snapshots"("project_id", "scope", "computed_at" DESC);
