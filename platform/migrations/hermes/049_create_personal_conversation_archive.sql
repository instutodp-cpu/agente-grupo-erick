-- Hermes Second Brain personal historic chat archive V1
-- Deploy only after human review; no rows, tenants, memberships, credentials or
-- personal source consents are created by this migration.
-- Separate from approved corporate memory_items; history is always unreviewed.
BEGIN;

CREATE TABLE IF NOT EXISTS hermes_brain.personal_import_consents (
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('chatgpt','claude')),
  tenant_id text GENERATED ALWAYS AS ('personal::' || owner_user_id::text) STORED,
  grant_id uuid NOT NULL DEFAULT gen_random_uuid(),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (owner_user_id,provider),
  UNIQUE (owner_user_id,provider,grant_id)
);
ALTER TABLE hermes_brain.personal_import_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE hermes_brain.personal_import_consents FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE hermes_brain.personal_import_consents FROM PUBLIC,anon,authenticated;
-- GRANT columns, not blanket write privileges. grant_id is server generated.
GRANT SELECT ON hermes_brain.personal_import_consents TO authenticated;
GRANT INSERT (owner_user_id,provider) ON hermes_brain.personal_import_consents TO authenticated;
GRANT UPDATE (revoked_at) ON hermes_brain.personal_import_consents TO authenticated;
GRANT DELETE ON hermes_brain.personal_import_consents TO authenticated;

CREATE POLICY personal_consent_read_self ON hermes_brain.personal_import_consents
 FOR SELECT TO authenticated USING (owner_user_id=(SELECT auth.uid()));
CREATE POLICY personal_consent_create_self ON hermes_brain.personal_import_consents
 FOR INSERT TO authenticated WITH CHECK (
   owner_user_id=(SELECT auth.uid()) AND revoked_at IS NULL);
CREATE POLICY personal_consent_revoke_self ON hermes_brain.personal_import_consents
 FOR UPDATE TO authenticated
 USING (owner_user_id=(SELECT auth.uid()) AND revoked_at IS NULL)
 WITH CHECK (owner_user_id=(SELECT auth.uid()) AND revoked_at IS NOT NULL);
CREATE POLICY personal_consent_delete_self ON hermes_brain.personal_import_consents
 FOR DELETE TO authenticated USING (owner_user_id=(SELECT auth.uid()));

