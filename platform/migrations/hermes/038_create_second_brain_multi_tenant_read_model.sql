-- Hermes Second Brain: tenant-scoped read model, staging candidate.
-- Apply only to the VERIFIED canonical Hermes DB, never to Softcom.
-- Admin provisioning and content ingestion use separately approved migration
-- and ingestion privileges; browser/API authenticated has SELECT only.
-- Requires Supabase auth.uid() and authenticated role, PostgreSQL 15+.
BEGIN;
CREATE SCHEMA IF NOT EXISTS hermes_brain;
REVOKE ALL ON SCHEMA hermes_brain FROM PUBLIC;

CREATE TABLE IF NOT EXISTS hermes_brain.tenants (
 tenant_id text PRIMARY KEY,
 workspace_type text NOT NULL CHECK (workspace_type IN ('personal','grupo_erick','external_client')),
 status text NOT NULL DEFAULT 'provisioning' CHECK (status IN ('provisioning','active','suspended')),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (
   (workspace_type='grupo_erick' AND tenant_id='grupo_erick') OR
   (workspace_type='personal' AND tenant_id ~ '^personal::[A-Za-z0-9_-]{1,128}$') OR
   (workspace_type='external_client' AND tenant_id ~ '^client::[A-Za-z0-9_-]{1,128}$')
 )
);

CREATE TABLE IF NOT EXISTS hermes_brain.memberships (
 tenant_id text NOT NULL REFERENCES hermes_brain.tenants(tenant_id),
 user_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','revoked')),
 company_ids text[] NOT NULL DEFAULT '{}',
 store_ids text[] NOT NULL DEFAULT '{}',
 allowed_domains text[] NOT NULL DEFAULT '{}',
 allowed_classifications text[] NOT NULL DEFAULT '{}',
 allowed_visibilities text[] NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS hermes_brain.sources (
 tenant_id text NOT NULL REFERENCES hermes_brain.tenants(tenant_id),
 source_id uuid NOT NULL DEFAULT gen_random_uuid(),
 provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]{1,63}$'),
 reference_digest text NOT NULL CHECK (reference_digest ~ '^sha256:[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'unverified' CHECK(status IN ('unverified','verified','revoked')),
 source_updated_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, source_id),
 UNIQUE (tenant_id,provider,reference_digest)
);

CREATE TABLE IF NOT EXISTS hermes_brain.memory_items (
 tenant_id text NOT NULL REFERENCES hermes_brain.tenants(tenant_id),
 memory_id uuid NOT NULL DEFAULT gen_random_uuid(),
 source_id uuid NOT NULL,
 source_item_digest text NOT NULL CHECK (source_item_digest ~ '^sha256:[a-f0-9]{64}$'),
 source_version text NOT NULL CHECK (char_length(source_version) BETWEEN 1 AND 100),
 owner_user_id uuid NOT NULL,
 domain text NOT NULL CHECK (domain ~ '^[a-z][a-z0-9_]{0,63}$'),
 classification text NOT NULL CHECK (classification IN ('public','internal','confidential')),
 visibility text NOT NULL CHECK (visibility IN ('owner_only','tenant_shared','scoped')),
 company_id text,store_id text,
 title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 240),
 content text NOT NULL CHECK(char_length(content) BETWEEN 1 AND 20000),
 status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','revoked')),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id,memory_id),
 FOREIGN KEY (tenant_id,source_id) REFERENCES hermes_brain.sources(tenant_id,source_id),
 UNIQUE (tenant_id,source_id,source_item_digest,source_version),
 CHECK (visibility <> 'scoped' OR company_id IS NOT NULL OR store_id IS NOT NULL),
 CHECK (company_id IS NULL OR company_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
 CHECK (store_id IS NULL OR store_id ~ '^[a-zA-Z0-9_-]{1,128}$')
);
CREATE INDEX IF NOT EXISTS brain_memory_approved_tenant_idx
 ON hermes_brain.memory_items(tenant_id,domain,expires_at)
 WHERE status='approved';
CREATE INDEX IF NOT EXISTS brain_memory_text_idx ON
 hermes_brain.memory_items USING GIN (
 to_tsvector('simple', coalesce(title,'')||' '||coalesce(content,'')))
 WHERE status='approved';

-- RLS is defense in depth even inside private, non-exposed schemas.
ALTER TABLE hermes_brain.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE hermes_brain.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE hermes_brain.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE hermes_brain.memory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE hermes_brain.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE hermes_brain.memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE hermes_brain.sources FORCE ROW LEVEL SECURITY;
ALTER TABLE hermes_brain.memory_items FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA hermes_brain FROM PUBLIC;

-- auth.uid() must be populated only by an authenticated, JWT-verified ingress.
-- No grants for anon; no INSERT/UPDATE/DELETE for authenticated clients.
CREATE POLICY brain_self_memberships ON hermes_brain.memberships
 FOR SELECT TO authenticated USING (user_id=(SELECT auth.uid()));
CREATE POLICY brain_active_tenants ON hermes_brain.tenants
 FOR SELECT TO authenticated USING (
 status='active' AND EXISTS(
 SELECT 1 FROM hermes_brain.memberships m
 WHERE m.tenant_id=tenants.tenant_id AND m.user_id=(SELECT auth.uid())
   AND m.status='active'));
CREATE POLICY brain_visible_sources ON hermes_brain.sources
 FOR SELECT TO authenticated USING (
 status='verified' AND EXISTS (
 SELECT 1 FROM hermes_brain.tenants t
 JOIN hermes_brain.memberships m ON m.tenant_id=t.tenant_id
 WHERE t.tenant_id=sources.tenant_id AND t.status='active'
 AND m.user_id=(SELECT auth.uid()) AND m.status='active'));
CREATE POLICY brain_approved_memory ON hermes_brain.memory_items
 FOR SELECT TO authenticated USING (
 status='approved' AND expires_at>now()
 AND EXISTS (
 SELECT 1 FROM hermes_brain.tenants t
 JOIN hermes_brain.memberships m ON m.tenant_id=t.tenant_id
 JOIN hermes_brain.sources s ON s.tenant_id=t.tenant_id AND s.source_id=memory_items.source_id
 WHERE t.tenant_id=memory_items.tenant_id AND t.status='active'
 AND m.user_id=(SELECT auth.uid()) AND m.status='active'
 AND s.status='verified'
 AND memory_items.domain=ANY(m.allowed_domains)
 AND memory_items.classification=ANY(m.allowed_classifications)
 AND memory_items.visibility=ANY(m.allowed_visibilities)
 AND (memory_items.visibility<>'owner_only' OR memory_items.owner_user_id=(SELECT auth.uid()))
 AND (memory_items.company_id IS NULL OR memory_items.company_id=ANY(m.company_ids))
 AND (memory_items.store_id IS NULL OR memory_items.store_id=ANY(m.store_ids))
 ));
DO $roles$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  GRANT USAGE ON SCHEMA hermes_brain TO authenticated;
  GRANT SELECT ON hermes_brain.tenants,hermes_brain.memberships,
   hermes_brain.sources,hermes_brain.memory_items TO authenticated;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON ALL TABLES IN SCHEMA hermes_brain FROM anon;
 END IF;
END $roles$;
COMMIT;
