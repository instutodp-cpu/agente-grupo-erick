BEGIN;
CREATE SCHEMA IF NOT EXISTS hermes;
CREATE TABLE IF NOT EXISTS hermes.maintainer_github_create_pull_request_finalization (
 finalization_key TEXT PRIMARY KEY,
 finalization_digest TEXT NOT NULL,
 outcome_digest TEXT NOT NULL,
 intent_digest TEXT NOT NULL,
 attempt_reference TEXT NOT NULL,
 admission_reference TEXT NOT NULL,
 repository TEXT NOT NULL,
 operation TEXT NOT NULL,
 base TEXT NOT NULL,
 head TEXT NOT NULL,
 draft BOOLEAN NOT NULL,
 pull_request_number BIGINT NOT NULL,
 pull_request_url TEXT NOT NULL,
 provider_status INTEGER NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT maintainer_github_create_pr_finalization_key_binding CHECK (finalization_key=finalization_digest||'::write-finalization'),
 CONSTRAINT maintainer_github_create_pr_finalization_digest_check CHECK (finalization_digest ~ '^sha256:[a-f0-9]{64}$'),
 CONSTRAINT maintainer_github_create_pr_finalization_outcome_digest_check CHECK (outcome_digest ~ '^sha256:[a-f0-9]{64}$'),
 CONSTRAINT maintainer_github_create_pr_finalization_intent_digest_check CHECK (intent_digest ~ '^sha256:[a-f0-9]{64}$'),
 CONSTRAINT maintainer_github_create_pr_finalization_attempt_nonempty CHECK (length(btrim(attempt_reference))>0),
 CONSTRAINT maintainer_github_create_pr_finalization_admission_nonempty CHECK (length(btrim(admission_reference))>0),
 CONSTRAINT maintainer_github_create_pr_finalization_repository_fixed CHECK (repository='instutodp-cpu/agente-grupo-erick'),
 CONSTRAINT maintainer_github_create_pr_finalization_operation_fixed CHECK (operation='create_pull_request'),
 CONSTRAINT maintainer_github_create_pr_finalization_base_fixed CHECK (base='main'),
 CONSTRAINT maintainer_github_create_pr_finalization_head_check CHECK (head ~ '^hermes/[a-z0-9][a-z0-9._/-]{0,99}$' AND position('..' in head)=0),
 CONSTRAINT maintainer_github_create_pr_finalization_draft_fixed CHECK (draft=TRUE),
 CONSTRAINT maintainer_github_create_pr_finalization_number_positive CHECK (pull_request_number>0),
 CONSTRAINT maintainer_github_create_pr_finalization_url_binding CHECK (pull_request_url='https://github.com/instutodp-cpu/agente-grupo-erick/pull/'||pull_request_number::text),
 CONSTRAINT maintainer_github_create_pr_finalization_provider_status_fixed CHECK (provider_status=201)
);
CREATE UNIQUE INDEX IF NOT EXISTS maintainer_github_create_pr_finalization_digest_idx ON hermes.maintainer_github_create_pull_request_finalization(finalization_digest);
CREATE INDEX IF NOT EXISTS maintainer_github_create_pr_finalization_outcome_idx ON hermes.maintainer_github_create_pull_request_finalization(outcome_digest);
CREATE INDEX IF NOT EXISTS maintainer_github_create_pr_finalization_attempt_idx ON hermes.maintainer_github_create_pull_request_finalization(attempt_reference);
CREATE INDEX IF NOT EXISTS maintainer_github_create_pr_finalization_admission_idx ON hermes.maintainer_github_create_pull_request_finalization(admission_reference);
COMMIT;
