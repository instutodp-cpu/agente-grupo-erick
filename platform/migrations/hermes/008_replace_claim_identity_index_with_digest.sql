-- Hermes P12B PostgreSQL index-size correction.
-- Preserve the complete canonical claim identity in the row, but use only its
-- official SHA-256 digest for the physical uniqueness key.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM hermes.execution_attempt_claims
    GROUP BY attempt_durable_record_id, claim_digest
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'execution_attempt_claims_digest_identity_duplicate'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM hermes.execution_attempt_claims
    WHERE octet_length(claim_digest) > 8191
  ) THEN
    RAISE EXCEPTION 'execution_attempt_claims_digest_identity_oversized'
      USING ERRCODE = '54000';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'hermes'
      AND r.relname = 'execution_attempt_claims'
      AND c.conname = 'execution_attempt_claims_digest_identity_key'
  ) THEN
    ALTER TABLE hermes.execution_attempt_claims
      ADD CONSTRAINT execution_attempt_claims_digest_identity_key
      UNIQUE (attempt_durable_record_id, claim_digest);
  END IF;
END $$;

ALTER TABLE hermes.execution_attempt_claims
  DROP CONSTRAINT IF EXISTS execution_attempt_claims_identity_key;

COMMIT;
