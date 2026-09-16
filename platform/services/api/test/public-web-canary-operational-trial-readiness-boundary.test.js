'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  ALLOWED_INPUT_FIELDS,
  PUBLIC_WEB_CANARY_OPERATIONAL_TRIAL_READINESS_STATUS,
  REQUIRED_BOOLEAN_FIELDS,
  evaluatePublicWebCanaryOperationalTrialReadiness,
  normalizePublicWebCanaryOperationalTrialReadinessInput
} = require('../src/core/public-web-canary-operational-trial-readiness-boundary');

function validInput(overrides = {}) {
  return {
    pr_b_configuration_present: true,
    operational_trial_historical: true,
    operational_trial_synthetic: true,
    pr_c_authorized: false,
    real_execution_enabled: false,
    real_network_present: false,
    real_provider_present: false,
    real_secret_resolution_present: false,
    database_write_present: false,
    migration_present: false,
    scheduler_worker_queue_real_present: false,
    operational_runner_reachable: false,
    external_side_effect_present: false,
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    ...overrides
  };
}

test('readiness boundary returns review-only status and fixed safe evidence', () => {
  const result = evaluatePublicWebCanaryOperationalTrialReadiness(validInput());
  assert.equal(result.status, PUBLIC_WEB_CANARY_OPERATIONAL_TRIAL_READINESS_STATUS.READY_FOR_REVIEW);
  assert.equal(result.ready_for_review, true);
  assert.equal(result.ready_for_real_execution, false);
  assert.deepEqual(result.blocked_reasons, []);
  assert.equal(result.evidence.simulated, true);
  assert.equal(result.evidence.executed, false);
  assert.equal(result.evidence.real_provider_called, false);
  assert.equal(result.evidence.can_trigger_real_execution, false);
});

test('every real authorization or capability signal fails closed', () => {
  for (const field of [
    'pr_c_authorized',
    'real_execution_enabled',
    'real_network_present',
    'real_provider_present',
    'real_secret_resolution_present',
    'database_write_present',
    'migration_present',
    'scheduler_worker_queue_real_present',
    'operational_runner_reachable',
    'external_side_effect_present'
  ]) {
    const result = evaluatePublicWebCanaryOperationalTrialReadiness(validInput({ [field]: true }));
    assert.equal(result.status, 'NOT_READY', field);
    assert.equal(result.ready_for_real_execution, false);
    assert.ok(result.blocked_reasons.length > 0, field);
  }
});

test('missing configuration and unsafe synthetic flags fail closed', () => {
  for (const field of REQUIRED_BOOLEAN_FIELDS) {
    const input = validInput();
    delete input[field];
    const result = evaluatePublicWebCanaryOperationalTrialReadiness(input);
    assert.equal(result.status, 'NOT_READY', field);
    assert.equal(result.ready_for_real_execution, false);
  }

  for (const [field, value] of [
    ['pr_b_configuration_present', false],
    ['operational_trial_historical', false],
    ['operational_trial_synthetic', false],
    ['simulated', false],
    ['executed', true],
    ['real_provider_called', true],
    ['can_trigger_real_execution', true]
  ]) {
    const result = evaluatePublicWebCanaryOperationalTrialReadiness(validInput({ [field]: value }));
    assert.equal(result.status, 'NOT_READY', field);
  }
});

test('only strict booleans and known fields are accepted', () => {
  for (const value of ['true', 'false', 1, 0, null, undefined, [], {}]) {
    const result = evaluatePublicWebCanaryOperationalTrialReadiness(
      validInput({ real_execution_enabled: value })
    );
    assert.equal(result.status, 'NOT_READY', String(value));
  }
  const unknown = evaluatePublicWebCanaryOperationalTrialReadiness(validInput({ unknown: false }));
  assert.equal(unknown.status, 'NOT_READY');
  assert.ok(unknown.blocked_reasons.includes('unknown_input_field'));
});

test('evaluation is deterministic and does not mutate input', () => {
  const input = validInput();
  const before = structuredClone(input);
  const first = evaluatePublicWebCanaryOperationalTrialReadiness(input);
  const second = evaluatePublicWebCanaryOperationalTrialReadiness(input);
  assert.deepEqual(input, before);
  assert.deepEqual(second, first);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.evidence), true);
});

test('errors and evidence are sanitized and never include caller values', () => {
  const input = validInput({ real_provider_present: true });
  input.secret_value = 'must-not-appear';
  const result = evaluatePublicWebCanaryOperationalTrialReadiness(input);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('must-not-appear'), false);
  assert.equal(serialized.includes('secret_value'), false);
  assert.equal(result.evidence.real_provider_present, false);
});

test('normalization exposes only the explicit allowlisted contract fields', () => {
  const normalized = normalizePublicWebCanaryOperationalTrialReadinessInput(validInput());
  assert.equal(normalized.valid, true);
  assert.deepEqual(Object.keys(normalized.normalized).sort(), [...ALLOWED_INPUT_FIELDS].sort());
  assert.equal(normalized.normalized.pr_c_authorized, false);
});

test('boundary import closure has no operational capability', () => {
  const entry = path.join(__dirname, '..', 'src', 'core', 'public-web-canary-operational-trial-readiness-boundary.js');
  const source = fs.readFileSync(entry, 'utf8');
  for (const forbidden of [
    /\bfetch\s*\(/,
    /\baxios\b/,
    /require\(\s*['"]node:(?:http|https|dns|tls)['"]\s*\)/,
    /require\(\s*['"](?:\.\.\/)?pilots\//,
    /require\(\s*['"][^'"]*(?:provider|secret|database|migration|scheduler|worker|queue|runner)[^'"]*['"]\s*\)/i,
    /process\.env/
  ]) {
    assert.equal(forbidden.test(source), false, String(forbidden));
  }
  assert.equal(source.includes("require('./canonical-content-digest')"), true);
  assert.equal(source.includes("require('../pilots"), false);
});
