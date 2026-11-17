'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const PLATFORM_ROOT = path.join(__dirname, '../../../');
const RUNBOOK_PATH = path.join(
  PLATFORM_ROOT,
  'docs/HERMES_GITHUB_READ_PILOT_STAGING_CANARY.md',
);

test('GitHub read-pilot canary keeps staging and read-only boundaries explicit', () => {
  const runbook = fs.readFileSync(RUNBOOK_PATH, 'utf8');

  assert.match(runbook, /staging-only/i);
  assert.match(runbook, /read-only/i);
  assert.match(runbook, /fail-closed/i);
  assert.match(runbook, /production-blocked/i);
  assert.match(runbook, /HERMES_DEPLOYMENT_STAGE=staging/);
  assert.match(runbook, /HERMES_EXECUTION_ENABLED=false/);
  assert.match(runbook, /HERMES_EXECUTION_KILL_SWITCH=true/);
  assert.match(runbook, /HERMES_MISSION_INGRESS_ENABLED=false/);
  assert.match(runbook, /HERMES_GITHUB_READ_PILOT_ENABLED=true/);
  assert.match(runbook, /127\.0\.0\.1/);
  assert.match(runbook, /--network none/);
  assert.match(runbook, /pilot_explicitly_disabled/);
  assert.match(runbook, /Supabase/i);
  assert.match(runbook, /no automatic\s+merge, deploy, restart/i);
  assert.match(runbook, /rollback/i);
  assert.match(runbook, /required state\s+is `STOP`/i);
});

test('GitHub read-pilot canary does not embed secret material or public ingress', () => {
  const runbook = fs.readFileSync(RUNBOOK_PATH, 'utf8');

  assert.doesNotMatch(runbook, /-----BEGIN [A-Z ]+PRIVATE KEY-----/);
  assert.doesNotMatch(runbook, /Authorization:\s+(Bearer|Basic)\s+\S+/i);
  assert.doesNotMatch(runbook, /0\.0\.0\.0/);
  assert.doesNotMatch(runbook, /HERMES_EXECUTION_ENABLED\s*=\s*true/i);
});
