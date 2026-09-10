-- Feature 1: durable cross-source Truth Inbox workflow state.
-- Source evidence and accepted truth remain in their existing authoritative tables.

CREATE TABLE "truth_inbox_item_states" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "source_fingerprint" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "assigned_user_id" UUID,
  "clarification_note" TEXT,
  "clarification_requested_at" TIMESTAMPTZ(6),
  "clarification_requested_by_user_id" UUID,
  "deferred_until" TIMESTAMPTZ(6),
  "snoozed_until" TIMESTAMPTZ(6),
  "timeline_event_ref" TEXT,
  "proposal_id" UUID,
  "last_action_type" TEXT NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "truth_inbox_item_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "truth_inbox_item_states_source_type_check"
    CHECK ("source_type" IN ('suggestion', 'proposal', 'fde', 'agent_drift', 'connector')),
  CONSTRAINT "truth_inbox_item_states_status_check"
    CHECK ("status" IN ('active', 'deferred', 'snoozed', 'dismissed', 'resolved', 'converted_to_review', 'converted_to_timeline')),
  CONSTRAINT "truth_inbox_item_states_note_length_check"
    CHECK ("clarification_note" IS NULL OR char_length("clarification_note") <= 2000)
);

ALTER TABLE "truth_inbox_item_states"
  ADD CONSTRAINT "truth_inbox_item_states_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "truth_inbox_item_states"
  ADD CONSTRAINT "truth_inbox_item_states_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "truth_inbox_item_states"
  ADD CONSTRAINT "truth_inbox_item_states_assigned_user_id_fkey"
  FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "truth_inbox_item_states"
  ADD CONSTRAINT "truth_inbox_item_states_clarification_actor_fkey"
  FOREIGN KEY ("clarification_requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "truth_inbox_item_states"
  ADD CONSTRAINT "truth_inbox_item_states_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "truth_inbox_states_project_source_key"
  ON "truth_inbox_item_states"("project_id", "source_type", "source_id");

CREATE INDEX "truth_inbox_states_project_status_updated_idx"
  ON "truth_inbox_item_states"("project_id", "status", "updated_at" DESC);

CREATE INDEX "truth_inbox_states_project_assignee_status_idx"
  ON "truth_inbox_item_states"("project_id", "assigned_user_id", "status");

CREATE INDEX "truth_inbox_states_org_project_source_idx"
  ON "truth_inbox_item_states"("org_id", "project_id", "source_type");

CREATE INDEX "truth_inbox_states_project_snoozed_idx"
  ON "truth_inbox_item_states"("project_id", "snoozed_until");

ALTER TABLE "truth_inbox_item_states" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE POLICY "backend_api_only_no_direct_client_access"
      ON "truth_inbox_item_states"
      AS RESTRICTIVE
      FOR ALL
      TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
END
$$;

DO $$
DECLARE
  backend_role_list text;
BEGIN
  SELECT string_agg(format('%I', roles.rolname), ', ' ORDER BY roles.rolname)
  INTO backend_role_list
  FROM pg_policy policies
  CROSS JOIN LATERAL unnest(policies.polroles) AS policy_role(role_oid)
  JOIN pg_roles roles ON roles.oid = policy_role.role_oid
  WHERE policies.polrelid = 'public.organization_memberships'::regclass
    AND policies.polname = 'backend_database_role_full_access'
    AND roles.rolname NOT IN ('anon', 'authenticated');

  IF backend_role_list IS NULL THEN
    RAISE EXCEPTION 'no approved Orchestra backend database role is available';
  END IF;

  EXECUTE format(
    'CREATE POLICY %I ON public.truth_inbox_item_states AS PERMISSIVE FOR ALL TO %s USING (true) WITH CHECK (true)',
    'backend_database_role_full_access',
    backend_role_list
  );
END
$$;
