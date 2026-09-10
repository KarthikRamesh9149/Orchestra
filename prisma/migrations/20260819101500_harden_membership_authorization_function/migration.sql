-- Fix 7: prevent direct API execution of the authorization trigger function.

REVOKE EXECUTE ON FUNCTION public.enforce_project_member_organization_membership() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_project_member_organization_membership() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_project_member_organization_membership() FROM authenticated;
