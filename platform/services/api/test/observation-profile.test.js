'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const PROFILE_PATH = path.join(__dirname, '../../../docker-compose.observation.yml');

test('staging observation profile is isolated and execution-disabled', () => {
  const profile = fs.readFileSync(PROFILE_PATH, 'utf8');

  assert.match(profile, /profiles:\s*\["observation"\]/);
  assert.match(profile, /HERMES_EXECUTION_ENABLED:\s*"false"/);
  assert.match(profile, /HERMES_EXECUTION_KILL_SWITCH:\s*"true"/);
  assert.doesNotMatch(profile, /HERMES_EXECUTION_ENABLED:\s*"?true"?/i);
  assert.doesNotMatch(profile, /DATABASE_URL|POSTGRES|REDIS_URL|QDRANT_URL/i);
  assert.doesNotMatch(profile, /TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY/i);
  assert.doesNotMatch(profile, /production|prod\b|hermes-vps|ssh|kubectl/i);
  assert.match(profile, /127\.0\.0\.1:\$\{OBSERVATION_API_PORT/);
});
