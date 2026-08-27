-- Hermes P9A schema enablement.
-- PostgreSQL state and revision are the canonical persisted lifecycle.

BEGIN;

ALTER TABLE hermes.execution_attempts
  DROP CONSTRAINT IF EXISTS execution_attempts_state_check,
  DROP CONSTRAINT IF EXISTS execution_attempts_revision_check;

ALTER TABLE hermes.execution_attempts
  ADD CONSTRAINT execution_attempts_lifecycle_check
  CHECK (
    (state = 'PREPARED' AND revision = 1)
    OR
    (state = 'ADMITTED' AND revision = 2)
  );

COMMIT;
