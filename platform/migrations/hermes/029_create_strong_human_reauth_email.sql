BEGIN;
CREATE TABLE IF NOT EXISTS hermes.strong_human_reauth_email_challenges (
 challenge_id TEXT PRIMARY KEY,
 subject_id TEXT NOT NULL,
 action_digest TEXT NOT NULL,
 email_identity_reference TEXT NOT NULL,
 issued_at TIMESTAMPTZ NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 state TEXT NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','VERIFIED','CONSUMED','EXPIRED')),
 provider_event_id TEXT UNIQUE,
 verified_at TIMESTAMPTZ,
 consumed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (expires_at > issued_at)
);
CREATE INDEX IF NOT EXISTS strong_human_reauth_email_subject_state_idx ON hermes.strong_human_reauth_email_challenges(subject_id,state);
COMMIT;
