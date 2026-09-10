-- CreateEnum
CREATE TYPE "ClientShareStatus" AS ENUM ('active', 'revoked', 'expired');

-- CreateTable
CREATE TABLE "project_client_shares" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "status" "ClientShareStatus" NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "last_accessed_at" TIMESTAMPTZ(6),
    "config_json" JSONB,

    CONSTRAINT "project_client_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_client_shares_token_hash_key" ON "project_client_shares"("token_hash");

-- CreateIndex
CREATE INDEX "project_client_shares_project_id_status_idx" ON "project_client_shares"("project_id", "status");

-- CreateIndex
CREATE INDEX "project_client_shares_org_id_status_idx" ON "project_client_shares"("org_id", "status");

-- CreateIndex
CREATE INDEX "project_client_shares_expires_at_idx" ON "project_client_shares"("expires_at");

-- AddForeignKey
ALTER TABLE "project_client_shares" ADD CONSTRAINT "project_client_shares_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_client_shares" ADD CONSTRAINT "project_client_shares_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_client_shares" ADD CONSTRAINT "project_client_shares_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
