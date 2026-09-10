-- Fix 7: enforce active organization context for project authorization.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "project_members"
    WHERE "project_role" = 'client'
      AND "can_approve_truth_changes" = TRUE
  ) THEN
    RAISE EXCEPTION 'Cannot enforce client truth-approval constraint: invalid project memberships exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "project_members" AS pm
    JOIN "projects" AS p ON p."id" = pm."project_id"
    LEFT JOIN "organization_memberships" AS om
      ON om."organization_id" = p."org_id"
      AND om."user_id" = pm."user_id"
      AND om."is_active" = TRUE
    WHERE pm."is_active" = TRUE
      AND om."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot enforce project tenant membership: active cross-tenant project memberships exist';
  END IF;
END
$$;

CREATE INDEX "project_members_user_id_is_active_project_id_idx"
  ON "project_members" ("user_id", "is_active", "project_id");

ALTER TABLE "project_members"
  ADD CONSTRAINT "project_members_client_truth_approval_check"
  CHECK (NOT ("project_role" = 'client' AND "can_approve_truth_changes" = TRUE))
  NOT VALID;

ALTER TABLE "project_members"
  VALIDATE CONSTRAINT "project_members_client_truth_approval_check";

CREATE OR REPLACE FUNCTION public.enforce_project_member_organization_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  project_organization_id uuid;
BEGIN
  IF NEW."is_active" IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  SELECT p."org_id"
    INTO project_organization_id
  FROM public."projects" AS p
  WHERE p."id" = NEW."project_id";

  IF project_organization_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public."organization_memberships" AS om
    WHERE om."organization_id" = project_organization_id
      AND om."user_id" = NEW."user_id"
      AND om."is_active" = TRUE
  ) THEN
    RAISE EXCEPTION 'Active organization membership required for project membership'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_project_member_organization_membership() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER "project_members_require_active_organization_membership"
AFTER INSERT OR UPDATE OF "project_id", "user_id", "is_active"
ON "project_members"
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION public.enforce_project_member_organization_membership();
