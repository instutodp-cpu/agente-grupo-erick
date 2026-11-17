-- Cover the child side of personal_grant_foreign_key.
-- This is a schema-only performance fix; it does not read or write message data.
CREATE INDEX IF NOT EXISTS personal_conversation_messages_grant_lookup
  ON hermes_brain.personal_conversation_messages
    (owner_user_id, provider, grant_id);
