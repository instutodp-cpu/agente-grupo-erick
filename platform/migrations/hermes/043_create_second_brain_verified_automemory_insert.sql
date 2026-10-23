-- HERMES Brain pilot AutoMemory: bounded RLS admission for verified enterprise sources.
-- STAGING CANDIDATE; DO NOT APPLY until an independently JWT-verified
-- authenticated ingress and a private-schema boundary are demonstrated.
-- This is NOT a user-facing direct write API and creates no new tenant.
-- Approved memory text is authenticated APP data, not executive authority.
BEGIN;
DO $guard$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='hermes_brain' AND c.relname='memory_items'
    AND c.relrowsecurity AND c.relforcerowsecurity
 ) THEN
  RAISE EXCEPTION 'hermes_brain_rls_required';
 END IF;
END $guard$;
-- Only the fixed structured-curator fields may be inserted. No user can
-- set server-generated memory_id, created_at, updated_at or mutate rows.
GRANT INSERT (
 tenant_id, source_id, source_item_digest, source_version, owner_user_id,
 domain, classification, visibility, company_id, store_id,
 title, content, expires_at, status
) ON hermes_brain.memory_items TO authenticated;

CREATE POLICY brain_owner_verified_automemory_insert
ON hermes_brain.memory_items
FOR INSERT TO authenticated
WITH CHECK (
 -- Enterprise staging pilot ONLY: personal and SaaS customer tenants denied.
 tenant_id='grupo_erick'
 AND (SELECT auth.uid()) IS NOT NULL
 AND owner_user_id=(SELECT auth.uid())
 AND classification='internal'
 AND visibility='owner_only'
 AND company_id IS NULL AND store_id IS NULL
 AND status='approved'
 AND expires_at>now()
 AND EXISTS (
   SELECT 1 FROM hermes_brain.tenants t
   JOIN hermes_brain.memberships m ON m.tenant_id=t.tenant_id
   JOIN hermes_brain.sources s ON s.tenant_id=t.tenant_id
      AND s.source_id=memory_items.source_id
   WHERE t.tenant_id=memory_items.tenant_id AND t.status='active'
   AND m.user_id=(SELECT auth.uid()) AND m.status='active'
   AND memory_items.domain=ANY(m.allowed_domains)
   AND memory_items.classification=ANY(m.allowed_classifications)
   AND memory_items.visibility=ANY(m.allowed_visibilities)
   AND s.status='verified' AND s.source_updated_at<=now()
   AND (
    (s.provider='telegram_owner_confirmed'
     AND memory_items.domain='financeiro'
     AND memory_items.title='Decisão confirmada — financeiro'
     AND memory_items.expires_at<=now()+INTERVAL '180 days')
    OR
    (s.provider='supabase_history'
     AND memory_items.domain='comercial'
     AND memory_items.title='Histórico verificado — comercial'
     AND memory_items.expires_at<=now()+INTERVAL '14 days')
   )
 )
);
REVOKE UPDATE, DELETE ON hermes_brain.memory_items FROM authenticated;
DO $check$
BEGIN
 IF NOT pg_catalog.has_column_privilege('authenticated','hermes_brain.memory_items','content','INSERT')
   OR pg_catalog.has_column_privilege('authenticated','hermes_brain.memory_items','memory_id','INSERT')
   OR pg_catalog.has_table_privilege('authenticated','hermes_brain.memory_items','UPDATE')
   OR pg_catalog.has_table_privilege('authenticated','hermes_brain.memory_items','DELETE')
   OR pg_catalog.has_table_privilege('anon','hermes_brain.memory_items','INSERT')
   OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_policies
                 WHERE schemaname='hermes_brain' AND tablename='memory_items'
                 AND policyname='brain_owner_verified_automemory_insert'
                 AND cmd='INSERT' AND roles='{authenticated}'::name[]) THEN
    RAISE EXCEPTION 'automemory_insert_policy_verification_failed';
 END IF;
END $check$;
COMMIT;
