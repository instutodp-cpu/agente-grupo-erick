-- Synthetic, network-isolated PostgreSQL fixture. NEVER run on live Supabase.
\set ON_ERROR_STOP on
-- Existing test principal has a real synthetic membership; extend pilot domains.
UPDATE hermes_brain.memberships
SET allowed_domains=ARRAY['projetos','financeiro','comercial']
WHERE tenant_id='grupo_erick'
  AND user_id='11111111-1111-4111-8111-111111111111';
INSERT INTO hermes_brain.sources
 (tenant_id,source_id,provider,reference_digest,status,source_updated_at)
VALUES
 ('grupo_erick','90000000-0000-4000-8000-000000000001','supabase_history',
  'sha256:'||repeat('9',64),'verified',now()),
 ('grupo_erick','90000000-0000-4000-8000-000000000002','telegram_owner_confirmed',
  'sha256:'||repeat('8',64),'verified',now()),
 ('grupo_erick','90000000-0000-4000-8000-000000000003','supabase_history',
  'sha256:'||repeat('7',64),'revoked',now());

INSERT INTO hermes_brain.automemory_admissions
 (tenant_id,source_id,source_item_digest,source_version,owner_user_id,content_digest,expires_at)
VALUES
 ('grupo_erick','90000000-0000-4000-8000-000000000001',
 'sha256:'||repeat('1',64),'v1','11111111-1111-4111-8111-111111111111',
 'sha256:'||encode(sha256(convert_to('Valor agregado de teste, sem dado real.','UTF8')),'hex'),
 date_trunc('minute',now())+interval '7 days');

DO $priv$
BEGIN
 IF NOT has_column_privilege('authenticated','hermes_brain.memory_items','content','INSERT')
 OR has_column_privilege('authenticated','hermes_brain.memory_items','memory_id','INSERT')
 OR has_table_privilege('authenticated','hermes_brain.memory_items','UPDATE')
 OR has_table_privilege('authenticated','hermes_brain.memory_items','DELETE')
 OR has_table_privilege('anon','hermes_brain.memory_items','INSERT') THEN
  RAISE EXCEPTION 'BRANDED_COLUMN_AND_RLS_GRANT_DENIED';
 END IF;
END $priv$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
-- Exactly the columns used by the fixed publication port.
INSERT INTO hermes_brain.memory_items
 (tenant_id,source_id,source_item_digest,source_version,owner_user_id,
 domain,classification,visibility,company_id,store_id,title,content,expires_at,status)
VALUES
 ('grupo_erick','90000000-0000-4000-8000-000000000001',
  'sha256:'||repeat('1',64),'v1','11111111-1111-4111-8111-111111111111',
  'comercial','internal','owner_only',NULL,NULL,
  'Histórico verificado — comercial','Valor agregado de teste, sem dado real.',
  date_trunc('minute',now())+interval '7 days','approved');

