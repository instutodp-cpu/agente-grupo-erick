-- Hermes P12A.1 canonical durable-claim identity completion.
-- Additive constraints only. Claim acquisition remains a later boundary.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'hermes'
      AND r.relname = 'execution_attempt_claims'
      AND c.conname = 'execution_attempt_claims_claim_id_format_check'
  ) THEN
    ALTER TABLE hermes.execution_attempt_claims
      ADD CONSTRAINT execution_attempt_claims_claim_id_format_check
      CHECK (claim_id ~ '^runtime-execution-attempt-durable-claim-[0-9a-f]{64}$') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'hermes'
      AND r.relname = 'execution_attempt_claims'
      AND c.conname = 'execution_attempt_claims_digest_format_check'
  ) THEN
    ALTER TABLE hermes.execution_attempt_claims
      ADD CONSTRAINT execution_attempt_claims_digest_format_check
      CHECK (
        claim_intent_reference_digest ~ '^sha256:[0-9a-f]{64}$'
        AND claim_eligibility_decision_reference_digest ~ '^sha256:[0-9a-f]{64}$'
        AND claim_digest ~ '^sha256:[0-9a-f]{64}$'
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'hermes'
      AND r.relname = 'execution_attempt_claims'
      AND c.conname = 'execution_attempt_claims_artifact_identity_binding_check'
  ) THEN
    ALTER TABLE hermes.execution_attempt_claims
      ADD CONSTRAINT execution_attempt_claims_artifact_identity_binding_check
      CHECK (
        claim_artifact->>'claim_fingerprint' = claim_fingerprint
        AND claim_artifact->>'claim_digest' = claim_digest
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'hermes'
      AND r.relname = 'execution_attempt_claims'
      AND c.conname = 'execution_attempt_claims_receipt_identity_binding_check'
  ) THEN
    ALTER TABLE hermes.execution_attempt_claims
      ADD CONSTRAINT execution_attempt_claims_receipt_identity_binding_check
      CHECK (
        claim_receipt->>'claim_fingerprint' = claim_fingerprint
        AND claim_receipt->>'claim_digest' = claim_digest
      ) NOT VALID;
  END IF;
END $$;

COMMIT;
