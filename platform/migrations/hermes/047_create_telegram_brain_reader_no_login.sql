-- Hermes Brain: dedicated staging Telegram machine reader (NOLOGIN by default).
-- Narrow SELECT under PostgreSQL RLS; no JWT impersonation, service role or BYPASSRLS.
-- Activation requires a separate operator-controlled credential and network policy.
BEGIN;
DO $guard$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_class
   WHERE oid='hermes_brain.memory_items'::regclass
   AND relrowsecurity AND relforcerowsecurity
 ) OR (SELECT count(*) FROM hermes_brain.memory_items
       WHERE tenant_id='grupo_erick' AND status='approved')<>4
    OR (SELECT count(*) FROM hermes_brain.automemory_admissions
       WHERE tenant_id='grupo_erick' AND status='admitted')<>4
 THEN RAISE EXCEPTION 'brain_telegram_readiness_incomplete'; END IF;
END $guard$;
CREATE ROLE hermes_telegram_brain_reader NOLOGIN NOINHERIT NOBYPASSRLS;
REVOKE ALL ON SCHEMA hermes_brain FROM hermes_telegram_brain_reader;
GRANT USAGE ON SCHEMA hermes_brain TO hermes_telegram_brain_reader;
GRANT SELECT(tenant_id,status) ON hermes_brain.tenants TO hermes_telegram_brain_reader;
GRANT SELECT(tenant_id,user_id,status,allowed_domains,allowed_classifications,allowed_visibilities)
 ON hermes_brain.memberships TO hermes_telegram_brain_reader;
GRANT SELECT(tenant_id,source_id,provider,status,source_updated_at)
 ON hermes_brain.sources TO hermes_telegram_brain_reader;
GRANT SELECT(tenant_id,source_id,source_item_digest,source_version,owner_user_id,
 content_digest,expires_at,status)
 ON hermes_brain.automemory_admissions TO hermes_telegram_brain_reader;
GRANT SELECT(tenant_id,memory_id,source_id,source_item_digest,source_version,owner_user_id,
 domain,classification,visibility,company_id,store_id,title,content,status,expires_at)
 ON hermes_brain.memory_items TO hermes_telegram_brain_reader;
CREATE POLICY brain_telegram_read_active_member ON hermes_brain.memberships
 FOR SELECT TO hermes_telegram_brain_reader
 USING (
  tenant_id='grupo_erick' AND status='active'
  AND 'financeiro'=ANY(allowed_domains) AND 'comercial'=ANY(allowed_domains)
  AND 'internal'=ANY(allowed_classifications)
  AND 'owner_only'=ANY(allowed_visibilities)
 );
CREATE POLICY brain_telegram_read_tenant ON hermes_brain.tenants
 FOR SELECT TO hermes_telegram_brain_reader
 USING (tenant_id='grupo_erick' AND status='active');
CREATE POLICY brain_telegram_read_source ON hermes_brain.sources
 FOR SELECT TO hermes_telegram_brain_reader
 USING (tenant_id='grupo_erick' AND status='verified'
  AND provider IN ('supabase_history','telegram_owner_confirmed')
  AND source_updated_at<=now());
CREATE POLICY brain_telegram_read_admission ON hermes_brain.automemory_admissions
 FOR SELECT TO hermes_telegram_brain_reader
 USING (tenant_id='grupo_erick' AND status='admitted'
  AND expires_at>now() AND
  EXISTS (SELECT 1 FROM hermes_brain.memberships m
   WHERE m.tenant_id=automemory_admissions.tenant_id
     AND m.user_id=automemory_admissions.owner_user_id AND m.status='active'));
CREATE POLICY brain_telegram_read_approved_memory ON hermes_brain.memory_items
 FOR SELECT TO hermes_telegram_brain_reader
 USING (
  tenant_id='grupo_erick' AND status='approved'
  AND visibility='owner_only' AND classification='internal'
  AND company_id IS NULL AND store_id IS NULL AND expires_at>now()
  AND domain IN ('financeiro','comercial')
  AND EXISTS (SELECT 1 FROM hermes_brain.tenants t
   WHERE t.tenant_id=memory_items.tenant_id AND t.status='active')
  AND EXISTS (SELECT 1 FROM hermes_brain.memberships m
   WHERE m.tenant_id=memory_items.tenant_id AND m.user_id=memory_items.owner_user_id
    AND m.status='active' AND memory_items.domain=ANY(m.allowed_domains)
    AND memory_items.classification=ANY(m.allowed_classifications)
    AND memory_items.visibility=ANY(m.allowed_visibilities))
  AND EXISTS (SELECT 1 FROM hermes_brain.sources s
   WHERE s.tenant_id=memory_items.tenant_id AND s.source_id=memory_items.source_id
   AND s.status='verified' AND s.source_updated_at<=now()
   AND ((s.provider='telegram_owner_confirmed' AND memory_items.domain='financeiro')
    OR (s.provider='supabase_history' AND memory_items.domain='comercial')))
  AND EXISTS (SELECT 1 FROM hermes_brain.automemory_admissions a
   WHERE a.tenant_id=memory_items.tenant_id AND a.source_id=memory_items.source_id
     AND a.source_item_digest=memory_items.source_item_digest
     AND a.source_version=memory_items.source_version
     AND a.owner_user_id=memory_items.owner_user_id
     AND a.expires_at=memory_items.expires_at AND a.status='admitted'
     AND a.content_digest='sha256:'||pg_catalog.encode(
       pg_catalog.sha256(pg_catalog.convert_to(memory_items.content,'UTF8')),'hex'))
 );
DO $verify$
BEGIN
 IF (SELECT rolcanlogin OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolsuper
     FROM pg_catalog.pg_roles WHERE rolname='hermes_telegram_brain_reader')
 OR pg_catalog.has_table_privilege('hermes_telegram_brain_reader',
    'hermes_brain.memory_items','INSERT')
 OR pg_catalog.has_table_privilege('hermes_telegram_brain_reader',
    'hermes_brain.memory_items','UPDATE')
 OR pg_catalog.has_table_privilege('hermes_telegram_brain_reader',
    'hermes_brain.memory_items','DELETE')
 OR pg_catalog.has_column_privilege('hermes_telegram_brain_reader',
    'hermes_brain.memory_items','created_at','SELECT')
 THEN RAISE EXCEPTION 'brain_telegram_machine_role_unsafe'; END IF;
END $verify$;
COMMIT;
