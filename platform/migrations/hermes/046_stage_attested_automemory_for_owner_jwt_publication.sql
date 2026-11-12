-- Hermes Brain: owner-only, attested staging payload for real JWT publication.
-- Extends existing private admission table; does not approve or publish memory_items.
BEGIN;
ALTER TABLE hermes_brain.automemory_admissions
 ADD COLUMN staged_content text;
ALTER TABLE hermes_brain.automemory_admissions
 ADD CONSTRAINT brain_staged_content_matches_digest CHECK (
   staged_content IS NULL OR (
     char_length(staged_content) BETWEEN 12 AND 420
     AND content_digest='sha256:'||
       pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(staged_content,'UTF8')),'hex')
   )
 );
CREATE OR REPLACE FUNCTION public.hermes_brain_get_attested_automemory(p_tenant_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''
AS $get$
DECLARE
 v_uid uuid:=auth.uid();
 v_payload jsonb;
BEGIN
 IF current_user<>'authenticated' OR v_uid IS NULL OR p_tenant_id<>'grupo_erick'
 THEN
  RAISE EXCEPTION 'automemory_payload_not_authorized' USING ERRCODE='42501';
 END IF;
 SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'source_id',a.source_id,'source_item_digest',a.source_item_digest,
  'source_version',a.source_version,
  'domain',CASE WHEN s.provider='telegram_owner_confirmed' THEN 'financeiro' ELSE 'comercial' END,
  'title',CASE WHEN s.provider='telegram_owner_confirmed' THEN 'Decisão confirmada — financeiro' ELSE 'Histórico verificado — comercial' END,
  'content',a.staged_content,'expires_at',a.expires_at
 ) ORDER BY a.source_item_digest)
 INTO v_payload
 FROM hermes_brain.automemory_admissions a
 JOIN hermes_brain.sources s
  ON s.tenant_id=a.tenant_id AND s.source_id=a.source_id
 WHERE a.tenant_id='grupo_erick' AND a.owner_user_id=v_uid
   AND a.status='admitted' AND a.expires_at>now()
   AND a.staged_content IS NOT NULL
   AND s.status='verified' AND s.source_updated_at<=now()
   AND s.provider IN ('supabase_history','telegram_owner_confirmed')
   AND EXISTS (
     SELECT 1 FROM hermes_brain.tenants t
     JOIN hermes_brain.memberships m ON m.tenant_id=t.tenant_id
     WHERE t.tenant_id=a.tenant_id AND t.status='active'
       AND m.user_id=v_uid AND m.status='active'
       AND 'financeiro'=ANY(m.allowed_domains)
       AND 'comercial'=ANY(m.allowed_domains)
       AND 'internal'=ANY(m.allowed_classifications)
       AND 'owner_only'=ANY(m.allowed_visibilities)
   );
 IF v_payload IS NULL OR pg_catalog.jsonb_array_length(v_payload)<>4 THEN
  RAISE EXCEPTION 'automemory_four_verified_payloads_not_ready' USING ERRCODE='42501';
 END IF;
 RETURN v_payload;
END
$get$;
REVOKE ALL ON FUNCTION public.hermes_brain_get_attested_automemory(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hermes_brain_get_attested_automemory(text) TO authenticated;
COMMIT;
