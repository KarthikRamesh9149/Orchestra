ALTER TABLE "deep_research_runs"
  ADD COLUMN "privacy_mode" TEXT NOT NULL DEFAULT 'internal_only',
  ADD COLUMN "web_search_requested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "progress_percent" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "progress_stage" TEXT NOT NULL DEFAULT 'queued';

ALTER TABLE "deep_research_runs"
  ADD CONSTRAINT "deep_research_runs_privacy_mode_check"
    CHECK ("privacy_mode" IN ('internal_only', 'internal_plus_web')),
  ADD CONSTRAINT "deep_research_runs_progress_percent_check"
    CHECK ("progress_percent" BETWEEN 0 AND 100);

ALTER TABLE "project_context_entries"
  ADD COLUMN "deep_research_run_id" UUID;

ALTER TABLE "project_context_entries"
  ADD CONSTRAINT "project_context_entries_deep_research_run_fkey"
    FOREIGN KEY ("deep_research_run_id") REFERENCES "deep_research_runs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "project_context_entries_deep_research_run_key"
  ON "project_context_entries"("deep_research_run_id");