DO $tests$
DECLARE denied boolean;
BEGIN
 IF (SELECT count(*) FROM hermes_brain.memory_items
     WHERE source_id='90000000-0000-4000-8000-000000000001')<>1 THEN
    RAISE EXCEPTION 'AUTHORIZED_MEMORY_NOT_VISIBLE';
 END IF;
 -- One owner must never write a memory in another tenant.
 denied:=false;
 BEGIN
  INSERT INTO hermes_brain.memory_items
   (tenant_id,source_id,source_item_digest,source_version,owner_user_id,
    domain,classification,visibility,title,content,expires_at,status)
  VALUES ('client::alpha','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'sha256:'||repeat('2',64),'v1','11111111-1111-4111-8111-111111111111',
   'comercial','internal','owner_only','Histórico verificado — comercial',
   'Cross-tenant injection must fail',date_trunc('minute',now())+interval '7 days','approved');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'CROSS_TENANT_INSERT_SUCCEEDED'; END IF;
 -- Cannot spoof another owner even when source and domain are valid.
 denied:=false;
 BEGIN
  INSERT INTO hermes_brain.memory_items
   (tenant_id,source_id,source_item_digest,source_version,owner_user_id,
    domain,classification,visibility,title,content,expires_at,status)
  VALUES ('grupo_erick','90000000-0000-4000-8000-000000000001',
   'sha256:'||repeat('3',64),'v1','22222222-2222-4222-8222-222222222222',
   'comercial','internal','owner_only','Histórico verificado — comercial',
   'Wrong owner injection must fail',date_trunc('minute',now())+interval '7 days','approved');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'OWNER_SPOOF_INSERT_SUCCEEDED'; END IF;
 -- Source revoked => cannot publish.
 denied:=false;
 BEGIN
  INSERT INTO hermes_brain.memory_items
   (tenant_id,source_id,source_item_digest,source_version,owner_user_id,
    domain,classification,visibility,title,content,expires_at,status)
  VALUES ('grupo_erick','90000000-0000-4000-8000-000000000003',
   'sha256:'||repeat('4',64),'v1','11111111-1111-4111-8111-111111111111',
   'comercial','internal','owner_only','Histórico verificado — comercial',
   'Revoked source injection must fail',date_trunc('minute',now())+interval '7 days','approved');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'REVOKED_SOURCE_INSERT_SUCCEEDED'; END IF;
 -- Wrong visibility and classification must fail.
 denied:=false;
 BEGIN
  INSERT INTO hermes_brain.memory_items
   (tenant_id,source_id,source_item_digest,source_version,owner_user_id,
    domain,classification,visibility,title,content,expires_at,status)
  VALUES ('grupo_erick','90000000-0000-4000-8000-000000000001',
   'sha256:'||repeat('5',64),'v1','11111111-1111-4111-8111-111111111111',
   'comercial','confidential','tenant_shared','Histórico verificado — comercial',
   'Broad share injection must fail',date_trunc('minute',now())+interval '7 days','approved');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'BROAD_MEMORY_INSERT_SUCCEEDED'; END IF;
 -- Expiration bounds must not be bypassed.
 denied:=false;
 BEGIN
  INSERT INTO hermes_brain.memory_items
   (tenant_id,source_id,source_item_digest,source_version,owner_user_id,
    domain,classification,visibility,title,content,expires_at,status)
  VALUES ('grupo_erick','90000000-0000-4000-8000-000000000001',
   'sha256:'||repeat('6',64),'v1','11111111-1111-4111-8111-111111111111',
   'comercial','internal','owner_only','Histórico verificado — comercial',
   'Unbounded retention must fail',now()+interval '90 days','approved');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'UNBOUNDED_RETENTION_SUCCEEDED'; END IF;
END $tests$;
-- Replay of the same exact publication idempotency tuple must not insert.
DO $idempotent$
DECLARE v uuid;
BEGIN
 INSERT INTO hermes_brain.memory_items
  (tenant_id,source_id,source_item_digest,source_version,owner_user_id,
   domain,classification,visibility,company_id,store_id,title,content,expires_at,status)
 SELECT 'grupo_erick',s.source_id,'sha256:'||repeat('1',64),'v1',
  '11111111-1111-4111-8111-111111111111'::uuid,
  'comercial','internal','owner_only',NULL,NULL,
  'Histórico verificado — comercial','Valor agregado de teste, sem dado real.',
  date_trunc('minute',now())+interval '7 days','approved'
 FROM hermes_brain.sources s
 WHERE s.tenant_id='grupo_erick' AND s.source_id='90000000-0000-4000-8000-000000000001'
   AND s.status='verified'
 ON CONFLICT (tenant_id,source_id,source_item_digest,source_version)
 DO NOTHING RETURNING memory_id INTO v;
 IF v IS NOT NULL THEN RAISE EXCEPTION 'AUTOMEMORY_IDEMPOTENCY_FAILED'; END IF;
END $idempotent$;

-- A revoked membership immediately hides even a once-approved memory.
RESET ROLE;
UPDATE hermes_brain.memberships SET status='revoked'
WHERE tenant_id='grupo_erick'
  AND user_id='11111111-1111-4111-8111-111111111111';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
DO $revoked$
DECLARE denied boolean:=false;
BEGIN
 IF (SELECT count(*) FROM hermes_brain.memory_items WHERE tenant_id='grupo_erick')<>0 THEN
  RAISE EXCEPTION 'REVOKED_MEMBERSHIP_LEAK';
 END IF;
 BEGIN
 INSERT INTO hermes_brain.memory_items
  (tenant_id,source_id,source_item_digest,source_version,owner_user_id,
   domain,classification,visibility,title,content,expires_at,status)
 VALUES ('grupo_erick','90000000-0000-4000-8000-000000000001',
  'sha256:'||repeat('f',64),'v2','11111111-1111-4111-8111-111111111111',
  'comercial','internal','owner_only','Histórico verificado — comercial',
  'Revoked membership must fail',date_trunc('minute',now())+interval '7 days','approved');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'REVOKED_MEMBERSHIP_INSERT_SUCCEEDED'; END IF;
END $revoked$;
RESET ROLE;
SELECT 'BRAIN_VERIFIED_OWNER_RLS_INSERT_AND_REJECTION_OK' AS result;
