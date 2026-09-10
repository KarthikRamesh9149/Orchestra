DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "github_installations"
    GROUP BY "github_installation_id"
    HAVING COUNT(DISTINCT "org_id") > 1
  ) THEN
    RAISE EXCEPTION 'unsafe duplicate GitHub installation claims detected';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "github_installations_installation_key"
  ON "github_installations"("github_installation_id");
