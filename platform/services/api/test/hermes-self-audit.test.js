'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { audit, validateEvidence, collectEvidenceInventory, collectDirectTestBindings, validateAuthoritySeparation } = require('../scripts/hermes-self-audit');

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


test('A2 bounded autonomy remains authorized beneath scoped A3 while A4 stays excluded', () => {
  const result = audit();
  assert.equal(result.status, 'pass');
  assert.equal(result.errors.some(error => String(error.type).startsWith('missing_a2_')), false);

  const map = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../docs/audits/HERMES_READINESS_MAP.json'), 'utf8'));
  assert.deepEqual(map.autonomy.authorized_now, ['A0', 'A1', 'A2', 'A3']);
  assert.equal(map.autonomy.current_max_level, 'A3_authorized_scoped');
  assert.equal(map.autonomy.candidate, null);
  assert.equal(map.autonomy.a2_canary.status, 'authorized_bounded');
  assert.equal(map.autonomy.authorized_now.includes('A4'), false);
  for (const forbidden of ['merge','production_publish','financial_spend','customer_message','destructive_action','secret_or_permission_change']) {
    assert.ok(map.autonomy.a2_canary.forbidden.includes(forbidden));
  }
});


test('A3 scoped autonomy is promoted only with real exact-revision canary and explicit human authorization evidence', () => {
  const map = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../docs/audits/HERMES_READINESS_MAP.json'), 'utf8'));
  const capability = map.capabilities.find(item => item.id === 'a3-scoped-external-action-eligibility');
  assert.ok(capability);
  assert.equal(capability.planned, true);
  assert.equal(capability.contracted, true);
  assert.equal(capability.implemented, true);
  assert.equal(capability.tested, true);
  assert.equal(capability.proven_e2e, true);
  assert.equal(capability.operational, true);
  assert.equal(capability.evidence_revision, 'cb8580f1a0d07487410e5a5c2f27d172746b94ee');
  assert.deepEqual(map.autonomy.authorized_now, ['A0', 'A1', 'A2', 'A3']);
  assert.equal(map.autonomy.current_max_level, 'A3_authorized_scoped');
  assert.equal(map.autonomy.candidate, null);
  assert.equal(map.autonomy.a3_canary.status, 'authorized_scoped');
  assert.equal(map.autonomy.a3_canary.provider_status, 201);
  assert.equal(map.autonomy.a3_canary.human_promotion_authorized, true);
  assert.equal(map.protected_levels.includes('A3'), false);
  assert.ok(map.protected_levels.includes('A4'));
  for (const forbidden of ['merge','production_publish','financial_spend','customer_message','destructive_action','secret_or_permission_change']) {
    assert.ok(map.autonomy.a3_canary.forbidden.includes(forbidden));
  }
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

test('direct implementation-to-test bindings use explicit core references without promoting missing evidence', () => {
  const bindings = collectDirectTestBindings();
  assert.ok(bindings.length > 0);
  for (const binding of bindings) {
    assert.ok(binding.implementation.length > 0);
    assert.ok(binding.test_files.length > 0);
    assert.deepEqual(binding.test_files, [...binding.test_files].sort());
  }
});

test('router, domain registry and readiness evidence remain separate authorities', () => {
  assert.deepEqual(validateAuthoritySeparation(), []);
});
