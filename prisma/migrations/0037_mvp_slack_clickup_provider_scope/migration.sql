-- Step 1 provider-scope foundation for Slack + ClickUp communication evidence.
-- Additive enum change only; no table/column drops, credential storage changes, or data rewrites.
ALTER TYPE "CommunicationProvider" ADD VALUE IF NOT EXISTS 'clickup';
