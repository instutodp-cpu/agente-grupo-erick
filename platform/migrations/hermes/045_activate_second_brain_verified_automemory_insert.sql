-- Hermes Brain: optional, separately gated activation of authenticated memory write.
-- Apply ONLY after verifying HTTPS Supabase Auth JWT ingress, RLS and source scope.
-- The base 043 migration registers attestations without enabling INSERT.
BEGIN;
DO $guard$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies
  WHERE schemaname='hermes_brain' AND tablename='memory_items'
  AND policyname='brain_owner_verified_automemory_insert')
 OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class
  WHERE oid='hermes_brain.memory_items'::regclass AND relforcerowsecurity)
 OR (SELECT count(*) FROM hermes_brain.automemory_admissions
     WHERE tenant_id='grupo_erick' AND status='admitted')<>4
 THEN
  RAISE EXCEPTION 'brain_verified_auth_ingress_and_four_attestations_required';
 END IF;
END $guard$;
GRANT INSERT (
 tenant_id, source_id, source_item_digest, source_version, owner_user_id,
 domain, classification, visibility, company_id, store_id,
 title, content, expires_at, status
) ON hermes_brain.memory_items TO authenticated;
REVOKE UPDATE, DELETE ON hermes_brain.memory_items FROM authenticated;
DO $verify$
BEGIN
 IF NOT pg_catalog.has_column_privilege('authenticated','hermes_brain.memory_items','content','INSERT')
 OR pg_catalog.has_column_privilege('authenticated','hermes_brain.memory_items','memory_id','INSERT')
 OR pg_catalog.has_table_privilege('authenticated','hermes_brain.memory_items','UPDATE')
 OR pg_catalog.has_table_privilege('authenticated','hermes_brain.memory_items','DELETE')
 OR pg_catalog.has_table_privilege('anon','hermes_brain.memory_items','INSERT')
 THEN RAISE EXCEPTION 'brain_verified_insert_grant_failure'; END IF;
END $verify$;
COMMIT;
