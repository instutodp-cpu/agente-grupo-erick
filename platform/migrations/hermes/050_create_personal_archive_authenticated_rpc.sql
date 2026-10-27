-- Hermes personal archive: self-service, authenticated-only API.
-- Depends on 049. SECURITY INVOKER / RLS / auth.uid() are mandatory.
-- No archive uploads are exposed in this migration.
BEGIN;
CREATE OR REPLACE FUNCTION public.hermes_personal_source_status()
 RETURNS TABLE (provider text, status text, archived_messages bigint)
 LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''
AS $fn$
BEGIN
 IF current_user <> 'authenticated' OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'personal_authentication_required' USING ERRCODE='42501';
 END IF;
 RETURN QUERY
 SELECT p.name::text,
   CASE WHEN g.owner_user_id IS NULL THEN 'not_connected'
        WHEN g.revoked_at IS NOT NULL THEN 'revoked'
        ELSE 'authorized' END::text,
   (SELECT count(*) FROM hermes_brain.personal_conversation_messages m
    WHERE m.owner_user_id=auth.uid() AND m.provider=p.name)::bigint
 FROM (VALUES('chatgpt'),('claude')) AS p(name)
 LEFT JOIN hermes_brain.personal_import_consents g
   ON g.owner_user_id=auth.uid() AND g.provider=p.name
 ORDER BY p.name;
END $fn$;

CREATE OR REPLACE FUNCTION public.hermes_personal_source_consent(p_provider text)
 RETURNS text LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE v_current uuid;
BEGIN
 IF current_user <> 'authenticated' OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'personal_authentication_required' USING ERRCODE='42501';
 END IF;
 IF p_provider IS NULL OR p_provider NOT IN ('chatgpt','claude') THEN
  RAISE EXCEPTION 'invalid_personal_provider' USING ERRCODE='22023';
 END IF;
 INSERT INTO hermes_brain.personal_import_consents(owner_user_id,provider)
 VALUES(auth.uid(),p_provider)
 ON CONFLICT (owner_user_id,provider) DO NOTHING
 RETURNING grant_id INTO v_current;
 IF v_current IS NOT NULL THEN RETURN 'authorized'; END IF;
 IF EXISTS(SELECT 1 FROM hermes_brain.personal_import_consents g
   WHERE g.owner_user_id=auth.uid() AND g.provider=p_provider
     AND g.revoked_at IS NULL) THEN
  RETURN 'already_authorized';
 END IF;
 -- A revoked source cannot be silently reauthorized: erase, then reconsent.
 RETURN 'revoked_reconsent_requires_erase';
END $fn$;

CREATE OR REPLACE FUNCTION public.hermes_personal_source_revoke(p_provider text)
 RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $fn$
BEGIN
 IF current_user <> 'authenticated' OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'personal_authentication_required' USING ERRCODE='42501';
 END IF;
 IF p_provider IS NULL OR p_provider NOT IN ('chatgpt','claude') THEN
  RAISE EXCEPTION 'invalid_personal_provider' USING ERRCODE='22023';
 END IF;
 UPDATE hermes_brain.personal_import_consents g
 SET revoked_at=now()
 WHERE g.owner_user_id=auth.uid() AND g.provider=p_provider
 AND g.revoked_at IS NULL;
 RETURN FOUND;
END $fn$;

CREATE OR REPLACE FUNCTION public.hermes_personal_source_erase(p_provider text)
 RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $fn$
BEGIN
 IF current_user <> 'authenticated' OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'personal_authentication_required' USING ERRCODE='42501';
 END IF;
 IF p_provider IS NULL OR p_provider NOT IN ('chatgpt','claude') THEN
  RAISE EXCEPTION 'invalid_personal_provider' USING ERRCODE='22023';
 END IF;
 -- Parent deletion CASCADE-removes only this user's messages for this source.
 DELETE FROM hermes_brain.personal_import_consents g
 WHERE g.owner_user_id=auth.uid() AND g.provider=p_provider;
 RETURN FOUND;
END $fn$;

CREATE OR REPLACE FUNCTION public.hermes_personal_history_search(
 p_provider text,p_query text,p_limit integer DEFAULT 5)
 RETURNS TABLE(
  source_ref text,conversation_ref text,conversation_title text,
  role text,branch_status text,created_at_source timestamptz,
  content text,trust_level text)
 LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''
AS $fn$
BEGIN
 IF current_user <> 'authenticated' OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'personal_authentication_required' USING ERRCODE='42501';
 END IF;
 IF p_provider IS NULL OR p_provider NOT IN ('chatgpt','claude')
   OR p_query IS NULL OR length(trim(p_query))<2 OR length(p_query)>120
   OR p_query ~ '[[:cntrl:]]'
   OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10 THEN
  RAISE EXCEPTION 'invalid_personal_search' USING ERRCODE='22023';
 END IF;
 RETURN QUERY
 SELECT m.source_ref,m.conversation_ref,m.conversation_title,
  m.role,m.branch_status,m.created_at_source,m.content,
  'unreviewed_personal_archive'::text
 FROM hermes_brain.personal_conversation_messages m
 JOIN hermes_brain.personal_import_consents g
  ON g.owner_user_id=m.owner_user_id AND g.provider=m.provider
   AND g.grant_id=m.grant_id
 WHERE m.owner_user_id=auth.uid() AND m.provider=p_provider
   AND g.revoked_at IS NULL AND m.visibility='owner_only'
   AND m.classification='confidential' AND m.memory_status='unreviewed'
   AND pg_catalog.to_tsvector('simple',m.content)
     @@ pg_catalog.plainto_tsquery('simple',p_query)
 ORDER BY m.created_at_source DESC NULLS LAST,m.source_ref
 LIMIT p_limit;
END $fn$;

-- PostgreSQL's default PUBLIC EXECUTE is explicitly revoked.
REVOKE ALL ON FUNCTION public.hermes_personal_source_status()
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.hermes_personal_source_consent(text)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.hermes_personal_source_revoke(text)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.hermes_personal_source_erase(text)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.hermes_personal_history_search(text,text,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hermes_personal_source_status(),
 public.hermes_personal_source_consent(text),
 public.hermes_personal_source_revoke(text),
 public.hermes_personal_source_erase(text),
 public.hermes_personal_history_search(text,text,integer)
 TO authenticated;
DO $verify$
DECLARE r record;
BEGIN
 FOR r IN SELECT p.oid,p.proname,p.prosecdef FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN
  ('hermes_personal_source_status','hermes_personal_source_consent',
   'hermes_personal_source_revoke','hermes_personal_source_erase',
   'hermes_personal_history_search')
 LOOP
  IF r.prosecdef
    OR pg_catalog.has_function_privilege('anon',r.oid,'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated',r.oid,'EXECUTE') THEN
    RAISE EXCEPTION 'personal_rpc_access_verification_failed';
  END IF;
 END LOOP;
END $verify$;
COMMIT;
