-- Additive provider enum expansion for Zoho communication connectors.
-- No existing rows, columns, or enum values are removed.
ALTER TYPE "CommunicationProvider" ADD VALUE IF NOT EXISTS 'zoho_mail';
ALTER TYPE "CommunicationProvider" ADD VALUE IF NOT EXISTS 'zoho_cliq';
ALTER TYPE "CommunicationProvider" ADD VALUE IF NOT EXISTS 'zoho_crm';
