-- CreateEnum
CREATE TYPE "DeepResearchStatus" AS ENUM ('queued', 'running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "deep_research_runs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "research_focus" TEXT NOT NULL,
    "sources_json" JSONB NOT NULL DEFAULT '[]',
    "output_format" TEXT NOT NULL,
    "status" "DeepResearchStatus" NOT NULL DEFAULT 'queued',
    "results_json" JSONB,
    "stats_json" JSONB NOT NULL DEFAULT '{}',
    "web_search_used" BOOLEAN NOT NULL DEFAULT false,
    "estimated_cost_usd" DECIMAL(8,4),
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "deep_research_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deep_research_runs_scope_idx" ON "deep_research_runs"("org_id", "project_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "deep_research_runs_user_idx" ON "deep_research_runs"("project_id", "created_by_user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "deep_research_runs" ADD CONSTRAINT "deep_research_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
