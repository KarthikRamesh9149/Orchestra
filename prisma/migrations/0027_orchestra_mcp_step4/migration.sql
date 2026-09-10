-- Feature 11 Step 4: Orchestra MCP Server token foundation.
-- Additive-only migration: introduces MCP token metadata and does not alter existing data.

CREATE TYPE "McpTokenMode" AS ENUM ('local_dev', 'team_internal', 'client_safe_future');

CREATE TYPE "McpTokenStatus" AS ENUM ('active', 'revoked', 'expired');

CREATE TABLE "mcp_tokens" (
  "id" UUID NOT NULL,
  "org_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "revoked_by_user_id" UUID,
  "label" TEXT NOT NULL,
  "token_prefix" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "mode" "McpTokenMode" NOT NULL,
  "status" "McpTokenStatus" NOT NULL DEFAULT 'active',
  "allowed_project_ids_json" JSONB NOT NULL,
  "allowed_tools_json" JSONB NOT NULL,
  "read_only" BOOLEAN NOT NULL DEFAULT true,
  "allow_controlled_writes" BOOLEAN NOT NULL DEFAULT false,
  "rate_limit_profile" TEXT NOT NULL DEFAULT 'standard',
  "expires_at" TIMESTAMPTZ(6),
  "last_used_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "mcp_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mcp_tokens_token_hash_key" ON "mcp_tokens"("token_hash");
CREATE INDEX "mcp_tokens_org_id_created_by_user_id_status_created_at_idx" ON "mcp_tokens"("org_id", "created_by_user_id", "status", "created_at");
CREATE INDEX "mcp_tokens_token_prefix_idx" ON "mcp_tokens"("token_prefix");
CREATE INDEX "mcp_tokens_status_expires_at_idx" ON "mcp_tokens"("status", "expires_at");
