-- Additive beta-only VS Code connector state.
-- No destructive DDL: stores one-time pairing hashes and revocable token hashes.

CREATE TABLE IF NOT EXISTS "project_editor_connectors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "connector_type" text NOT NULL DEFAULT 'vscode',
  "label" text NOT NULL,
  "pairing_code_hash" text UNIQUE,
  "token_hash" text UNIQUE,
  "token_prefix" text,
  "status" text NOT NULL DEFAULT 'pairing_pending',
  "scopes_json" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz,
  "last_used_at" timestamptz,
  "revoked_at" timestamptz,
  "metadata_json" jsonb,
  CONSTRAINT "project_editor_connectors_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_editor_connectors_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_editor_connectors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_editor_connectors_connector_type_check" CHECK ("connector_type" = 'vscode'),
  CONSTRAINT "project_editor_connectors_status_check" CHECK ("status" IN ('pairing_pending', 'connected', 'expired', 'revoked'))
);

CREATE INDEX IF NOT EXISTS "project_editor_connectors_org_project_status_idx"
  ON "project_editor_connectors"("org_id", "project_id", "connector_type", "status");

CREATE INDEX IF NOT EXISTS "project_editor_connectors_project_user_status_idx"
  ON "project_editor_connectors"("project_id", "user_id", "connector_type", "status");

CREATE INDEX IF NOT EXISTS "project_editor_connectors_status_expires_idx"
  ON "project_editor_connectors"("status", "expires_at");

CREATE INDEX IF NOT EXISTS "project_editor_connectors_token_prefix_idx"
  ON "project_editor_connectors"("token_prefix");

ALTER TABLE "project_editor_connectors" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policy
    WHERE polrelid = 'project_editor_connectors'::regclass
      AND polname = 'backend_api_only_no_direct_client_access'
  ) THEN
    CREATE POLICY "backend_api_only_no_direct_client_access"
      ON "project_editor_connectors"
      AS RESTRICTIVE
      FOR ALL
      TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
END
$$;
