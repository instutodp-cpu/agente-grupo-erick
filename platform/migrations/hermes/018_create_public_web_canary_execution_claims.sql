CREATE SCHEMA IF NOT EXISTS hermes;

CREATE TABLE IF NOT EXISTS hermes.public_web_canary_execution_claims (
  trial_id text PRIMARY KEY,
  reservation_id text NOT NULL UNIQUE,
  official_authorization_id text NOT NULL UNIQUE,
  grant_id text NOT NULL UNIQUE,
  command_fingerprint text NOT NULL,
  confirmed_at timestamptz NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  state text NOT NULL DEFAULT 'CLAIMED' CHECK (state = 'CLAIMED'),
  production_allowed boolean NOT NULL DEFAULT false CHECK (production_allowed = false)
);
