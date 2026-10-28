-- Second Brain inbox: create PENDING suggestions, never approved memories.
-- The authenticated session must carry a verified Supabase Auth JWT.
-- A human-controlled, separately privileged process will review/promote.
BEGIN;
CREATE TABLE hermes_brain.inbox_candidates (
 tenant_id text NOT NULL REFERENCES hermes_brain.tenants(tenant_id),
 proposal_id uuid NOT NULL DEFAULT gen_random_uuid(),
 actor_user_id uuid NOT NULL,
 source_type text NOT NULL CHECK(source_type IN
  ('user_note','document_summary','meeting_summary','project_context','external_source_summary')),
 source_ref text NOT NULL CHECK(char_length(source_ref) BETWEEN 1 AND 160
  AND source_ref ~ '^[a-zA-Z0-9._:/-]+$'),
 source_version text NOT NULL DEFAULT 'v1'
  CHECK(char_length(source_version) BETWEEN 1 AND 80),
 title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 160),
 body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 4000),
 domain text NOT NULL CHECK(domain ~ '^[a-z][a-z0-9_]{0,63}$'),
 classification text NOT NULL CHECK(classification IN ('internal','confidential')),
 company_id text, store_id text,
 status text NOT NULL DEFAULT 'pending'
  CHECK(status IN ('pending','reviewed','rejected','promoted')),
 submitted_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz,
 reviewed_by uuid,
 PRIMARY KEY(tenant_id,proposal_id),
 UNIQUE(tenant_id,actor_user_id,source_type,source_ref,source_version),
 CHECK (company_id IS NULL OR company_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
 CHECK (store_id IS NULL OR store_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
 CHECK (status='pending' OR reviewed_at IS NOT NULL),
 CHECK (status='pending' OR reviewed_by IS NOT NULL)
);
CREATE INDEX brain_inbox_actor_status_idx
 ON hermes_brain.inbox_candidates(tenant_id,actor_user_id,status,submitted_at DESC);
ALTER TABLE hermes_brain.inbox_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE hermes_brain.inbox_candidates FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE hermes_brain.inbox_candidates FROM PUBLIC,anon,authenticated;

CREATE POLICY brain_inbox_owner_select ON hermes_brain.inbox_candidates
 FOR SELECT TO authenticated USING (
 actor_user_id=(SELECT auth.uid())
 AND EXISTS (
 SELECT 1 FROM hermes_brain.tenants t
 JOIN hermes_brain.memberships m ON m.tenant_id=t.tenant_id
 WHERE t.tenant_id=inbox_candidates.tenant_id
 AND t.status='active' AND m.status='active'
 AND m.user_id=(SELECT auth.uid())
 ));
CREATE POLICY brain_inbox_member_propose ON hermes_brain.inbox_candidates
 FOR INSERT TO authenticated WITH CHECK (
 status='pending' AND reviewed_at IS NULL AND reviewed_by IS NULL
 AND actor_user_id=(SELECT auth.uid())
 AND EXISTS (
 SELECT 1 FROM hermes_brain.tenants t
 JOIN hermes_brain.memberships m ON m.tenant_id=t.tenant_id
 WHERE t.tenant_id=inbox_candidates.tenant_id
 AND t.status='active' AND m.status='active'
 AND m.user_id=(SELECT auth.uid())
 AND inbox_candidates.domain=ANY(m.allowed_domains)
 AND inbox_candidates.classification=ANY(m.allowed_classifications)
 AND (inbox_candidates.company_id IS NULL OR inbox_candidates.company_id=ANY(m.company_ids))
 AND (inbox_candidates.store_id IS NULL OR inbox_candidates.store_id=ANY(m.store_ids))
 ));
GRANT SELECT,INSERT ON hermes_brain.inbox_candidates TO authenticated;
COMMIT;
