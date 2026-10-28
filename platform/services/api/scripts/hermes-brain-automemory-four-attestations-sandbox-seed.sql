-- Synthetic staging fixture only; no user data, no network, no production DB.
UPDATE hermes_brain.memberships
SET allowed_domains=ARRAY['projetos','financeiro','comercial']
WHERE tenant_id='grupo_erick' AND user_id='11111111-1111-4111-8111-111111111111';
INSERT INTO hermes_brain.sources
 (tenant_id,source_id,provider,reference_digest,status,source_updated_at)
VALUES
 ('grupo_erick','90000000-0000-4000-8000-000000000001','supabase_history','sha256:'||repeat('9',64),'verified',now()),
 ('grupo_erick','90000000-0000-4000-8000-000000000002','telegram_owner_confirmed','sha256:'||repeat('8',64),'verified',now()),
 ('grupo_erick','90000000-0000-4000-8000-000000000003','supabase_history','sha256:'||repeat('7',64),'revoked',now())
ON CONFLICT DO NOTHING;
INSERT INTO hermes_brain.automemory_admissions
 (tenant_id,source_id,source_item_digest,source_version,owner_user_id,content_digest,expires_at)
SELECT 'grupo_erick','90000000-0000-4000-8000-000000000001'::uuid,
 'sha256:'||repeat(ch,64),ver,'11111111-1111-4111-8111-111111111111'::uuid,
 'sha256:'||encode(sha256(convert_to(body,'UTF8')),'hex'),
 date_trunc('minute',now())+interval '7 days'
FROM (VALUES
 ('1','v1','Valor agregado de teste, sem dado real.'),
 ('a','v2','Cenario sintetico numero dois.'),
 ('b','v3','Cenario sintetico numero tres.'),
 ('c','v4','Cenario sintetico numero quatro.')
) AS v(ch,ver,body)
ON CONFLICT DO NOTHING;
