-- Hermetic sandbox synthetic four-item payload roundtrip, never run on live DB.
\set ON_ERROR_STOP on
UPDATE hermes_brain.automemory_admissions a
SET staged_content=CASE a.source_item_digest
 WHEN 'sha256:'||repeat('1',64) THEN 'Valor agregado de teste, sem dado real.'
 WHEN 'sha256:'||repeat('a',64) THEN 'Cenario sintetico numero dois.'
 WHEN 'sha256:'||repeat('b',64) THEN 'Cenario sintetico numero tres.'
 WHEN 'sha256:'||repeat('c',64) THEN 'Cenario sintetico numero quatro.'
 ELSE NULL
 END
WHERE a.tenant_id='grupo_erick' AND a.source_id='90000000-0000-4000-8000-000000000001'
  AND a.source_item_digest IN (
   'sha256:'||repeat('1',64),'sha256:'||repeat('a',64),
   'sha256:'||repeat('b',64),'sha256:'||repeat('c',64)
  );
SET ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
DO $verify$
DECLARE
 items jsonb; receipt jsonb;
BEGIN
 items:=public.hermes_brain_get_attested_automemory('grupo_erick');
 IF jsonb_array_length(items)<>4 THEN RAISE EXCEPTION 'FOUR_ITEMS_NOT_RETURNED'; END IF;
 receipt:=public.hermes_brain_publish_automemory('grupo_erick',items);
 IF (receipt->>'inserted')::int<>3 OR (receipt->>'duplicates')::int<>1 THEN
  RAISE EXCEPTION 'STAGED_PUBLICATION_INCORRECT %',receipt;
 END IF;
 receipt:=public.hermes_brain_publish_automemory('grupo_erick',items);
 IF (receipt->>'inserted')::int<>0 OR (receipt->>'duplicates')::int<>4 THEN
  RAISE EXCEPTION 'STAGED_REPLAY_NOT_IDEMPOTENT %',receipt;
 END IF;
END $verify$;
RESET ROLE;
SELECT 'BRAIN_OWNER_STAGED_FOUR_PUBLICATION_AND_REPLAY_OK' AS result;
