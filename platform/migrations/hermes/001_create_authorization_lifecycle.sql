-- Hermes durable persistence infrastructure v1.
-- Structural migration only. It does not select a runtime adapter or perform
-- any production write by itself.

BEGIN;

CREATE SCHEMA IF NOT EXISTS hermes;

CREATE TABLE IF NOT EXISTS hermes.authorization_lifecycle (
  authorization_id TEXT PRIMARY KEY,
  authorization_payload JSONB NOT NULL,
  authorization_hash TEXT NOT NULL,
  provisioning_plan_version TEXT NOT NULL,
  provisioning_plan_hash TEXT NOT NULL,
  execution_scope JSONB NOT NULL,
  state TEXT NOT NULL,
  sequence BIGINT NOT NULL DEFAULT 0,
  revision BIGINT NOT NULL DEFAULT 0,
  consumption_reference JSONB,
  revocation_reference JSONB,
  fingerprint TEXT NOT NULL,
  receipt_reference TEXT,
  receipt_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT authorization_lifecycle_authorization_id_nonempty
    CHECK (length(btrim(authorization_id)) > 0),
  CONSTRAINT authorization_lifecycle_payload_identity_check
    CHECK (authorization_payload->>'authorization_id' = authorization_id),
  CONSTRAINT authorization_lifecycle_payload_hash_check
    CHECK (authorization_payload->>'authorization_hash' = authorization_hash),
  CONSTRAINT authorization_lifecycle_plan_version_nonempty
    CHECK (length(btrim(provisioning_plan_version)) > 0),
  CONSTRAINT authorization_lifecycle_plan_hash_nonempty
    CHECK (length(btrim(provisioning_plan_hash)) > 0),
  CONSTRAINT authorization_lifecycle_state_check
    CHECK (state IN ('REGISTERED', 'CONSUMED', 'REVOKED')),
  CONSTRAINT authorization_lifecycle_sequence_check
    CHECK (sequence >= 0),
  CONSTRAINT authorization_lifecycle_revision_check
    CHECK (revision >= 0),
  CONSTRAINT authorization_lifecycle_fingerprint_nonempty
    CHECK (length(btrim(fingerprint)) > 0),
  CONSTRAINT authorization_lifecycle_transition_reference_check
    CHECK (
      (state = 'REGISTERED'
        AND consumption_reference IS NULL
        AND revocation_reference IS NULL)
      OR
      (state = 'CONSUMED'
        AND jsonb_typeof(consumption_reference) = 'object'
        AND consumption_reference->>'authorization_id' = authorization_id
        AND revocation_reference IS NULL)
      OR
      (state = 'REVOKED'
        AND consumption_reference IS NULL
        AND jsonb_typeof(revocation_reference) = 'object'
        AND revocation_reference->>'authorization_id' = authorization_id)
    ),
  CONSTRAINT authorization_lifecycle_receipt_pair_check
    CHECK ((receipt_reference IS NULL) = (receipt_hash IS NULL))
);

CREATE INDEX IF NOT EXISTS authorization_lifecycle_state_idx
  ON hermes.authorization_lifecycle (state);

CREATE INDEX IF NOT EXISTS authorization_lifecycle_fingerprint_idx
  ON hermes.authorization_lifecycle (authorization_id, fingerprint);

COMMIT;
