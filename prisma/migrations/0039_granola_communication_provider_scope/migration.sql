-- Add Granola as a provider-neutral communication evidence source.
ALTER TYPE "CommunicationProvider" ADD VALUE IF NOT EXISTS 'granola';
