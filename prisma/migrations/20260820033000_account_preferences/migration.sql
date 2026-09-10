ALTER TABLE "user_notification_preferences"
  ADD COLUMN "appearance_theme" TEXT NOT NULL DEFAULT 'auto';

ALTER TABLE "user_notification_preferences"
  ADD CONSTRAINT "user_notification_preferences_appearance_theme_check"
  CHECK ("appearance_theme" IN ('light', 'dark', 'auto'));

-- Reuse the previously approved backend runtime role while direct browser roles
-- remain denied by the existing restrictive policy.
DO $$
DECLARE
  backend_role_list text;
BEGIN
  SELECT string_agg(format('%I', roles.rolname), ', ' ORDER BY roles.rolname)
  INTO backend_role_list
  FROM pg_policy policies
  CROSS JOIN LATERAL unnest(policies.polroles) AS policy_role(role_oid)
  JOIN pg_roles roles ON roles.oid = policy_role.role_oid
  WHERE policies.polrelid = 'public.organization_memberships'::regclass
    AND policies.polname = 'backend_database_role_full_access'
    AND roles.rolname NOT IN ('anon', 'authenticated');

  IF backend_role_list IS NULL THEN
    RAISE EXCEPTION 'no approved Orchestra backend database role is available';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.user_notification_preferences'::regclass
      AND polname = 'backend_database_role_full_access'
  ) THEN
    EXECUTE format(
      'CREATE POLICY %I ON public.user_notification_preferences AS PERMISSIVE FOR ALL TO %s USING (true) WITH CHECK (true)',
      'backend_database_role_full_access',
      backend_role_list
    );
  END IF;
END
$$;
