BEGIN;
CREATE SCHEMA IF NOT EXISTS hermes;
CREATE TABLE IF NOT EXISTS hermes.maintainer_github_update_file_execution_outcome (
 outcome_key TEXT PRIMARY KEY,outcome_digest TEXT NOT NULL,intent_digest TEXT NOT NULL,attempt_reference TEXT NOT NULL,admission_reference TEXT NOT NULL,repository TEXT NOT NULL,operation TEXT NOT NULL,branch TEXT NOT NULL,path TEXT NOT NULL,previous_blob_sha TEXT NOT NULL,provider_status INTEGER NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT maintainer_github_update_file_outcome_key_binding CHECK (outcome_key=outcome_digest||'::execution-outcome'),
 CONSTRAINT maintainer_github_update_file_outcome_digest_check CHECK (outcome_digest ~ '^sha256:[a-f0-9]{64}$'),
 CONSTRAINT maintainer_github_update_file_intent_digest_check CHECK (intent_digest ~ '^sha256:[a-f0-9]{64}$'),
 CONSTRAINT maintainer_github_update_file_attempt_nonempty CHECK (length(btrim(attempt_reference))>0),
 CONSTRAINT maintainer_github_update_file_admission_nonempty CHECK (length(btrim(admission_reference))>0),
 CONSTRAINT maintainer_github_update_file_repository_fixed CHECK (repository='instutodp-cpu/agente-grupo-erick'),
 CONSTRAINT maintainer_github_update_file_operation_fixed CHECK (operation='update_file'),
 CONSTRAINT maintainer_github_update_file_branch_check CHECK (branch ~ '^hermes/[a-z0-9][a-z0-9._/-]{0,99}$' AND position('..' in branch)=0),
 CONSTRAINT maintainer_github_update_file_path_check CHECK (length(path)>0 AND length(path)<=240 AND left(path,1)<>'/' AND position('\\' in path)=0 AND position('..' in path)=0),
 CONSTRAINT maintainer_github_update_file_previous_blob_sha_check CHECK (previous_blob_sha ~ '^[a-f0-9]{40}$'),
 CONSTRAINT maintainer_github_update_file_provider_status_fixed CHECK (provider_status=200)
);
CREATE UNIQUE INDEX IF NOT EXISTS maintainer_github_update_file_execution_outcome_digest_idx ON hermes.maintainer_github_update_file_execution_outcome(outcome_digest);
CREATE INDEX IF NOT EXISTS maintainer_github_update_file_execution_outcome_attempt_idx ON hermes.maintainer_github_update_file_execution_outcome(attempt_reference);
CREATE INDEX IF NOT EXISTS maintainer_github_update_file_execution_outcome_admission_idx ON hermes.maintainer_github_update_file_execution_outcome(admission_reference);
COMMIT;
