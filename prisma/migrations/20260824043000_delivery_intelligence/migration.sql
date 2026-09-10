-- Features 4-10: durable receipts, Socrates correction feedback, and weekly briefs.
-- Delivery traces, context health, preflight/postflight, and release truth are
-- derived read models over authoritative project records and do not duplicate truth.

CREATE TABLE "decision_receipts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "decision_record_id" UUID,
  "issued_by_user_id" UUID NOT NULL,
  "receipt_version" INTEGER NOT NULL DEFAULT 1,
  "content_hash" TEXT NOT NULL,
  "receipt_json" JSONB NOT NULL,
  "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "decision_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "decision_receipts_version_check" CHECK ("receipt_version" > 0),
  CONSTRAINT "decision_receipts_hash_check" CHECK (char_length("content_hash") = 64)
);

CREATE TABLE "socrates_response_feedback" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "assistant_message_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "correction_text" TEXT,
  "needs_human_review" BOOLEAN NOT NULL DEFAULT false,
  "citations_snapshot_json" JSONB NOT NULL DEFAULT '[]',
  "product_brain_version_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "socrates_response_feedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "socrates_feedback_reason_check"
    CHECK ("reason" IN ('helpful', 'incorrect', 'outdated', 'missing_evidence', 'wrong_source', 'wrong_current_truth')),
  CONSTRAINT "socrates_feedback_correction_length_check"
    CHECK ("correction_text" IS NULL OR char_length("correction_text") <= 2000)
);

CREATE TABLE "weekly_executive_briefs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "generated_by_user_id" UUID NOT NULL,
  "week_start" DATE NOT NULL,
  "week_end" DATE NOT NULL,
  "source_fingerprint" TEXT NOT NULL,
  "content_json" JSONB NOT NULL,
  "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "weekly_executive_briefs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "weekly_briefs_date_range_check" CHECK ("week_end" >= "week_start"),
  CONSTRAINT "weekly_briefs_fingerprint_check" CHECK (char_length("source_fingerprint") = 64)
);

ALTER TABLE "decision_receipts"
  ADD CONSTRAINT "decision_receipts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "decision_receipts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "decision_receipts_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "spec_change_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "decision_receipts_decision_record_id_fkey" FOREIGN KEY ("decision_record_id") REFERENCES "decision_records"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "decision_receipts_issued_by_user_id_fkey" FOREIGN KEY ("issued_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "socrates_response_feedback"
  ADD CONSTRAINT "socrates_feedback_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "socrates_feedback_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "socrates_feedback_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "socrates_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "socrates_feedback_assistant_message_id_fkey" FOREIGN KEY ("assistant_message_id") REFERENCES "socrates_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "socrates_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "socrates_feedback_brain_version_id_fkey" FOREIGN KEY ("product_brain_version_id") REFERENCES "artifact_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "weekly_executive_briefs"
  ADD CONSTRAINT "weekly_briefs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "weekly_briefs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "weekly_briefs_generated_by_user_id_fkey" FOREIGN KEY ("generated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "decision_receipts_proposal_key" ON "decision_receipts"("proposal_id");
CREATE UNIQUE INDEX "decision_receipts_content_hash_key" ON "decision_receipts"("content_hash");
CREATE INDEX "decision_receipts_org_project_issued_idx" ON "decision_receipts"("org_id", "project_id", "issued_at" DESC);
CREATE INDEX "decision_receipts_project_decision_idx" ON "decision_receipts"("project_id", "decision_record_id");
CREATE INDEX "decision_receipts_issuer_idx" ON "decision_receipts"("issued_by_user_id");

CREATE UNIQUE INDEX "socrates_feedback_message_user_key" ON "socrates_response_feedback"("assistant_message_id", "user_id");
CREATE INDEX "socrates_feedback_project_review_idx" ON "socrates_response_feedback"("project_id", "reason", "needs_human_review", "updated_at" DESC);
CREATE INDEX "socrates_feedback_org_project_created_idx" ON "socrates_response_feedback"("org_id", "project_id", "created_at" DESC);
CREATE INDEX "socrates_feedback_session_idx" ON "socrates_response_feedback"("session_id");
CREATE INDEX "socrates_feedback_user_idx" ON "socrates_response_feedback"("user_id");
CREATE INDEX "socrates_feedback_brain_version_idx" ON "socrates_response_feedback"("product_brain_version_id");

CREATE UNIQUE INDEX "weekly_briefs_project_week_key" ON "weekly_executive_briefs"("project_id", "week_start");
CREATE INDEX "weekly_briefs_org_project_generated_idx" ON "weekly_executive_briefs"("org_id", "project_id", "generated_at" DESC);
CREATE INDEX "weekly_briefs_generator_idx" ON "weekly_executive_briefs"("generated_by_user_id");

ALTER TABLE "decision_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "socrates_response_feedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "weekly_executive_briefs" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  target_table text;
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

  FOREACH target_table IN ARRAY ARRAY['decision_receipts', 'socrates_response_feedback', 'weekly_executive_briefs']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
       AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        'backend_api_only_no_direct_client_access', target_table
      );
    END IF;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS PERMISSIVE FOR ALL TO %s USING (true) WITH CHECK (true)',
      'backend_database_role_full_access', target_table, backend_role_list
    );
  END LOOP;
END
$$;
