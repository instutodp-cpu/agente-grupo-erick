'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(
  path.join(
    __dirname,
    '../../../migrations/hermes/054_add_personal_conversation_grant_lookup_index.sql'
  ),
  'utf8'
);

test('personal grant foreign key has a covering child index', () => {
  assert.match(
    migration,
    /CREATE INDEX IF NOT EXISTS personal_conversation_messages_grant_lookup\s+ON hermes_brain\.personal_conversation_messages\s*\(\s*owner_user_id,\s*provider,\s*grant_id\s*\)/i
  );
  assert.doesNotMatch(migration, /DROP INDEX|DELETE FROM|TRUNCATE/i);
});
