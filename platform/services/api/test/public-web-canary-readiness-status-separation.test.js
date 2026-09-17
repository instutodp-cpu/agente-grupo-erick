'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  PUBLIC_WEB_CANARY_PREFLIGHT_READINESS_STATUSES,
  evaluatePublicWebCanaryPreflightReadiness
} = require('../src/core/public-web-canary-preflight-readiness-boundary');
const {
  PUBLIC_WEB_CANARY_OPERATIONAL_TRIAL_READINESS_STATUS,
  evaluatePublicWebCanaryOperationalTrialReadiness
} = require('../src/core/public-web-canary-operational-trial-readiness-boundary');
const {
  evaluatePublicWebCanaryOperationalTrialReadinessBinding
} = require('../src/core/public-web-canary-operational-trial-readiness-binding');

function validOperationalTrialReadinessInput(overrides = {}) {
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

function validBindingInput(overrides = {}) {
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

function assertNoRealAuthorization(result) {
  if (Object.prototype.hasOwnProperty.call(result, 'ready_for_real_execution')) {
    assert.equal(result.ready_for_real_execution, false);
  }
  if (Object.prototype.hasOwnProperty.call(result, 'can_trigger_real_execution')) {
    assert.equal(result.can_trigger_real_execution, false);
  }
  if (Object.prototype.hasOwnProperty.call(result, 'pr_c_authorized')) {
    assert.equal(result.pr_c_authorized, false);
  }

  for (const candidate of [result, result.evidence]) {
    if (!candidate || typeof candidate !== 'object') continue;
    for (const field of [
      'real_execution_authorized',
      'execution_authorized',
      'provider_called',
      'real_provider_called',
      'external_network_used',
      'real_network_present',
      'secret_resolved',
      'real_secret_resolution_present',
      'database_write_present',
      'migration_present',
      'queue_mutation',
      'worker_execution',
      'scheduler_mutation',
      'operational_runner_reachable',
      'runner_real_present'
    ]) {
      if (Object.prototype.hasOwnProperty.call(candidate, field)) assert.equal(candidate[field], false, field);
    }
    if (Object.prototype.hasOwnProperty.call(candidate, 'production_effect')) {
      assert.equal(candidate.production_effect, 'ZERO');
    }
  }
}

test('Operational Trial review status is distinct from canonical preflight readiness', () => {
  assert.equal(typeof evaluatePublicWebCanaryPreflightReadiness, 'function');
  assert.ok(PUBLIC_WEB_CANARY_PREFLIGHT_READINESS_STATUSES.includes('PUBLIC_WEB_CANARY_PREFLIGHT_READY'));
  assert.equal(
    PUBLIC_WEB_CANARY_PREFLIGHT_READINESS_STATUSES.includes(
      PUBLIC_WEB_CANARY_OPERATIONAL_TRIAL_READINESS_STATUS.READY_FOR_REVIEW
    ),
    false
  );

  const result = evaluatePublicWebCanaryOperationalTrialReadiness(validOperationalTrialReadinessInput());
  assert.equal(result.status, PUBLIC_WEB_CANARY_OPERATIONAL_TRIAL_READINESS_STATUS.READY_FOR_REVIEW);
  assert.notEqual(result.status, 'PUBLIC_WEB_CANARY_PREFLIGHT_READY');
  assertNoRealAuthorization(result);
});

test('Operational Trial binding remains review-only and never becomes preflight admission', () => {
  const result = evaluatePublicWebCanaryOperationalTrialReadinessBinding(validBindingInput());

  assert.equal(result.status, 'READY_FOR_REVIEW');
  assert.notEqual(result.status, 'PUBLIC_WEB_CANARY_PREFLIGHT_READY');
  assert.equal(result.can_continue_to_review, true);
  assertNoRealAuthorization(result);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'execution_authorized'), false);
});

test('Operational Trial readiness and canonical preflight remain separate pure layers', () => {
  const coreDirectory = path.join(__dirname, '..', 'src', 'core');
  const preflightSource = fs.readFileSync(
    path.join(coreDirectory, 'public-web-canary-preflight-readiness-boundary.js'),
    'utf8'
  );
  const operationalBoundarySource = fs.readFileSync(
    path.join(coreDirectory, 'public-web-canary-operational-trial-readiness-boundary.js'),
    'utf8'
  );
  const bindingSource = fs.readFileSync(
    path.join(coreDirectory, 'public-web-canary-operational-trial-readiness-binding.js'),
    'utf8'
  );

  assert.equal(bindingSource.includes("require('./public-web-canary-operational-trial-readiness-boundary')"), true);
  assert.equal(bindingSource.includes('public-web-canary-preflight-readiness-boundary'), false);
  assert.equal(preflightSource.includes('public-web-canary-operational-trial-readiness-boundary'), false);
  assert.equal(preflightSource.includes('public-web-canary-operational-trial-readiness-binding'), false);

  for (const source of [preflightSource, operationalBoundarySource, bindingSource]) {
    for (const forbidden of [
      /\bfetch\s*\(/,
      /\baxios\b/,
      /require\(\s*['"]node:(?:http|https|dns|tls|net)['"]\s*\)/,
      /require\(\s*['"][^'"]*(?:provider|secret|database|migration|scheduler|worker|queue|runner)[^'"]*['"]\s*\)/i,
      /process\.env/,
      /require\(\s*['"](?:\.\.\/)?pilots\//
    ]) {
      assert.equal(forbidden.test(source), false, String(forbidden));
    }
  }
});

test('review readiness rejects PR-C and every real capability without invoking an operational path', () => {
  const trialResult = evaluatePublicWebCanaryOperationalTrialReadiness(validOperationalTrialReadinessInput({
    pr_c_authorized: true,
    real_execution_enabled: true,
    real_network_present: true,
    real_provider_present: true,
    real_secret_resolution_present: true,
    database_write_present: true,
    scheduler_worker_queue_real_present: true,
    operational_runner_reachable: true,
    external_side_effect_present: true
  }));
  const bindingResult = evaluatePublicWebCanaryOperationalTrialReadinessBinding(validBindingInput({
    authorization: { pr_c_authorized: true, real_execution_enabled: true },
    capabilities: {
      ...validBindingInput().capabilities,
      real_network_present: true,
      real_provider_present: true,
      real_secret_resolution_present: true,
      database_write_present: true,
      scheduler_worker_queue_real_present: true,
      operational_runner_reachable: true,
      external_side_effect_present: true
    }
  }));

  assert.equal(trialResult.status, 'NOT_READY');
  assert.equal(bindingResult.status, 'NOT_READY');
  assertNoRealAuthorization(trialResult);
  assertNoRealAuthorization(bindingResult);
});
