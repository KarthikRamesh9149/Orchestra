CREATE TABLE "fde_readiness_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "started_by_user_id" UUID,
  "run_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "counts_json" JSONB NOT NULL DEFAULT '{}',
  "warnings_json" JSONB NOT NULL DEFAULT '[]',
  "errors_json" JSONB NOT NULL DEFAULT '[]',
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fde_readiness_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fde_readiness_findings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "finding_type" TEXT NOT NULL,
  "finding_sub_type" TEXT NOT NULL,
  "finding_key" TEXT NOT NULL,
  "target_kind" TEXT,
  "target_ref" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "severity" TEXT NOT NULL DEFAULT 'info',
  "confidence" TEXT NOT NULL DEFAULT 'medium',
  "summary" TEXT NOT NULL,
  "why_it_matters" TEXT,
  "suggested_action" TEXT,
  "source_domains_json" JSONB NOT NULL DEFAULT '[]',
  "evidence_ids_json" JSONB NOT NULL DEFAULT '[]',
  "affected_json" JSONB NOT NULL DEFAULT '{}',
  "actors_json" JSONB NOT NULL DEFAULT '[]',
  "citations_json" JSONB NOT NULL DEFAULT '[]',
  "open_targets_json" JSONB NOT NULL DEFAULT '[]',
  "reasons_json" JSONB NOT NULL DEFAULT '[]',
  "limitations_json" JSONB NOT NULL DEFAULT '[]',
  "warnings_json" JSONB NOT NULL DEFAULT '[]',
  "metadata_json" JSONB NOT NULL DEFAULT '{}',
  "created_by_user_id" UUID,
  "dismissed_at" TIMESTAMPTZ(6),
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fde_readiness_findings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fde_rationale_traces" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "anchor_type" TEXT NOT NULL,
  "anchor_ref" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'partial',
  "overall_confidence" TEXT NOT NULL DEFAULT 'unverified',
  "summary" TEXT,
  "citations_json" JSONB NOT NULL DEFAULT '[]',
  "open_targets_json" JSONB NOT NULL DEFAULT '[]',
  "limitations_json" JSONB NOT NULL DEFAULT '[]',
  "warnings_json" JSONB NOT NULL DEFAULT '[]',
  "metadata_json" JSONB NOT NULL DEFAULT '{}',
  "created_by_user_id" UUID,
  "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fde_rationale_traces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fde_rationale_trace_hops" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "trace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "hop_order" INTEGER NOT NULL,
  "hop_type" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_ref" TEXT,
  "title" TEXT,
  "excerpt" TEXT,
  "actor" TEXT,
  "occurred_at" TIMESTAMPTZ(6),
  "confidence" TEXT NOT NULL,
  "citation_json" JSONB NOT NULL DEFAULT '{}',
  "open_target_json" JSONB NOT NULL DEFAULT '{}',
  "inclusion_reason" TEXT,
  "ordering_reason" TEXT,
  "limitations_json" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fde_rationale_trace_hops_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fde_decision_engineering_links" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "decision_id" UUID NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_ref" TEXT NOT NULL,
  "relationship_type" TEXT NOT NULL,
  "confidence" TEXT NOT NULL DEFAULT 'manual_linked',
  "evidence_ids_json" JSONB NOT NULL DEFAULT '[]',
  "citations_json" JSONB NOT NULL DEFAULT '[]',
  "open_targets_json" JSONB NOT NULL DEFAULT '[]',
  "limitations_json" JSONB NOT NULL DEFAULT '[]',
  "metadata_json" JSONB NOT NULL DEFAULT '{}',
  "created_by_user_id" UUID,
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fde_decision_engineering_links_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fde_readiness_runs_org_project_type_status_idx" ON "fde_readiness_runs"("org_id", "project_id", "run_type", "status", "created_at");
CREATE UNIQUE INDEX "fde_readiness_findings_project_key" ON "fde_readiness_findings"("project_id", "finding_key");
CREATE INDEX "fde_findings_org_project_type_status_idx" ON "fde_readiness_findings"("org_id", "project_id", "finding_type", "status", "updated_at");
CREATE INDEX "fde_findings_project_target_idx" ON "fde_readiness_findings"("project_id", "target_kind", "target_ref");
CREATE INDEX "fde_findings_project_severity_confidence_idx" ON "fde_readiness_findings"("project_id", "severity", "confidence");
CREATE INDEX "fde_traces_org_project_anchor_idx" ON "fde_rationale_traces"("org_id", "project_id", "anchor_type", "generated_at");
CREATE UNIQUE INDEX "fde_trace_hops_trace_order_key" ON "fde_rationale_trace_hops"("trace_id", "hop_order");
CREATE INDEX "fde_trace_hops_project_type_idx" ON "fde_rationale_trace_hops"("project_id", "hop_type", "source_type");
CREATE UNIQUE INDEX "fde_decision_links_project_target_key" ON "fde_decision_engineering_links"("project_id", "decision_id", "target_type", "target_ref", "relationship_type");
CREATE INDEX "fde_decision_links_org_project_target_idx" ON "fde_decision_engineering_links"("org_id", "project_id", "target_type", "archived_at");

ALTER TABLE "fde_readiness_runs" ADD CONSTRAINT "fde_readiness_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fde_readiness_runs" ADD CONSTRAINT "fde_readiness_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fde_readiness_runs" ADD CONSTRAINT "fde_readiness_runs_started_by_user_id_fkey" FOREIGN KEY ("started_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fde_readiness_findings" ADD CONSTRAINT "fde_readiness_findings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fde_readiness_findings" ADD CONSTRAINT "fde_readiness_findings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fde_readiness_findings" ADD CONSTRAINT "fde_readiness_findings_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fde_rationale_traces" ADD CONSTRAINT "fde_rationale_traces_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fde_rationale_traces" ADD CONSTRAINT "fde_rationale_traces_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fde_rationale_traces" ADD CONSTRAINT "fde_rationale_traces_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fde_rationale_trace_hops" ADD CONSTRAINT "fde_rationale_trace_hops_trace_id_fkey" FOREIGN KEY ("trace_id") REFERENCES "fde_rationale_traces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fde_decision_engineering_links" ADD CONSTRAINT "fde_decision_engineering_links_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fde_decision_engineering_links" ADD CONSTRAINT "fde_decision_engineering_links_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fde_decision_engineering_links" ADD CONSTRAINT "fde_decision_engineering_links_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "decision_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fde_decision_engineering_links" ADD CONSTRAINT "fde_decision_engineering_links_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
