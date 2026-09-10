-- Migration 0004: Socrates hardening
--
-- Fixes schema integrity gaps discovered in the Feature 1 + Feature 2 audit:
--   1. Allow citations to reference the accepted Product Brain artifact directly.
--   2. Enforce page_context integrity on socrates_suggestions via enum type.
--   3. Add indexes for suggestion freshness lookups and citation/source lookups.

ALTER TYPE "SocratesCitationType" ADD VALUE IF NOT EXISTS 'product_brain';

ALTER TABLE "socrates_suggestions"
  ALTER COLUMN "page_context"
  TYPE "SocratesPageContext"
  USING "page_context"::"SocratesPageContext";

CREATE INDEX IF NOT EXISTS "socrates_suggestions_session_page_exp_idx"
  ON "socrates_suggestions" ("session_id", "page_context", "expires_at" DESC);

CREATE INDEX IF NOT EXISTS "socrates_citations_project_ref_idx"
  ON "socrates_citations" ("project_id", "citation_type", "ref_id");
