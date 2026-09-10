-- Additive: legacy runs have no lease and are not presumed abandoned by age.
ALTER TABLE "deep_research_runs"
  ADD COLUMN "lease_owner_token" UUID,
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(6);
