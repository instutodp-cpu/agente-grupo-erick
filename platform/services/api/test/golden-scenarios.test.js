'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fixturePath = path.resolve(__dirname, 'fixtures/hermes-golden-scenarios.json');
const permissionMatrixPath = path.resolve(__dirname, '../../../docs/PERMISSION_MATRIX.md');
const goldenScenariosDocPath = path.resolve(__dirname, '../../../docs/GOLDEN_SCENARIOS.md');

const EXPECTED_DOMAINS = [
  'compras',
  'financeiro',
  'treinamento',
  'marketing',
  'desenvolvimento'
];

const REQUIRED_FORBIDDEN_FIELDS = [
  'requiredAdapters',
  'payload',
  'rawMessage',
  'userMessage',
  'secret',
  'token',
  'env',
  'headers',
  'cookies',
  'credentials'
];

const EXPECTED_MATRIX_FIELDS = [
  'can_read_context',
  'can_plan',
  'can_request_confirmation',
  'can_run_mock_adapter',
  'can_execute_real_action',
  'requires_confirmation',
  'requires_human_review',
  'allowed_adapter_mode',
  'risk_level'
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('permission matrix documents all current domains and safety fields', () => {
  const matrix = readText(permissionMatrixPath);

  for (const domain of EXPECTED_DOMAINS) {
    assert.match(matrix, new RegExp(`\\| ${domain} \\|`));
  }

  for (const field of EXPECTED_MATRIX_FIELDS) {
    assert.match(matrix, new RegExp(field));
  }

  assert.match(matrix, /can_execute_real_action\s*=\s*false/);
  assert.match(matrix, /allowed_adapter_mode\s*=\s*mock/);
  assert.match(matrix, /Domain Onboarding Preview/);
});

test('golden scenarios cover all current domains with mock-first contracts', () => {
  const scenarios = readJson(fixturePath);
  const scenarioDomains = new Set();

  for (const scenario of scenarios) {
    scenarioDomains.add(scenario.domain);
    assert.equal(scenario.expected_executed, false);
    assert.ok(Array.isArray(scenario.forbidden_fields));
    assert.deepEqual(scenario.forbidden_fields, REQUIRED_FORBIDDEN_FIELDS);

    if (scenario.expected_adapter_id !== null) {
      assert.match(scenario.expected_adapter_id, /^mock-/);
    }
  }

  for (const domain of EXPECTED_DOMAINS) {
    assert.equal(scenarioDomains.has(domain), true);
  }
});

test('golden scenarios doc documents the negative cases and operating rules', () => {
  const doc = readText(goldenScenariosDocPath);

  for (const domain of EXPECTED_DOMAINS) {
    assert.match(doc, new RegExp(domain));
  }

  assert.match(doc, /executed:false/);
  assert.match(doc, /mock first/i);
  assert.match(doc, /human confirmation/i);
  assert.match(doc, /CI\/smoke/i);
  assert.match(doc, /requiredAdapters/);
  assert.match(doc, /rawMessage/);
  assert.match(doc, /userMessage/);
  assert.match(doc, /credentials/);
});
