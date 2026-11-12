-- Hermes Brain: authenticated tenant admission status for the staging portal.
-- No provisioning, membership mutation, privileged bypass or tenant identity injection.
BEGIN;
CREATE OR REPLACE FUNCTION public.hermes_brain_access_status(p_tenant_id text)
RETURNS TABLE(authorized boolean, allowed_domains text[], can_propose_internal boolean)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $fn$
BEGIN
  IF current_user <> 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authenticated_session_required' USING ERRCODE='42501';
  END IF;
  IF p_tenant_id IS NULL OR p_tenant_id !~
     '^(grupo_erick|personal::[A-Za-z0-9_-]{1,128}|client::[A-Za-z0-9_-]{1,128})$' THEN
    RAISE EXCEPTION 'invalid_brain_tenant' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
  SELECT true, m.allowed_domains,
    ('internal' = ANY(m.allowed_classifications))
  FROM hermes_brain.tenants t
  JOIN hermes_brain.memberships m ON m.tenant_id = t.tenant_id
  WHERE t.tenant_id = p_tenant_id
    AND t.status = 'active'
    AND m.user_id = (SELECT auth.uid())
    AND m.status = 'active'
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, ARRAY[]::text[], false;
  END IF;
END $fn$;

REVOKE ALL ON FUNCTION public.hermes_brain_access_status(text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hermes_brain_access_status(text)
 TO authenticated;

DO $verify$
DECLARE v_oid oid;
BEGIN
  SELECT p.oid INTO v_oid FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'hermes_brain_access_status'
    AND p.pronargs = 1;
  IF v_oid IS NULL
   OR (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_oid)
   OR pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE')
   OR NOT pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE') THEN
    RAISE EXCEPTION 'brain_admission_rpc_privilege_verification_failed';
  END IF;
END $verify$;
COMMIT;
