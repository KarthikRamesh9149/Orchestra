CREATE INDEX IF NOT EXISTS "audit_events_project_created_at_idx"
  ON "audit_events" ("project_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "audit_events_org_created_at_idx"
  ON "audit_events" ("org_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "audit_events_actor_created_at_idx"
  ON "audit_events" ("actor_user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "audit_events_org_event_created_at_idx"
  ON "audit_events" ("org_id", "event_type", "created_at" DESC);
