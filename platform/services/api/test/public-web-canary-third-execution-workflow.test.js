'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('third canary workflow is manual, staging-only and exact-confirmation gated', () => {
  const text = fs.readFileSync(path.resolve(__dirname, '../../../../.github/workflows/public-web-third-canary-execution.yml'), 'utf8');
  assert.match(text, /workflow_dispatch:/);
  assert.match(text, /EXECUTAR CANARY PUBLIC WEB/);
  assert.match(text, /environment: staging/);
  assert.match(text, /https:\/\/example\.com/);
  assert.match(text, /maximum_requests === 1/);
  assert.match(text, /rollout_percentage === 1/);
  assert.doesNotMatch(text, /schedule:/);
  assert.doesNotMatch(text, /push:/);
});
