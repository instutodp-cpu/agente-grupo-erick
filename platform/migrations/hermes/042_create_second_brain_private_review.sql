-- Hermes Brain review v1: explicit-human, private, audited promotion.
-- DDL only; no proposal is approved by applying this migration.
-- Not exposed via PostgREST, no service_role or browser approval authority.
BEGIN;

CREATE TABLE hermes_brain.review_events (
 tenant_id text NOT NULL,
 proposal_id uuid NOT NULL,
 reviewer_user_id uuid NOT NULL,
 decision text NOT NULL CHECK (decision IN ('approve','reject')),
 approval_reference text NOT NULL CHECK (approval_reference ~ '^HUMAN-[A-Z0-9_-]{8,80}$'),
 rationale text NOT NULL CHECK (char_length(rationale) BETWEEN 12 AND 500),
 reviewed_body_sha256 text NOT NULL CHECK (reviewed_body_sha256 ~ '^[a-f0-9]{64}$'),
 source_id uuid,
 memory_id uuid,
 decided_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, proposal_id),
 FOREIGN KEY (tenant_id,proposal_id) REFERENCES hermes_brain.inbox_candidates(tenant_id,proposal_id),
 CHECK ((decision='approve' AND source_id IS NOT NULL AND memory_id IS NOT NULL)
     OR (decision='reject' AND source_id IS NULL AND memory_id IS NULL))
);
ALTER TABLE hermes_brain.review_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hermes_brain.review_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON hermes_brain.review_events FROM PUBLIC, anon, authenticated, service_role;

