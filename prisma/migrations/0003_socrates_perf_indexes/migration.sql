-- Migration 0003: Performance indexes for Socrates history queries.
--
-- Adds a compound index on socrates_messages(session_id, created_at DESC)
-- to speed up the loadHistory query that fetches the last N turns ordered
-- by most-recent-first.  The single-column session_id index from 0002 is
-- kept because Prisma also emits equality lookups against it.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "socrates_messages_session_created_idx"
  ON "socrates_messages" ("session_id", "created_at" DESC);
