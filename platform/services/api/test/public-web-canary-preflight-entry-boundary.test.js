'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const readinessModulePath = require.resolve('../src/core/public-web-canary-preflight-readiness-boundary');
const entryModulePath = require.resolve('../src/core/public-web-canary-preflight-entry-boundary');
const readinessModule = require(readinessModulePath);
const realReadinessValidator = readinessModule.validatePublicWebCanaryPreflightReadinessResult;

function loadBoundaryWithValidator(validator) {
  readinessModule.validatePublicWebCanaryPreflightReadinessResult = validator;
  delete require.cache[entryModulePath];
  const loaded = require(entryModulePath);
  readinessModule.validatePublicWebCanaryPreflightReadinessResult = realReadinessValidator;
  return loaded;
}

const validatedBoundary = loadBoundaryWithValidator(() => ({ valid: true, errors: [] }));
const liveBoundary = loadBoundaryWithValidator(realReadinessValidator);

function canonicalReady(overrides = {}) {
  const base = {
    ok: true,
    status: 'PUBLIC_WEB_CANARY_PREFLIGHT_READY',
    decision: 'ENTER_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT',
    next_state: 'WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_RUN',
    reason_codes: ['public_web_canary_preflight_ready_non_side_effect_only'],
    readiness_id: 'public_web_canary_preflight_readiness:synthetic-test-only',
    readiness_fingerprint: 'sha256:synthetic-readiness-fingerprint',
    preparation: {
      preparation_eligibility_id: 'execution_preparation_eligibility:synthetic-test-only',
      preparation_eligibility_fingerprint: 'sha256:synthetic-preparation',
      status: 'EXECUTION_PREPARATION_ELIGIBLE_SIMULATION',
      decision: 'ENTER_EXECUTION_PREPARATION_SIMULATION',
      next_state: 'WAITING_EXECUTION_PREPARATION_REFERENCE'
    },
    trial: {
      trial_id: 'public_web_trial_entry_boundary_test',
      trial_version: 1,
      plan_hash: 'sha256:synthetic-plan',
      environment: 'development',
      target_policy_id: 'target-policy-synthetic',
      target_path_hash: 'sha256:target-path',
      connector_id: 'public_web_connector',
      configuration_id: 'public_web_configuration',
      adapter_id: 'public_web_adapter',
      provider_id: 'public_web_provider',
      readiness_candidate_id: 'public_web_readiness_candidate'
    },
    identity: {
      tenant_id: 'tenant-a',
      organization_id: 'org-a',
      project_id: 'project-a',
      actor_id: 'actor-a',
      operator_id: 'operator-a',
      approver_id: 'approver-a',
      workspace_type: 'corporate',
      user_id: 'user-a'
    },
    requirements: {
      canonical_preparation_eligible: true,
      trial_plan_valid: true,
      trial_plan_bound_to_preparation: true,
      non_production_environment: true,
      single_request_limit: true,
      explicit_feature_flag_required: true,
      kill_switch_required: true,
      target_policy_required: true,
      dns_resolver_required: true,
      https_client_or_runner_required: true,
      secret_reference_represented: true,
      secret_resolution_not_performed: true,
      network_not_used: true,
      provider_not_called: true,
      runtime_not_enabled: true,
      worker_not_started: true,
      queue_not_mutated: true,
      scheduler_not_mutated: true,
      dispatch_not_executed: true,
      operational_persistence_not_written: true,
      production_effect: 'ZERO'
    },
    authority_boundary: {
      preparation_seen: true,
      preflight_readiness_evaluated: true,
      preflight_ready: true,
      preflight_authorized: true,
      dry_run_authorized: false,
      operator_confirmation_authorized: false,
      trial_execution_authorized: false,
      provider_called: false,
      external_network_used: false,
      secret_resolved: false,
      runtime_execution: false,
      worker_execution: false,
      queue_mutation: false,
      scheduler_mutation: false,
      dispatch_execution: false,
      operational_persistence: false,
      real_execution_authorized: false,
      production_effect: 'ZERO'
    },
    evidence: {
      preparation_validated: true,
      trial_plan_validated: true,
      binding_validated: true,
      security_boundary_validated: true,
      readiness_material_fingerprint: 'sha256:synthetic-readiness-material',
      secret_material_exposed: false,
      production_effect: 'ZERO'
    },
    audit: {
      event_name: 'public_web_canary_preflight_readiness_ready',
      trial_id: 'public_web_trial_entry_boundary_test',
      preparation_eligibility_id: 'execution_preparation_eligibility:synthetic-test-only',
      decision: 'ENTER_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT',
      next_state: 'WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_RUN',
      reason_codes: ['public_web_canary_preflight_ready_non_side_effect_only'],
      provider_called: false,
      external_network_used: false,
      production_effect: 'ZERO'
    },
    validator_version: readinessModule.PUBLIC_WEB_CANARY_PREFLIGHT_READINESS_VALIDATOR_VERSION
  };
  return structuredClone({ ...base, ...overrides });
}

