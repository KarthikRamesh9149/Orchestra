-- Fix 6: introduce global normalized user identities and explicit organization memberships.
-- Legacy users.org_id and role columns remain during the zero-downtime transition.

ALTER TABLE "users" ADD COLUMN "normalized_email" TEXT;

-- Fail before rewriting any identity when existing rows cannot be normalized safely.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "users"
    WHERE NULLIF(lower(btrim("email")), '') IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'unsafe blank normalized user identity detected; resolve before migration';
  END IF;

  IF EXISTS (
    SELECT lower(btrim("email"))
    FROM "users"
    GROUP BY lower(btrim("email"))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'unsafe duplicate normalized user identities detected; resolve before migration';
  END IF;
END
$$;

UPDATE "users"
SET
  "email" = lower(btrim("email")),
  "normalized_email" = lower(btrim("email"));

ALTER TABLE "users" ALTER COLUMN "normalized_email" SET NOT NULL;
ALTER TABLE "users" ADD CONSTRAINT "users_email_normalized_check"
  CHECK ("email" = lower(btrim("email")) AND "normalized_email" = "email");
CREATE UNIQUE INDEX "users_normalized_email_key" ON "users"("normalized_email");

CREATE TABLE "organization_memberships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "global_role" "GlobalRole" NOT NULL,
  "workspace_role_default" "WorkspaceRoleDefault" NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "organization_memberships"
  ADD CONSTRAINT "organization_memberships_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_memberships"
  ADD CONSTRAINT "organization_memberships_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "organization_memberships_organization_id_user_id_key"
  ON "organization_memberships"("organization_id", "user_id");
CREATE INDEX "organization_memberships_user_id_is_active_idx"
  ON "organization_memberships"("user_id", "is_active");
CREATE INDEX "organization_memberships_organization_id_is_active_global_role_idx"
  ON "organization_memberships"("organization_id", "is_active", "global_role");

INSERT INTO "organization_memberships" (
  "organization_id",
  "user_id",
  "global_role",
  "workspace_role_default",
  "is_active",
  "joined_at",
  "created_at",
  "updated_at"
)
SELECT
  "org_id",
  "id",
  "global_role",
  "workspace_role_default",
  "is_active",
  "created_at",
  "created_at",
  "updated_at"
FROM "users"
ON CONFLICT ("organization_id", "user_id") DO UPDATE SET
  "global_role" = EXCLUDED."global_role",
  "workspace_role_default" = EXCLUDED."workspace_role_default",
  "is_active" = EXCLUDED."is_active",
  "updated_at" = EXCLUDED."updated_at";

-- Old application instances may omit normalized_email and organization_memberships.
-- These triggers keep both representations consistent during a rolling deployment.
CREATE FUNCTION "sync_user_global_identity"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."email" := lower(btrim(NEW."email"));
  NEW."normalized_email" := NEW."email";
  IF NEW."email" = '' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'user email cannot be blank';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "users_sync_global_identity"
BEFORE INSERT OR UPDATE OF "email", "normalized_email" ON "users"
FOR EACH ROW EXECUTE FUNCTION "sync_user_global_identity"();

CREATE FUNCTION "sync_legacy_user_organization_membership"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."org_id" IS DISTINCT FROM NEW."org_id" THEN
    UPDATE "organization_memberships"
    SET "is_active" = false, "updated_at" = CURRENT_TIMESTAMP
    WHERE "organization_id" = OLD."org_id" AND "user_id" = NEW."id";
  END IF;

  INSERT INTO "organization_memberships" (
    "organization_id",
    "user_id",
    "global_role",
    "workspace_role_default",
    "is_active",
    "joined_at",
    "created_at",
    "updated_at"
  ) VALUES (
    NEW."org_id",
    NEW."id",
    NEW."global_role",
    NEW."workspace_role_default",
    NEW."is_active",
    NEW."created_at",
    NEW."created_at",
    NEW."updated_at"
  )
  ON CONFLICT ("organization_id", "user_id") DO UPDATE SET
    "global_role" = EXCLUDED."global_role",
    "workspace_role_default" = EXCLUDED."workspace_role_default",
    "is_active" = EXCLUDED."is_active",
    "updated_at" = EXCLUDED."updated_at";

  RETURN NEW;
END
$$;

CREATE TRIGGER "users_sync_legacy_organization_membership"
AFTER INSERT OR UPDATE OF "org_id", "global_role", "workspace_role_default", "is_active" ON "users"
FOR EACH ROW EXECUTE FUNCTION "sync_legacy_user_organization_membership"();

ALTER TABLE "organization_memberships" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE POLICY "backend_api_only_no_direct_client_access"
      ON "organization_memberships"
      AS RESTRICTIVE
      FOR ALL
      TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
END
$$;
