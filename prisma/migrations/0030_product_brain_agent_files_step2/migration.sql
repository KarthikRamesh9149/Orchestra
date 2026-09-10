-- Feature 12 Step 2: Product Brain Agent Files self-updating metadata.
-- Additive enum-only migration. No tables or columns are dropped or rewritten.

ALTER TYPE "AgentMarkdownFileStatus" ADD VALUE IF NOT EXISTS 'current';
ALTER TYPE "AgentMarkdownFileStatus" ADD VALUE IF NOT EXISTS 'stale';
ALTER TYPE "AgentMarkdownFileStatus" ADD VALUE IF NOT EXISTS 'generation_failed';
ALTER TYPE "AgentMarkdownFileStatus" ADD VALUE IF NOT EXISTS 'sync_pending';
ALTER TYPE "AgentMarkdownFileStatus" ADD VALUE IF NOT EXISTS 'sync_failed';
ALTER TYPE "AgentMarkdownFileStatus" ADD VALUE IF NOT EXISTS 'manual_conflict';

ALTER TYPE "AgentMarkdownSyncMode" ADD VALUE IF NOT EXISTS 'refresh';
ALTER TYPE "AgentMarkdownSyncMode" ADD VALUE IF NOT EXISTS 'diff';
ALTER TYPE "AgentMarkdownSyncMode" ADD VALUE IF NOT EXISTS 'download';
ALTER TYPE "AgentMarkdownSyncMode" ADD VALUE IF NOT EXISTS 'manifest';
ALTER TYPE "AgentMarkdownSyncMode" ADD VALUE IF NOT EXISTS 'local_cli';
ALTER TYPE "AgentMarkdownSyncMode" ADD VALUE IF NOT EXISTS 'mcp_read';
