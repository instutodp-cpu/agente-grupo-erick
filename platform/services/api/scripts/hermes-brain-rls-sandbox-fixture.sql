-- Synthetic records. Run only in temporary isolated PostgreSQL.
\set ON_ERROR_STOP on
INSERT INTO hermes_brain.tenants(tenant_id,workspace_type,status) VALUES
 ('client::alpha','external_client','active'),
 ('client::beta','external_client','active'),
 ('grupo_erick','grupo_erick','active'),
 ('personal::11111111-1111-4111-8111-111111111111','personal','active');
INSERT INTO hermes_brain.memberships
 (tenant_id,user_id,status,company_ids,store_ids,allowed_domains,allowed_classifications,allowed_visibilities)
 VALUES
 ('client::alpha','11111111-1111-4111-8111-111111111111','active',ARRAY['companyA'],ARRAY['storeA'],ARRAY['projetos'],ARRAY['internal'],ARRAY['owner_only','scoped']),
 ('client::beta','22222222-2222-4222-8222-222222222222','active',ARRAY['companyB'],ARRAY['storeB'],ARRAY['projetos'],ARRAY['internal'],ARRAY['owner_only','scoped']),
 ('grupo_erick','11111111-1111-4111-8111-111111111111','active',ARRAY['erick'],ARRAY['barreiros'],ARRAY['projetos'],ARRAY['internal'],ARRAY['owner_only']),
 ('personal::11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','active',ARRAY[]::text[],ARRAY[]::text[],ARRAY['pessoal'],ARRAY['internal'],ARRAY['owner_only']);
INSERT INTO hermes_brain.sources
 (tenant_id,source_id,provider,reference_digest,status,source_updated_at) VALUES
 ('client::alpha','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','documentos','sha256:'||repeat('a',64),'verified',now()),
 ('client::beta','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','documentos','sha256:'||repeat('b',64),'verified',now()),
 ('grupo_erick','cccccccc-cccc-4ccc-8ccc-cccccccccccc','documentos','sha256:'||repeat('c',64),'verified',now()),
 ('personal::11111111-1111-4111-8111-111111111111','dddddddd-dddd-4ddd-8ddd-dddddddddddd','documentos','sha256:'||repeat('d',64),'verified',now()),
 ('client::alpha','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','documentos','sha256:'||repeat('e',64),'revoked',now());
INSERT INTO hermes_brain.memory_items
 (tenant_id,memory_id,source_id,source_item_digest,source_version,owner_user_id,
 domain,classification,visibility,company_id,store_id,title,content,status,expires_at)
 VALUES
 ('client::alpha','11110000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sha256:'||repeat('1',64),'v1','11111111-1111-4111-8111-111111111111','projetos','internal','owner_only',null,null,'Alpha','memoria aprovada A','approved',now()+interval '7 days'),
 ('client::beta','22220000-0000-4000-8000-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','sha256:'||repeat('2',64),'v1','22222222-2222-4222-8222-222222222222','projetos','internal','owner_only',null,null,'Beta','memoria aprovada B','approved',now()+interval '7 days'),
 ('grupo_erick','33330000-0000-4000-8000-000000000003','cccccccc-cccc-4ccc-8ccc-cccccccccccc','sha256:'||repeat('3',64),'v1','11111111-1111-4111-8111-111111111111','projetos','internal','owner_only',null,null,'Grupo','memoria aprovada grupo','approved',now()+interval '7 days'),
 ('personal::11111111-1111-4111-8111-111111111111','44440000-0000-4000-8000-000000000004','dddddddd-dddd-4ddd-8ddd-dddddddddddd','sha256:'||repeat('4',64),'v1','11111111-1111-4111-8111-111111111111','pessoal','internal','owner_only',null,null,'Pessoal','memoria pessoal','approved',now()+interval '7 days'),
 ('client::alpha','55550000-0000-4000-8000-000000000005','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sha256:'||repeat('5',64),'v1','11111111-1111-4111-8111-111111111111','projetos','internal','owner_only',null,null,'Proposta','nao aprovada','proposed',now()+interval '7 days'),
 ('client::alpha','66660000-0000-4000-8000-000000000006','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','sha256:'||repeat('6',64),'v1','11111111-1111-4111-8111-111111111111','projetos','internal','owner_only',null,null,'Revogada','fonte revogada','approved',now()+interval '7 days'),
 ('client::alpha','77770000-0000-4000-8000-000000000007','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sha256:'||repeat('7',64),'v1','11111111-1111-4111-8111-111111111111','projetos','internal','owner_only',null,null,'Vencida','nao visivel','approved',now()-interval '1 second'),
 ('client::alpha','88880000-0000-4000-8000-000000000008','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sha256:'||repeat('8',64),'v1','11111111-1111-4111-8111-111111111111','projetos','internal','scoped','companyZ',null,'Outra empresa','sem acesso','approved',now()+interval '7 days');

DO $test_role$
BEGIN
 IF has_table_privilege('authenticated','hermes_brain.memory_items','INSERT')
 OR has_table_privilege('authenticated','hermes_brain.memory_items','UPDATE')
 OR has_table_privilege('authenticated','hermes_brain.memory_items','DELETE')
 OR has_table_privilege('anon','hermes_brain.memory_items','SELECT') THEN
 RAISE EXCEPTION 'WRITE_OR_ANON_PRIVILEGE_FAILED';
 END IF;
END $test_role$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
DO $test_a$
DECLARE n int;
BEGIN
 SELECT count(*) INTO n FROM hermes_brain.memory_items;
 IF n<>3 THEN RAISE EXCEPTION 'ACTOR_A_EXPECTED_3_GOT_%',n;END IF;
 SELECT count(*) INTO n FROM hermes_brain.memory_items WHERE tenant_id='client::beta';
 IF n<>0 THEN RAISE EXCEPTION 'CLIENT_A_CAN_READ_B'; END IF;
 SELECT count(*) INTO n FROM hermes_brain.memory_items WHERE status<>'approved';
 IF n<>0 THEN RAISE EXCEPTION 'UNAPPROVED_MEMORY_LEAK'; END IF;
END $test_a$;

SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
DO $test_b$
DECLARE n int;
BEGIN
 SELECT count(*) INTO n FROM hermes_brain.memory_items;
 IF n<>1 THEN RAISE EXCEPTION 'ACTOR_B_EXPECTED_1_GOT_%',n;END IF;
 SELECT count(*) INTO n FROM hermes_brain.memory_items WHERE tenant_id='client::alpha';
 IF n<>0 THEN RAISE EXCEPTION 'CLIENT_B_CAN_READ_A';END IF;
END $test_b$;

SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
DO $test_none$
DECLARE n int;
BEGIN
 SELECT count(*) INTO n FROM hermes_brain.memory_items;
 IF n<>0 THEN RAISE EXCEPTION 'UNREGISTERED_READ';END IF;
END $test_none$;
RESET ROLE;
SELECT 'RLS_CROSS_TENANT_APPROVAL_SOURCE_TTL_SCOPE_AND_WRITE_GATE_OK' AS result;
