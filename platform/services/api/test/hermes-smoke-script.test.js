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

test('hermes smoke test json helpers pass JSON outside the Python stdin script stream', () => {
  const scriptPath = path.resolve(__dirname, '../../../scripts/hermes-smoke-test.sh');
  const script = fs.readFileSync(scriptPath, 'utf8');

  assert.match(script, /JSON_INPUT="\$json"\s+"\$PYTHON_BIN" - "\$path"/);
  assert.match(script, /JSON_INPUT="\$json"\s+"\$PYTHON_BIN" - "\$field"/);
  assert.match(script, /JSON_INPUT="\$json"\s+"\$PYTHON_BIN" - "\$fields"/);
  assert.equal(/printf '%s' "\$json" \| "\$PYTHON_BIN" -/.test(script), false);
  assert.match(script, /json\.loads\(os\.environ\["JSON_INPUT"\]\)/);
});

test('hermes smoke test normalizes JSON booleans and logs safe request diagnostics', () => {
  const scriptPath = path.resolve(__dirname, '../../../scripts/hermes-smoke-test.sh');
  const script = fs.readFileSync(scriptPath, 'utf8');

  assert.match(script, /isinstance\(value, bool\)/);
  assert.match(script, /"true" if value else "false"/);
  assert.match(script, /smoke request: step=%s method=%s path=%s http_status=%s body_bytes=%s/);
  assert.equal(/cat "\$response_file"\s*>\s*&2/.test(script), false);
});
