-- Hermes Accounting C24 durable operational bindings.
-- Reuses canonical Hermes execution jobs/attempts/leases. Structural migration only.

BEGIN;

CREATE SCHEMA IF NOT EXISTS hermes;

CREATE TABLE IF NOT EXISTS hermes.accounting_capability_flags (
  tenant_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  version BIGINT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  real_provider_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, capability),
  CONSTRAINT accounting_capability_flags_capability_check
    CHECK (capability IN ('FINANCIAL_EXECUTION','FISCAL_SUBMISSION')),
  CONSTRAINT accounting_capability_flags_version_check CHECK (version >= 1),
  CONSTRAINT accounting_capability_flags_identity_check
    CHECK (length(btrim(tenant_id)) > 0 AND length(btrim(updated_by)) > 0)
);

CREATE TABLE IF NOT EXISTS hermes.accounting_execution_bindings (
  binding_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  execution_job_reference_id TEXT NOT NULL,
  execution_attempt_record_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT accounting_execution_bindings_job_fk
    FOREIGN KEY (execution_job_reference_id) REFERENCES hermes.execution_jobs(job_reference_id) ON DELETE RESTRICT,
  CONSTRAINT accounting_execution_bindings_attempt_fk
    FOREIGN KEY (execution_attempt_record_id) REFERENCES hermes.execution_attempts(attempt_durable_record_id) ON DELETE RESTRICT,
  CONSTRAINT accounting_execution_bindings_capability_check
    CHECK (capability IN ('FINANCIAL_EXECUTION','FISCAL_SUBMISSION')),
  CONSTRAINT accounting_execution_bindings_identity_check
    CHECK (
      length(btrim(binding_id)) > 0 AND length(btrim(tenant_id)) > 0
      AND length(btrim(operation_id)) > 0 AND length(btrim(idempotency_key)) > 0
    ),
  CONSTRAINT accounting_execution_bindings_operation_key
    UNIQUE (tenant_id, capability, operation_id),
  CONSTRAINT accounting_execution_bindings_idempotency_key
    UNIQUE (tenant_id, capability, idempotency_key)
);

CREATE INDEX IF NOT EXISTS accounting_execution_bindings_job_idx
  ON hermes.accounting_execution_bindings(execution_job_reference_id);

COMMIT;