-- This is deliberately NOT a public schema RPC. Only the existing privileged
-- SQL administration channel can perform an actual human-authorized decision.
CREATE OR REPLACE FUNCTION hermes_brain.review_proposal(
 p_tenant_id text,
 p_proposal_id uuid,
 p_reviewer_user_id uuid,
 p_decision text,
 p_expected_body_sha256 text,
 p_approval_reference text,
 p_rationale text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
AS $review$
DECLARE
 v_p hermes_brain.inbox_candidates%ROWTYPE;
 v_source_id uuid;
 v_memory_id uuid;
 v_actual_body_sha256 text;
 v_source_digest text;
 v_item_digest text;
BEGIN
 IF current_user <> 'postgres' THEN
   RAISE EXCEPTION 'privileged_review_channel_required' USING ERRCODE='42501';
 END IF;
 IF p_tenant_id IS NULL OR p_proposal_id IS NULL OR p_reviewer_user_id IS NULL
    OR p_decision IS NULL OR p_decision NOT IN ('approve','reject')
    OR p_expected_body_sha256 IS NULL OR p_expected_body_sha256 !~ '^[a-f0-9]{64}$'
    OR p_approval_reference IS NULL OR p_approval_reference !~ '^HUMAN-[A-Z0-9_-]{8,80}$'
    OR p_rationale IS NULL OR char_length(p_rationale) NOT BETWEEN 12 AND 500 THEN
   RAISE EXCEPTION 'invalid_review_parameters' USING ERRCODE='22023';
 END IF;

 -- Freeze the reviewed version; a concurrent review cannot promote twice.
 SELECT * INTO v_p
 FROM hermes_brain.inbox_candidates
 WHERE tenant_id = p_tenant_id AND proposal_id = p_proposal_id
 FOR UPDATE;
 IF NOT FOUND OR v_p.status <> 'pending'
    OR v_p.reviewed_at IS NOT NULL OR v_p.reviewed_by IS NOT NULL THEN
   RAISE EXCEPTION 'proposal_not_pending' USING ERRCODE='P0001';
 END IF;

 -- Fail closed on an altered body or unsupported intake source.
 v_actual_body_sha256 := pg_catalog.encode(
   pg_catalog.sha256(pg_catalog.convert_to(v_p.body,'UTF8')),'hex');
 IF v_actual_body_sha256 <> p_expected_body_sha256 OR v_p.source_type <> 'user_note' THEN
   RAISE EXCEPTION 'proposal_content_or_source_mismatch' USING ERRCODE='P0001';
 END IF;

 -- The reviewer and author must both have active membership in the same active tenant.
 IF NOT EXISTS (
   SELECT 1 FROM hermes_brain.tenants t
   JOIN hermes_brain.memberships m ON m.tenant_id=t.tenant_id
   WHERE t.tenant_id=v_p.tenant_id AND t.status='active'
     AND m.user_id=p_reviewer_user_id AND m.status='active'
     AND v_p.domain=ANY(m.allowed_domains)
     AND v_p.classification=ANY(m.allowed_classifications)
     AND 'owner_only'=ANY(m.allowed_visibilities)
 ) OR NOT EXISTS (
   SELECT 1 FROM hermes_brain.memberships m
   WHERE m.tenant_id=v_p.tenant_id AND m.user_id=v_p.actor_user_id
     AND m.status='active' AND v_p.domain=ANY(m.allowed_domains)
     AND v_p.classification=ANY(m.allowed_classifications)
     AND 'owner_only'=ANY(m.allowed_visibilities)
 ) THEN
   RAISE EXCEPTION 'review_membership_or_scope_denied' USING ERRCODE='42501';
 END IF;
 -- Pilot only: do not cross-leak company/store scopes or confidential classifications.
 IF v_p.classification <> 'internal' OR v_p.company_id IS NOT NULL
    OR v_p.store_id IS NOT NULL THEN
   RAISE EXCEPTION 'review_scope_not_supported' USING ERRCODE='42501';
 END IF;
 IF EXISTS (SELECT 1 FROM hermes_brain.review_events
            WHERE tenant_id=p_tenant_id AND proposal_id=p_proposal_id) THEN
   RAISE EXCEPTION 'review_already_recorded' USING ERRCODE='23505';
 END IF;

 IF p_decision = 'approve' THEN
   -- A user-submitted note becomes a verified source ONLY after this admin review.
   v_source_digest := 'sha256:' || pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(
        v_p.tenant_id||':'||v_p.source_type||':'||v_p.source_ref,'UTF8')),'hex');
   INSERT INTO hermes_brain.sources
       (tenant_id,provider,reference_digest,status,source_updated_at)
   VALUES (v_p.tenant_id,'user_note',v_source_digest,'verified',v_p.submitted_at)
   RETURNING source_id INTO v_source_id;

   v_item_digest := 'sha256:' || pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(
        v_p.title||chr(10)||v_p.body||chr(10)||v_p.source_version,'UTF8')),'hex');
   INSERT INTO hermes_brain.memory_items
       (tenant_id,source_id,source_item_digest,source_version,owner_user_id,
        domain,classification,visibility,company_id,store_id,title,content,status,expires_at)
   VALUES (v_p.tenant_id,v_source_id,v_item_digest,v_p.source_version,v_p.actor_user_id,
           v_p.domain,v_p.classification,'owner_only',NULL,NULL,
           v_p.title,v_p.body,'approved',now()+INTERVAL '30 days')
   RETURNING memory_id INTO v_memory_id;
 END IF;

 UPDATE hermes_brain.inbox_candidates
 SET status=CASE WHEN p_decision='approve' THEN 'promoted' ELSE 'rejected' END,
     reviewed_at=now(), reviewed_by=p_reviewer_user_id
 WHERE tenant_id=p_tenant_id AND proposal_id=p_proposal_id;

 INSERT INTO hermes_brain.review_events
     (tenant_id,proposal_id,reviewer_user_id,decision,approval_reference,
      rationale,reviewed_body_sha256,source_id,memory_id)
 VALUES (p_tenant_id,p_proposal_id,p_reviewer_user_id,p_decision,p_approval_reference,
         p_rationale,v_actual_body_sha256,v_source_id,v_memory_id);

 RETURN pg_catalog.jsonb_build_object(
    'tenant_id',p_tenant_id,'proposal_id',p_proposal_id,
    'decision',p_decision,'memory_id',v_memory_id);
END;
$review$;

-- The private schema is NOT in the PostgREST exposed schema list.
REVOKE ALL ON FUNCTION hermes_brain.review_proposal(text,uuid,uuid,text,text,text,text)
  FROM PUBLIC,anon,authenticated,service_role;

DO $verify$
DECLARE v_fn oid;
BEGIN
 SELECT p.oid INTO v_fn FROM pg_catalog.pg_proc p
 JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='hermes_brain' AND p.proname='review_proposal'
   AND p.pronargs=7;
 IF v_fn IS NULL OR (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid=v_fn)
    OR pg_catalog.has_function_privilege('anon',v_fn,'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated',v_fn,'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role',v_fn,'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('postgres',v_fn,'EXECUTE') THEN
   RAISE EXCEPTION 'private_review_privilege_verification_failed';
 END IF;
END $verify$;
COMMIT;
