-- Applied to hermes-brain on 2026-11-11: restricted, inert audit role.
-- No password, no LOGIN, no runtime membership; only postgres owns this role.
-- RLS permits only the Grupo Erick group-shared audit scope.
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hermes_outlook_audit_writer') THEN
   CREATE ROLE hermes_outlook_audit_writer NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
ALTER ROLE hermes_outlook_audit_writer NOLOGIN NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA hermes TO hermes_outlook_audit_writer;
GRANT SELECT, INSERT ON TABLE hermes.composio_outlook_metadata_audit
 TO hermes_outlook_audit_writer;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
 ON TABLE hermes.composio_outlook_metadata_audit
 FROM hermes_outlook_audit_writer;
CREATE POLICY composio_outlook_audit_writer_read
 ON hermes.composio_outlook_metadata_audit
 FOR SELECT TO hermes_outlook_audit_writer
 USING (tenant_id='grupo_erick' AND scope_type='group_shared');
CREATE POLICY composio_outlook_audit_writer_insert
 ON hermes.composio_outlook_metadata_audit
 FOR INSERT TO hermes_outlook_audit_writer
 WITH CHECK (tenant_id='grupo_erick' AND scope_type='group_shared');
