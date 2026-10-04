[Reading 52 lines from start (total: 52 lines, 0 remaining)]

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { audit, validateEvidence, collectEvidenceInventory } = require('../scripts/hermes-self-audit');

test('self-audit readiness evidence is internally safe and anchored', () => {
  const result = audit();
  assert.equal(result.status, 'pass');
  assert.equal(result.errors.length, 0);
  assert.ok(result.capability_count >= 4);
  assert.ok(result.finding_count >= 5);
  assert.match(result.audited_revision, /^[0-9a-f]{40}$/);
});


test('evidence ladder fails closed on impossible promotions', () => {
  const base = { id: 'invalid', planned: true, contracted: true, implemented: true, tested: true, proven_e2e: true, operational: true, scope: 'staging', evidence_revision: 'a'.repeat(40) };

  const cases = [
    [{ ...base, proven_e2e: false }, 'operational_without_e2e'],
    [{ ...base, tested: false }, 'e2e_without_tests'],
    [{ ...base, implemented: false }, 'tested_without_implementation'],
    [{ ...base, scope: '' }, 'missing_operational_scope'],
    [{ ...base, evidence_revision: '' }, 'missing_e2e_revision']
  ];

  for (const [capability, expectedType] of cases) {
    const errors = validateEvidence({ capabilities: [capability] });
    assert.ok(errors.some(error => error.type === expectedType), expectedType);
  }
});


test('A2 autonomy canary remains bounded below protected authority', () => {
  const result = audit();
  assert.equal(result.status, 'pass');
  assert.equal(result.errors.some(error => String(error.type).startsWith('missing_a2_')), false);
  assert.equal(result.errors.some(error => error.type === 'a2_canary_not_ready'), false);
});


test('self-audit produces repository evidence inventory instead of relying only on the manual map', () => {
  const inventory = collectEvidenceInventory();
  assert.ok(inventory.contract_docs > 0);
  assert.ok(inventory.contract_code > 0);
  assert.ok(inventory.implementation_families > 0);
  assert.ok(Array.isArray(inventory.test_binding_candidates));
  for (const gap of inventory.test_binding_candidates) {
    assert.ok(gap.implementation_files > 0);
    assert.equal(gap.test_files, 0);
  }
});

[executed on device: srv1908789 (f7221c38-fb4d-4cfd-9516-dc87ebcc0f21)]