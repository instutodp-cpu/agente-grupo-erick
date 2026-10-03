'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { audit } = require('../scripts/hermes-self-audit');

test('self-audit readiness evidence is internally safe and anchored', () => {
  const result = audit();
  assert.equal(result.status, 'pass');
  assert.equal(result.errors.length, 0);
  assert.ok(result.capability_count >= 4);
  assert.ok(result.finding_count >= 5);
  assert.match(result.audited_revision, /^[0-9a-f]{40}$/);
});
