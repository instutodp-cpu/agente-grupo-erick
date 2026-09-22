CREATE SCHEMA IF NOT EXISTS hermes;

CREATE TABLE IF NOT EXISTS hermes.public_web_canary_single_use_resources (
  resource_type text NOT NULL CHECK (resource_type IN ('OFFICIAL_AUTHORIZATION','GRANT','RESERVATION')),
  resource_id text NOT NULL,
  trial_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('AVAILABLE','CONSUMED','EXECUTION_RESERVED')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (resource_type, resource_id),
  CHECK (
    (resource_type IN ('OFFICIAL_AUTHORIZATION','GRANT') AND state IN ('AVAILABLE','CONSUMED') AND expires_at IS NOT NULL)
    OR
    (resource_type = 'RESERVATION' AND state IN ('AVAILABLE','EXECUTION_RESERVED'))
  )
);

CREATE TABLE IF NOT EXISTS hermes.public_web_canary_atomic_commits (
  trial_id text PRIMARY KEY,
  official_authorization_id text NOT NULL UNIQUE,
  grant_id text NOT NULL UNIQUE,
  reservation_id text NOT NULL UNIQUE,
  committed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