CREATE TABLE IF NOT EXISTS hermes_brain.personal_conversation_messages (
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('chatgpt','claude')),
  tenant_id text GENERATED ALWAYS AS ('personal::' || owner_user_id::text) STORED,
  grant_id uuid NOT NULL,
  source_ref text NOT NULL CHECK (
    source_ref ~ '^(chatgpt|claude):[a-f0-9]{28}:[a-f0-9]{28}$'),
  conversation_ref text NOT NULL CHECK (
    conversation_ref ~ '^(chatgpt|claude):[a-f0-9]{32}$'),
  parent_ref text CHECK (parent_ref IS NULL OR
    parent_ref ~ '^(chatgpt|claude):[a-f0-9]{28}:[a-f0-9]{28}$'),
  conversation_title text NOT NULL DEFAULT ''
    CHECK (char_length(conversation_title)<=240),
  conversation_updated_at timestamptz,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  branch_status text NOT NULL CHECK (
    branch_status IN ('selected','alternate','unknown','not_applicable')),
  created_at_source timestamptz,
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 16000),
  content_digest text NOT NULL CHECK (content_digest ~ '^sha256:[a-f0-9]{64}
  nontext_parts_omitted integer NOT NULL DEFAULT 0 CHECK (
    nontext_parts_omitted BETWEEN 0 AND 1000),
  classification text NOT NULL DEFAULT 'confidential'
    CHECK (classification='confidential'),
  visibility text NOT NULL DEFAULT 'owner_only'
    CHECK (visibility='owner_only'),
  memory_status text NOT NULL DEFAULT 'unreviewed'
    CHECK (memory_status='unreviewed'),
  ingested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id,provider,source_ref),
  CONSTRAINT personal_source_ref_provider CHECK (split_part(source_ref,':',1)=provider),
  CONSTRAINT personal_conversation_ref_provider CHECK (
    split_part(conversation_ref,':',1)=provider),
  CONSTRAINT personal_parent_ref_provider CHECK (
    parent_ref IS NULL OR split_part(parent_ref,':',1)=provider),
  CONSTRAINT personal_grant_foreign_key FOREIGN KEY
    (owner_user_id,provider,grant_id)
    REFERENCES hermes_brain.personal_import_consents
      (owner_user_id,provider,grant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS personal_conversation_owner_lookup
 ON hermes_brain.personal_conversation_messages
 (owner_user_id,provider,conversation_ref,created_at_source);
CREATE INDEX IF NOT EXISTS personal_conversation_text_search
 ON hermes_brain.personal_conversation_messages
 USING GIN(to_tsvector('simple',content));
ALTER TABLE hermes_brain.personal_conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE hermes_brain.personal_conversation_messages FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE hermes_brain.personal_conversation_messages FROM PUBLIC,anon,authenticated;
GRANT SELECT,DELETE ON hermes_brain.personal_conversation_messages TO authenticated;
GRANT INSERT (owner_user_id,provider,grant_id,source_ref,
 conversation_ref,parent_ref,conversation_title,conversation_updated_at,
 role,branch_status,created_at_source,content,content_digest,
 nontext_parts_omitted) ON hermes_brain.personal_conversation_messages TO authenticated;

CREATE POLICY personal_history_read_self ON hermes_brain.personal_conversation_messages
 FOR SELECT TO authenticated USING (
   owner_user_id=(SELECT auth.uid())
   AND EXISTS (
     SELECT 1 FROM hermes_brain.personal_import_consents g
     WHERE g.owner_user_id=personal_conversation_messages.owner_user_id
       AND g.provider=personal_conversation_messages.provider
       AND g.grant_id=personal_conversation_messages.grant_id
       AND g.revoked_at IS NULL
   ));
CREATE POLICY personal_history_create_with_active_consent
 ON hermes_brain.personal_conversation_messages
 FOR INSERT TO authenticated WITH CHECK (
   owner_user_id=(SELECT auth.uid())
   AND EXISTS (
     SELECT 1 FROM hermes_brain.personal_import_consents g
     WHERE g.owner_user_id=personal_conversation_messages.owner_user_id
       AND g.provider=personal_conversation_messages.provider
       AND g.grant_id=personal_conversation_messages.grant_id
       AND g.revoked_at IS NULL
   ));
CREATE POLICY personal_history_delete_self ON hermes_brain.personal_conversation_messages
 FOR DELETE TO authenticated USING (owner_user_id=(SELECT auth.uid()));

-- No UPDATE grant on message content or classification, no backend service_role
-- policy, no cross-tenant SELECT, no automatic memory promotion and no access
-- to the corporate Telegram reader. Revoke consent with UPDATE revoked_at
-- (stops imports and search visibility), delete consent to CASCADE-remove
-- its archived messages. Old contents must not be returned after revocation.
COMMIT;
),
  CONSTRAINT personal_digest_matches_content CHECK (
    content_digest='sha256:' || encode(sha256(convert_to(content,'UTF8')),'hex')),
  nontext_parts_omitted integer NOT NULL DEFAULT 0 CHECK (
    nontext_parts_omitted BETWEEN 0 AND 1000),
  classification text NOT NULL DEFAULT 'confidential'
    CHECK (classification='confidential'),
  visibility text NOT NULL DEFAULT 'owner_only'
    CHECK (visibility='owner_only'),
  memory_status text NOT NULL DEFAULT 'unreviewed'
    CHECK (memory_status='unreviewed'),
  ingested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id,provider,source_ref),
  CONSTRAINT personal_source_ref_provider CHECK (split_part(source_ref,':',1)=provider),
  CONSTRAINT personal_conversation_ref_provider CHECK (
    split_part(conversation_ref,':',1)=provider),
  CONSTRAINT personal_parent_ref_provider CHECK (
    parent_ref IS NULL OR split_part(parent_ref,':',1)=provider),
  CONSTRAINT personal_grant_foreign_key FOREIGN KEY
    (owner_user_id,provider,grant_id)
    REFERENCES hermes_brain.personal_import_consents
      (owner_user_id,provider,grant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS personal_conversation_owner_lookup
 ON hermes_brain.personal_conversation_messages
 (owner_user_id,provider,conversation_ref,created_at_source);
CREATE INDEX IF NOT EXISTS personal_conversation_text_search
 ON hermes_brain.personal_conversation_messages
 USING GIN(to_tsvector('simple',content));
ALTER TABLE hermes_brain.personal_conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE hermes_brain.personal_conversation_messages FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE hermes_brain.personal_conversation_messages FROM PUBLIC,anon,authenticated;
GRANT SELECT,DELETE ON hermes_brain.personal_conversation_messages TO authenticated;
GRANT INSERT (owner_user_id,provider,grant_id,source_ref,
 conversation_ref,parent_ref,conversation_title,conversation_updated_at,
 role,branch_status,created_at_source,content,content_digest,
 nontext_parts_omitted) ON hermes_brain.personal_conversation_messages TO authenticated;

CREATE POLICY personal_history_read_self ON hermes_brain.personal_conversation_messages
 FOR SELECT TO authenticated USING (
   owner_user_id=(SELECT auth.uid())
   AND EXISTS (
     SELECT 1 FROM hermes_brain.personal_import_consents g
     WHERE g.owner_user_id=personal_conversation_messages.owner_user_id
       AND g.provider=personal_conversation_messages.provider
       AND g.grant_id=personal_conversation_messages.grant_id
       AND g.revoked_at IS NULL
   ));
CREATE POLICY personal_history_create_with_active_consent
 ON hermes_brain.personal_conversation_messages
 FOR INSERT TO authenticated WITH CHECK (
   owner_user_id=(SELECT auth.uid())
   AND EXISTS (
     SELECT 1 FROM hermes_brain.personal_import_consents g
     WHERE g.owner_user_id=personal_conversation_messages.owner_user_id
       AND g.provider=personal_conversation_messages.provider
       AND g.grant_id=personal_conversation_messages.grant_id
       AND g.revoked_at IS NULL
   ));
CREATE POLICY personal_history_delete_self ON hermes_brain.personal_conversation_messages
 FOR DELETE TO authenticated USING (owner_user_id=(SELECT auth.uid()));

-- No UPDATE grant on message content or classification, no backend service_role
-- policy, no cross-tenant SELECT, no automatic memory promotion and no access
-- to the corporate Telegram reader. Revoke consent with UPDATE revoked_at
-- (stops imports and search visibility), delete consent to CASCADE-remove
-- its archived messages. Old contents must not be returned after revocation.
COMMIT;