function assertNoExecution(result) {
  assert.equal(result.authority_boundary.non_side_effect_only, true);
  assert.equal(result.authority_boundary.preflight_execution, false);
  assert.equal(result.authority_boundary.dry_run_execution, false);
  assert.equal(result.authority_boundary.operator_confirmation, false);
  assert.equal(result.authority_boundary.trial_execution, false);
  assert.equal(result.authority_boundary.provider_called, false);
  assert.equal(result.authority_boundary.external_network_used, false);
  assert.equal(result.authority_boundary.secret_resolved, false);
  assert.equal(result.authority_boundary.runtime_execution, false);
  assert.equal(result.authority_boundary.worker_execution, false);
  assert.equal(result.authority_boundary.queue_mutation, false);
  assert.equal(result.authority_boundary.scheduler_mutation, false);
  assert.equal(result.authority_boundary.dispatch_execution, false);
  assert.equal(result.authority_boundary.operational_persistence, false);
  assert.equal(result.authority_boundary.real_execution_authorized, false);
  assert.equal(result.authority_boundary.production_effect, 'ZERO');
  assert.equal(result.evidence.simulated, true);
  assert.equal(result.evidence.executed, false);
  assert.equal(result.evidence.real_provider_called, false);
  assert.equal(result.evidence.can_trigger_real_execution, false);
  assert.equal(result.evidence.production_effect, 'ZERO');
}

test('validated canonical readiness produces only a deterministic simulated preflight entry reference', () => {
  const readiness = canonicalReady();
  const first = validatedBoundary.evaluatePublicWebCanaryPreflightEntryBoundary(readiness, {});
  const replay = validatedBoundary.evaluatePublicWebCanaryPreflightEntryBoundary(readiness, {});

  assert.equal(first.ok, true);
  assert.equal(first.status, 'PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_PREPARED_SIMULATION');
  assert.equal(first.decision, 'PREPARE_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT_ENTRY');
  assert.equal(first.next_state, 'WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE');
  assert.equal(first.readiness_reference.readiness_id, readiness.readiness_id);
  assert.equal(first.readiness_reference.readiness_fingerprint, readiness.readiness_fingerprint);
  assert.equal(first.readiness_reference.status, 'PUBLIC_WEB_CANARY_PREFLIGHT_READY');
  assert.deepEqual(replay, first);
  assertNoExecution(first);
  assert.equal(
    validatedBoundary.validatePublicWebCanaryPreflightEntryBoundaryResult(first, readiness, {}).valid,
    true
  );
});

test('live boundary fails closed when readiness cannot be validated against canonical context', () => {
  const result = liveBoundary.evaluatePublicWebCanaryPreflightEntryBoundary(canonicalReady(), {});

  assert.equal(result.ok, false);
  assert.equal(result.status, 'PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_VALIDATION_FAILED');
  assert.ok(result.reason_codes.some((reason) => reason.startsWith('readiness_validation::')));
  assert.ok(result.reason_codes.includes('fail_closed'));
  assertNoExecution(result);
});

test('legacy ready boolean can never bridge canonical readiness into the entry boundary', () => {
  const readiness = canonicalReady({ ready: true });
  const result = validatedBoundary.evaluatePublicWebCanaryPreflightEntryBoundary(readiness, {});

  assert.equal(result.ok, false);
  assert.ok(result.reason_codes.includes('legacy_readiness_field_forbidden::ready'));
  assert.ok(result.reason_codes.includes('fail_closed'));
  assertNoExecution(result);
});

test('unsafe readiness authority is rejected even after canonical validation', () => {
  const readiness = canonicalReady();
  readiness.authority_boundary.provider_called = true;
  readiness.authority_boundary.external_network_used = true;
  readiness.authority_boundary.real_execution_authorized = true;
  const result = validatedBoundary.evaluatePublicWebCanaryPreflightEntryBoundary(readiness, {});

  assert.equal(result.ok, false);
  assert.ok(result.reason_codes.includes('readiness_authority_provider_called_must_be_false'));
  assert.ok(result.reason_codes.includes('readiness_authority_external_network_used_must_be_false'));
  assert.ok(result.reason_codes.includes('readiness_authority_real_execution_authorized_must_be_false'));
  assertNoExecution(result);
});

test('tampered entry result is rejected by deterministic validation', () => {
  const readiness = canonicalReady();
  const result = validatedBoundary.evaluatePublicWebCanaryPreflightEntryBoundary(readiness, {});
  const tampered = structuredClone(result);
  tampered.entry_fingerprint = 'sha256:tampered';

  const validation = validatedBoundary.validatePublicWebCanaryPreflightEntryBoundaryResult(
    tampered,
    readiness,
    {}
  );
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('preflight_entry_context_mismatch'));
});

test('entry boundary has no operational trial, provider, network, secret, queue, worker or runner dependency', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'core', 'public-web-canary-preflight-entry-boundary.js'),
    'utf8'
  );

  assert.equal(source.includes("require('./public-web-canary-preflight-readiness-boundary')"), true);
  for (const forbidden of [
    /require\(\s*['"](?:\.\.\/)?pilots\//,
    /public-web-canary-trial-preflight/,
    /public-web-canary-runner/,
    /\bfetch\s*\(/,
    /\baxios\b/,
    /require\(\s*['"]node:(?:http|https|dns|tls|net)['"]\s*\)/,
    /require\(\s*['"][^'"]*(?:provider|secret|database|migration|scheduler|worker|queue|runner)[^'"]*['"]\s*\)/i,
    /process\.env/
  ]) {
    assert.equal(forbidden.test(source), false, String(forbidden));
  }
});
