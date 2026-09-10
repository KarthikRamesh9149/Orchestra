-- Google Drive Step 2 product integration.
-- Additive only: allow Socrates open targets to point at indexed Google Drive files.
ALTER TYPE "SocratesOpenTargetType" ADD VALUE IF NOT EXISTS 'google_drive_file';
