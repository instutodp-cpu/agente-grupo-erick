'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BINDING_SECTIONS,
  SECTION_FIELDS,
  evaluatePublicWebCanaryOperationalTrialReadinessBinding
} = require('../src/core/public-web-canary-operational-trial-readiness-binding');

function validInput(overrides = {}) {
  return {
    configuration: {
      present: true,
      valid: true,
      feature_flag_enabled: false,
      kill_switch_active: true
    },
    trial: {
      present: true,
      historical: true,
      synthetic: true,
      simulated: true,
      executed: false,
      real_provider_called: false,
      can_trigger_real_execution: false
    },
    authorization: {
      pr_c_authorized: false,
      real_execution_enabled: false
    },
    capabilities: {
      real_network_present: false,
      real_provider_present: false,
      real_secret_resolution_present: false,
      database_write_present: false,
      migration_present: false,
      scheduler_worker_queue_real_present: false,
      operational_runner_reachable: false,
      runner_real_present: false,
      external_side_effect_present: false
    },
    ...overrides
  };
}

test('binding composes PR-B evidence into review-only readiness', () => {
  const result = evaluatePublicWebCanaryOperationalTrialReadinessBinding(validInput());
  assert.equal(result.status, 'READY_FOR_REVIEW');
  assert.equal(result.can_continue_to_review, true);
  assert.equal(result.can_trigger_real_execution, false);
  assert.equal(result.pr_c_authorized, false);
  assert.deepEqual(result.blocked_reasons, []);
});

test('binding blocks every real authorization or capability signal', () => {
  const unsafeCases = [
    ['authorization', 'pr_c_authorized'],
    ['authorization', 'real_execution_enabled'],
    ['capabilities', 'real_network_present'],
    ['capabilities', 'real_provider_present'],
    ['capabilities', 'real_secret_resolution_present'],
    ['capabilities', 'database_write_present'],
    ['capabilities', 'migration_present'],
    ['capabilities', 'scheduler_worker_queue_real_present'],
    ['capabilities', 'operational_runner_reachable'],
    ['capabilities', 'runner_real_present'],
    ['capabilities', 'external_side_effect_present']
  ];
  for (const [section, field] of unsafeCases) {
    const input = validInput();
    input[section][field] = true;
    const result = evaluatePublicWebCanaryOperationalTrialReadinessBinding(input);
    assert.equal(result.status, 'NOT_READY', `${section}.${field}`);
    assert.equal(result.can_trigger_real_execution, false, `${section}.${field}`);
  }
});

test('missing or malformed configuration and trial evidence fail closed', () => {
  for (const section of BINDING_SECTIONS) {
    const input = validInput();
    delete input[section];
    assert.equal(
      evaluatePublicWebCanaryOperationalTrialReadinessBinding(input).status,
      'NOT_READY',
      section
    );
  }
  assert.equal(evaluatePublicWebCanaryOperationalTrialReadinessBinding({}).status, 'NOT_READY');
  assert.equal(evaluatePublicWebCanaryOperationalTrialReadinessBinding(validInput({ configuration: 'malformed' })).status, 'NOT_READY');
  assert.equal(evaluatePublicWebCanaryOperationalTrialReadinessBinding(validInput({ configuration: { ...validInput().configuration, valid: false } })).status, 'NOT_READY');
});

test('feature flag remains disabled and active kill switch permits review only', () => {
  const review = evaluatePublicWebCanaryOperationalTrialReadinessBinding(validInput());
  assert.equal(review.status, 'READY_FOR_REVIEW');
  assert.equal(review.evidence_summary.feature_flag_enabled, false);
  assert.equal(review.evidence_summary.kill_switch_active, true);
  assert.equal(evaluatePublicWebCanaryOperationalTrialReadinessBinding(validInput({
    configuration: { ...validInput().configuration, feature_flag_enabled: true }
  })).status, 'NOT_READY');
  assert.equal(evaluatePublicWebCanaryOperationalTrialReadinessBinding(validInput({
    configuration: { ...validInput().configuration, kill_switch_active: false }
  })).status, 'NOT_READY');
});

test('synthetic flags are preserved and cannot be escalated', () => {
  const result = evaluatePublicWebCanaryOperationalTrialReadinessBinding(validInput({
    trial: {
      ...validInput().trial,
      simulated: false
    }
  }));
  assert.equal(result.status, 'NOT_READY');
  assert.equal(result.can_trigger_real_execution, false);
  assert.equal(result.evidence_summary.executed, false);
  assert.equal(result.evidence_summary.real_provider_called, false);
  assert.equal(result.evidence_summary.can_trigger_real_execution, false);
});

test('binding output is deterministic and input is not mutated', () => {
  const input = validInput();
  const before = structuredClone(input);
  const first = evaluatePublicWebCanaryOperationalTrialReadinessBinding(input);
  const second = evaluatePublicWebCanaryOperationalTrialReadinessBinding(input);
  assert.deepEqual(input, before);
  assert.deepEqual(second, first);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.evidence_summary), true);
});

test('errors and evidence do not expose caller values or unknown fields', () => {
  const input = validInput();
  input.capabilities.secret_value = 'must-not-appear';
  const result = evaluatePublicWebCanaryOperationalTrialReadinessBinding(input);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('must-not-appear'), false);
  assert.equal(serialized.includes('secret_value'), false);
  assert.ok(result.blocked_reasons.includes('unknown_evidence_field'));
});

test('binding imports and calls only the pure readiness boundary', () => {
  const entry = path.join(__dirname, '..', 'src', 'core', 'public-web-canary-operational-trial-readiness-binding.js');
  const source = fs.readFileSync(entry, 'utf8');
  assert.equal(source.includes("require('./public-web-canary-operational-trial-readiness-boundary')"), true);
  assert.equal(source.includes('evaluatePublicWebCanaryOperationalTrialReadiness('), true);
  for (const forbidden of [
    /\bfetch\s*\(/,
    /\baxios\b/,
    /require\(\s*['"]node:(?:http|https|dns|net|tls)['"]\s*\)/,
    /require\(\s*['"][^'"]*(?:provider|secret|database|migration|scheduler|worker|queue|runner)[^'"]*['"]\s*\)/i,
    /process\.env/,
    /require\(\s*['"](?:\.\.\/)?pilots\//
  ]) {
    assert.equal(forbidden.test(source), false, String(forbidden));
  }
});

test('binding contracts remain exact and no execution result is exposed', () => {
  assert.deepEqual(BINDING_SECTIONS, ['configuration', 'trial', 'authorization', 'capabilities']);
  assert.ok(SECTION_FIELDS.configuration.includes('kill_switch_active'));
  const result = evaluatePublicWebCanaryOperationalTrialReadinessBinding(validInput());
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'ready_for_real_execution'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'execution_authorized'), false);
});
