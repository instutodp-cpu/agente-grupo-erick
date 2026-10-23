-- Hermes Brain: Supabase Auth JWT -> SECURITY INVOKER transactional publication.
-- Private source hashes and per-item attestations (043) remain the authority.
-- Exposes no server secrets and never uses SECURITY DEFINER/service-role bypass.
BEGIN;
CREATE OR REPLACE FUNCTION public.hermes_brain_publish_automemory(
 p_tenant_id text, p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $publish$
DECLARE
 v_item jsonb;
 v_keys integer;
 v_inserted integer:=0;
 v_existing integer:=0;
 v_id uuid;
 v_uid uuid;
BEGIN
 v_uid:=auth.uid();
 IF current_user<>'authenticated' OR v_uid IS NULL OR p_tenant_id<>'grupo_erick'
    OR p_items IS NULL OR jsonb_typeof(p_items)<>'array'
    OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 4 THEN
   RAISE EXCEPTION 'automemory_publication_not_authorized' USING ERRCODE='42501';
 END IF;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS t(value) LOOP
  IF jsonb_typeof(v_item)<>'object' THEN
   RAISE EXCEPTION 'automemory_item_contract_invalid' USING ERRCODE='22023';
  END IF;
  SELECT count(*) INTO v_keys FROM jsonb_object_keys(v_item) AS keys(key);
  IF v_keys<>7 OR NOT (v_item ?& ARRAY[
    'source_id','source_item_digest','source_version',
    'domain','title','content','expires_at'])
    OR length(v_item->>'content') NOT BETWEEN 12 AND 420
    OR length(v_item->>'source_version') NOT BETWEEN 1 AND 100
    OR (v_item->>'domain') NOT IN ('financeiro','comercial')
    OR (v_item->>'title') NOT IN (
      'Decisão confirmada — financeiro','Histórico verificado — comercial')
    OR (v_item->>'source_item_digest') !~ '^sha256:[a-f0-9]{64}$'
    THEN RAISE EXCEPTION 'automemory_item_contract_invalid' USING ERRCODE='22023';
  END IF;
  v_id:=NULL;
  INSERT INTO hermes_brain.memory_items (
   tenant_id,source_id,source_item_digest,source_version,owner_user_id,
   domain,classification,visibility,company_id,store_id,
   title,content,expires_at,status
  )
  SELECT 'grupo_erick',(v_item->>'source_id')::uuid,
    v_item->>'source_item_digest',v_item->>'source_version',v_uid,
    v_item->>'domain','internal','owner_only',NULL,NULL,
    v_item->>'title',v_item->>'content',
    (v_item->>'expires_at')::timestamptz,'approved'
  FROM hermes_brain.sources s
  WHERE s.tenant_id='grupo_erick'
    AND s.source_id=(v_item->>'source_id')::uuid
    AND s.status='verified'
  ON CONFLICT (tenant_id,source_id,source_item_digest,source_version)
    DO NOTHING
  RETURNING memory_id INTO v_id;
  IF v_id IS NOT NULL THEN
   v_inserted:=v_inserted+1;
  ELSE
   -- Must never claim an unknown/unverified source as a duplicate.
   IF NOT EXISTS (SELECT 1 FROM hermes_brain.sources s
     WHERE s.tenant_id='grupo_erick' AND s.source_id=(v_item->>'source_id')::uuid
       AND s.status='verified') THEN
     RAISE EXCEPTION 'automemory_source_unverified' USING ERRCODE='42501';
   END IF;
   v_existing:=v_existing+1;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('status','committed','tenant_id','grupo_erick',
   'inserted',v_inserted,'duplicates',v_existing,
   'read_only',false,'executive_authority',false);
END;
$publish$;
REVOKE ALL ON FUNCTION public.hermes_brain_publish_automemory(text,jsonb)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hermes_brain_publish_automemory(text,jsonb)
 TO authenticated;
COMMIT;
