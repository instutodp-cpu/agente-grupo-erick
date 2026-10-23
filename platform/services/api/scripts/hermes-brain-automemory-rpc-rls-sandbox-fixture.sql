-- Ephemeral RLS fixture only: never run on the canonical Hermes Supabase.
\set ON_ERROR_STOP on
UPDATE hermes_brain.memberships SET status='active'
 WHERE tenant_id='grupo_erick' AND user_id='11111111-1111-4111-8111-111111111111';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
DO $check$
DECLARE receipt jsonb; denied boolean:=false;
BEGIN
 SELECT public.hermes_brain_publish_automemory(
   'grupo_erick',jsonb_build_array(jsonb_build_object(
     'source_id','90000000-0000-4000-8000-000000000001',
     'source_item_digest','sha256:'||repeat('1',64),
     'source_version','v1','domain','comercial',
     'title','Histórico verificado — comercial',
     'content','Valor agregado de teste, sem dado real.',
     'expires_at',date_trunc('minute',now())+interval '7 days'))) INTO receipt;
 IF receipt->>'status'<>'committed' OR (receipt->>'inserted')::int<>0
    OR (receipt->>'duplicates')::int<>1 THEN
    RAISE EXCEPTION 'PUBLISH_REPLAY_NOT_IDEMPOTENT';
 END IF;
 BEGIN
  PERFORM public.hermes_brain_publish_automemory('client::alpha',
    jsonb_build_array(jsonb_build_object('content','not allowed')));
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'FOREIGN_TENANT_RPC_SUCCEEDED'; END IF;
END $check$;
RESET ROLE;
SELECT 'BRAIN_AUTHENTICATED_INVOCATION_REPLAY_AND_TENANT_DENIAL_OK' AS result;
