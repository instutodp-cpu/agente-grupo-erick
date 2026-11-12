-- Hermes Brain staging: four independently checked AutoMemory item attestations.
-- Destination ONLY project asceucchdnuoaqgdjbtg. NEVER run on Softcom.
-- Control-plane metadata admission, NOT a memory_items INSERT or execution.
-- Requires verified local 0600 source records and current tenant membership.
BEGIN;
DO $precheck$
BEGIN
 IF (SELECT count(*) FROM hermes_brain.memberships m
     JOIN hermes_brain.tenants t USING (tenant_id)
     WHERE t.tenant_id='grupo_erick' AND t.status='active'
     AND m.status='active' AND 'financeiro'=ANY(m.allowed_domains)
     AND 'comercial'=ANY(m.allowed_domains)
     AND 'internal'=ANY(m.allowed_classifications)
     AND 'owner_only'=ANY(m.allowed_visibilities))<>1
 THEN RAISE EXCEPTION 'brain_exactly_one_authorized_owner_required'; END IF;
 IF (SELECT count(*) FROM hermes_brain.sources WHERE tenant_id='grupo_erick'
     AND status='verified' AND provider IN
     ('telegram_owner_confirmed','supabase_history'))<>2
 THEN RAISE EXCEPTION 'brain_exactly_two_verified_sources_required'; END IF;
END $precheck$;
WITH expected(provider,reference_digest,item_digest,item_version,content_digest,expiry) AS (
 VALUES
 ('telegram_owner_confirmed','sha256:f38b8f7cd71e4e99def9a04cc4b796aeb0d7838e3a1de94cf02af9bde433fc9a',
 'sha256:af7f685362389986fde735a6892c89cc7ed74747fa9a7dd8d282db035d0d8571',
 '2026-10-22T20:59:52.272Z','sha256:baeb2f915220c8886160d588b3a66e6cf3ceda8a049031a51b97c0a0567f96ef',
 '2027-04-20T20:59:52.272Z'::timestamptz),
 ('supabase_history','sha256:f823e17a70ace2e6e95446366390786a9f7b1af052b6c230c136042ab61f8a6e',
 'sha256:d5d3e682b9f21b333e8cec48a3ba13f8ef8e69b813fe6b4a634a4a5fca7297b3',
 '2026-10-22T20:02:39.505Z','sha256:b898f96d7e1f401cf9adbb5d7567d9ecc89ef54b642944c90425c9f36df7f607',
 '2026-11-05T20:02:39.505Z'::timestamptz),
 ('supabase_history','sha256:f823e17a70ace2e6e95446366390786a9f7b1af052b6c230c136042ab61f8a6e',
 'sha256:f366fd68e4436704028a3f825d62be7d7157391aa0f049785d686c633cdc04b5',
 '2026-10-22T20:02:37.528Z','sha256:e27c06f7fc871c0ee8047f46b19fdd043b93f290ea85dd0e59c10fd1146a3ead',
 '2026-11-05T20:02:37.528Z'::timestamptz),
 ('supabase_history','sha256:f823e17a70ace2e6e95446366390786a9f7b1af052b6c230c136042ab61f8a6e',
 'sha256:909fd5bb34fd00784c9ae7f49ae012ade26111d9e9bc17cbdc8b7040875b05ee',
 '2026-10-22T19:19:15.514Z','sha256:eb39275363f7a48406cb2315147b91e0390ed999c5181b23cc92c985aea87f35',
 '2026-11-05T19:19:15.514Z'::timestamptz)
), admitted AS (
 INSERT INTO hermes_brain.automemory_admissions (
   tenant_id,source_id,source_item_digest,source_version,
   owner_user_id,content_digest,expires_at,status
 )
 SELECT 'grupo_erick',s.source_id,e.item_digest,e.item_version,m.user_id,
   e.content_digest,e.expiry,'admitted'
 FROM expected e
 JOIN hermes_brain.sources s ON s.tenant_id='grupo_erick'
   AND s.provider=e.provider AND s.reference_digest=e.reference_digest
   AND s.status='verified'
 JOIN hermes_brain.memberships m ON m.tenant_id=s.tenant_id AND m.status='active'
 ON CONFLICT (tenant_id,source_id,source_item_digest,source_version) DO NOTHING
 RETURNING source_item_digest
)
SELECT count(*) AS newly_attested FROM admitted;
DO $postcheck$
BEGIN
 IF (SELECT count(*) FROM hermes_brain.automemory_admissions
     WHERE tenant_id='grupo_erick' AND status='admitted')<>4 THEN
  RAISE EXCEPTION 'brain_four_attestations_required';
 END IF;
END $postcheck$;
COMMIT;
