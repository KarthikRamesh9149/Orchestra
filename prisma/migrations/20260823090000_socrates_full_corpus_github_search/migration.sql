-- Socrates and Deep Research search the complete active GitHub evidence corpus
-- before hydration. This expression exactly matches the indexed retrieval
-- predicate and avoids loading an arbitrary recent window into application
-- memory before relevance is known.
CREATE INDEX IF NOT EXISTS "github_engineering_evidence_lexical_content_idx"
ON "github_engineering_evidence" USING GIN (
  to_tsvector(
    'english',
    coalesce("title", '') || ' ' || coalesce("summary", '') || ' ' ||
    coalesce("repository_owner", '') || ' ' || coalesce("repository_name", '') || ' ' ||
    coalesce("branch", '') || ' ' || coalesce("sha", '') || ' ' ||
    coalesce("path", '') || ' ' || coalesce("status", '')
  )
);
