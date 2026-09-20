-- Keep query-time ranking from reparsing every matched document chunk.
-- The English expression is identical to the existing lexical GIN expression;
-- PostgreSQL maintains it on both inserts and lexical_content updates.
SET lock_timeout = '5s';
SET statement_timeout = '120s';

ALTER TABLE "document_chunks"
  ADD COLUMN "lexical_search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english'::regconfig, "lexical_content")) STORED;

RESET statement_timeout;
RESET lock_timeout;
