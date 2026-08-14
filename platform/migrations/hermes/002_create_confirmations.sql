-- Hermes confirmation persistence v1.
-- Structural/test infrastructure only. This migration is not auto-applied.

BEGIN;

CREATE SCHEMA IF NOT EXISTS hermes;

CREATE TABLE IF NOT EXISTS hermes.confirmations (
  confirmation_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  intent TEXT NOT NULL,
  status TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT confirmations_confirmation_id_nonempty
    CHECK (length(btrim(confirmation_id)) > 0),
  CONSTRAINT confirmations_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired'))
);

COMMIT;
