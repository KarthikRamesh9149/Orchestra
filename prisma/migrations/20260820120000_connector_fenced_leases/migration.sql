ALTER TABLE "communication_connectors"
  ADD COLUMN "lease_owner_token" UUID,
  ADD COLUMN "lease_fencing_token" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "lease_heartbeat_at" TIMESTAMPTZ(6),
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(6);

ALTER TABLE "communication_sync_runs"
  ADD COLUMN "idempotency_key" TEXT,
  ADD COLUMN "lease_owner_token" UUID,
  ADD COLUMN "lease_fencing_token" BIGINT;

CREATE UNIQUE INDEX "communication_sync_runs_idempotency_key"
  ON "communication_sync_runs"("idempotency_key");

CREATE INDEX "communication_connectors_lease_expiry_idx"
  ON "communication_connectors"("lease_expires_at");

ALTER TABLE "communication_connectors"
  ADD CONSTRAINT "communication_connectors_lease_shape_check"
  CHECK (
    ("lease_owner_token" IS NULL AND "lease_heartbeat_at" IS NULL AND "lease_expires_at" IS NULL)
    OR
    ("lease_owner_token" IS NOT NULL AND "lease_heartbeat_at" IS NOT NULL AND "lease_expires_at" IS NOT NULL AND "lease_expires_at" > "lease_heartbeat_at")
  );

ALTER TABLE "communication_sync_runs"
  ADD CONSTRAINT "communication_sync_runs_lease_shape_check"
  CHECK (
    ("lease_owner_token" IS NULL AND "lease_fencing_token" IS NULL)
    OR
    ("lease_owner_token" IS NOT NULL AND "lease_fencing_token" IS NOT NULL AND "lease_fencing_token" > 0)
  );
