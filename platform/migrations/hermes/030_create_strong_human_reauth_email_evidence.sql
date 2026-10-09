CREATE TABLE IF NOT EXISTS hermes.strong_human_reauth_email_evidence (
  evidence_key text PRIMARY KEY CHECK (evidence_key ~ '^sha256:[0-9a-f]{64}$'),
  challenge_id text NOT NULL REFERENCES hermes.strong_human_reauth_email_challenges(challenge_id),
  subject_id text NOT NULL,
  action_digest text NOT NULL CHECK (action_digest ~ '^sha256:[0-9a-f]{64}$'),
  email_identity_reference text NOT NULL,
  provider_event_reference text NOT NULL UNIQUE CHECK (provider_event_reference ~ '^sha256:[0-9a-f]{64}$'),
  verified_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'VERIFIED' CHECK (state IN ('VERIFIED','CONSUMED')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS strong_human_reauth_email_evidence_challenge_state_idx ON hermes.strong_human_reauth_email_evidence(challenge_id,state);
