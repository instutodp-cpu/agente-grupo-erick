-- Hermes Brain authenticated RPC v1. No service role, no raw SQL or direct table exposure.
-- Public API functions are SECURITY INVOKER: tenant membership and RLS remain authoritative.
-- This migration does not create users, provision tenants, approve notes, or grant admin writes.
BEGIN;
CREATE OR REPLACE FUNCTION public.hermes_brain_submit_note(
 p_tenant_id text, p_source_ref text, p_title text, p_body text, p_domain text
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
AS $fn$
DECLARE v_id uuid;
BEGIN
 IF current_user <> 'authenticated' OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'authenticated_session_required' USING ERRCODE='42501';
 END IF;
 IF p_tenant_id IS NULL
   OR p_tenant_id !~ '^(grupo_erick|personal::[a-zA-Z0-9_-]{1,128}|client::[a-zA-Z0-9_-]{1,128})$'
   OR p_source_ref IS NULL OR p_source_ref !~ '^[a-zA-Z0-9._:/-]{1,160}$'
   OR p_title IS NULL OR char_length(p_title) NOT BETWEEN 1 AND 160
   OR p_body IS NULL OR char_length(p_body) NOT BETWEEN 1 AND 4000
   OR p_domain IS NULL OR p_domain !~ '^[a-z][a-z0-9_]{0,63}$' THEN
  RAISE EXCEPTION 'invalid_brain_proposal' USING ERRCODE='22023';
 END IF;
 INSERT INTO hermes_brain.inbox_candidates
  (tenant_id,actor_user_id,source_type,source_ref,source_version,
   title,body,domain,classification,status)
 VALUES
  (p_tenant_id,auth.uid(),'user_note',p_source_ref,'v1',
   p_title,p_body,p_domain,'internal','pending')
 RETURNING proposal_id INTO v_id;
 RETURN v_id;
END $fn$;

CREATE OR REPLACE FUNCTION public.hermes_brain_search(
 p_tenant_id text,p_query text,p_limit integer DEFAULT 5
)
RETURNS TABLE(
 memory_id uuid,title text,content text,domain text,provider text,
 source_version text,source_updated_at timestamptz,updated_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $fn$
BEGIN
 IF current_user <> 'authenticated' OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'authenticated_session_required' USING ERRCODE='42501';
 END IF;
 IF p_tenant_id IS NULL
  OR p_tenant_id !~ '^(grupo_erick|personal::[a-zA-Z0-9_-]{1,128}|client::[a-zA-Z0-9_-]{1,128})$'
  OR p_query IS NULL OR char_length(p_query) NOT BETWEEN 2 AND 160
  OR p_query ~ '[[:cntrl:]]'
  OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10 THEN
  RAISE EXCEPTION 'invalid_brain_search' USING ERRCODE='22023';
 END IF;
 RETURN QUERY
 SELECT m.memory_id,m.title,m.content,m.domain,s.provider,m.source_version,
  s.source_updated_at,m.updated_at
 FROM hermes_brain.memory_items m
 JOIN hermes_brain.sources s
  ON s.tenant_id=m.tenant_id AND s.source_id=m.source_id
 WHERE m.tenant_id=p_tenant_id
  AND m.status='approved' AND s.status='verified' AND m.expires_at>now()
  AND pg_catalog.to_tsvector('simple',m.title||' '||m.content)
      @@ pg_catalog.plainto_tsquery('simple',p_query)
 ORDER BY pg_catalog.ts_rank(
  pg_catalog.to_tsvector('simple',m.title||' '||m.content),
  pg_catalog.plainto_tsquery('simple',p_query)
 ) DESC,m.updated_at DESC,m.memory_id
 LIMIT p_limit;
END $fn$;

-- New functions in exposed public must never inherit PUBLIC/anon invocation.
REVOKE ALL ON FUNCTION public.hermes_brain_submit_note(text,text,text,text,text)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.hermes_brain_search(text,text,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hermes_brain_submit_note(text,text,text,text,text)
 TO authenticated;
GRANT EXECUTE ON FUNCTION public.hermes_brain_search(text,text,integer)
 TO authenticated;

-- Verify role gates and forbid privileged-function execution before commit.
DO $verify$
DECLARE r record;
BEGIN
 FOR r IN
  SELECT p.oid,p.prosecdef,p.proname
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN
   ('hermes_brain_submit_note','hermes_brain_search')
 LOOP
  IF r.prosecdef OR
     pg_catalog.has_function_privilege('anon',r.oid,'EXECUTE') OR
     NOT pg_catalog.has_function_privilege('authenticated',r.oid,'EXECUTE') THEN
   RAISE EXCEPTION 'brain_rpc_privilege_verification_failed';
  END IF;
 END LOOP;
END $verify$;
COMMIT;
