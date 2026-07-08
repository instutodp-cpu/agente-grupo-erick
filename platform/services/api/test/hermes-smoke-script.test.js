'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('hermes smoke test script exists and does not embed external secrets or URLs', () => {
  const scriptPath = path.resolve(__dirname, '../../../scripts/hermes-smoke-test.sh');
  const script = fs.readFileSync(scriptPath, 'utf8');

  assert.match(script, /API_BASE_URL="\$\{API_BASE_URL:-http:\/\/localhost:8080\}"/);
  assert.equal(/https:\/\//.test(script), false);
  assert.equal(/Bearer\s/i.test(script), false);
  assert.equal(/token\s*[:=]/i.test(script), false);
  assert.equal(/secret\s*[:=]/i.test(script), false);
  assert.equal(/authorization\s*[:=]/i.test(script), false);
  assert.equal(/cookie\s*[:=]/i.test(script), false);
  assert.equal(/http:\/\/(?!localhost:8080)/.test(script), false);
});
