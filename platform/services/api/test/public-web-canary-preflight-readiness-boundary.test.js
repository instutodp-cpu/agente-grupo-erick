'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildTrialPlanFromConfig
} = require('../src/pilots/public-web-canary-trial-config-loader');
const {
  hashTrialPlan
} = require('../src/core/public-web-canary-trial-contract');
const {
  evaluatePublicWebCanaryPreflightReadiness,
  validatePublicWebCanaryPreflightReadinessResult
} = require('../src/core/public-web-canary-preflight-readiness-boundary');

const repoRoot = path.resolve(__dirname, '../../..');

function validTrialConfig(overrides = {}) {
  return {
    trial_id: 'public_web_trial_preflight_readiness_001',
    environment: 'development',
    target_policy_id: 'target_policy_public_canary',
    target_origin: 'https://public-canary.test',
    target_path: '/allowed/page',
    source_type: 'public_product_page',
    operation: 'fetch_public_page_summary',
    requested_content_types: ['text/html'],
    maximum_requests: 1,
    rollout_percentage: 1,
    timeout_ms: 3000,
    maximum_response_bytes: 100000,
    workspace_type: 'corporate',
    tenant_id: 'grupo_erick',
    user_id: 'user_public_web_synthetic',
    operator_id: 'operator_public_web',
    operator_role: 'integration_operator',
    approver_id: 'security_approver',
    approver_role: 'security_operator',
    reason: 'non-side-effect public web preflight readiness',
    ...overrides
  };
}

function validTrialPlan(overrides = {}) {
  const built = buildTrialPlanFromConfig(validTrialConfig(overrides), {
    now: '2026-01-01T00:00:00.000Z'
  });
  assert.equal(built.ok, true, built.blocked_reason);
  return built.plan;
}

function validPreparationEligibility(plan, overrides = {}) {
  const result = {
    ok: true,
    status: 'EXECUTION_PREPARATION_ELIGIBLE_SIMULATION',
    decision: 'ENTER_EXECUTION_PREPARATION_SIMULATION',
    next_state: 'WAITING_EXECUTION_PREPARATION_REFERENCE',
    preparation_eligibility_id: 'execution_preparation_eligibility:public_web_preflight_readiness',
    preparation_eligibility_fingerprint: 'sha256:preparation-readiness',
    binding: {
      source: {
        trial_id: plan.trial_id,
        plan_hash: plan.plan_hash
      }
    },
    identity: {
      tenant_id: plan.tenant_id,
      organization_id: 'org_grupo_erick',
      project_id: 'project_public_web_canary',
      actor_id: plan.operator_id
    },
    authority_boundary: {
      execution_authorized: false,
      provider_authorized: false,
      provider_called: false,
      secret_resolution_authorized: false,
      secret_resolved: false,
      network_authorized: false,
      network_used: false,
      runtime_authorized: false,
      runtime_enabled: false,
      worker_authorized: false,
      worker_started: false,
      queue_mutation_authorized: false,
      queue_mutated: false,
      scheduler_mutation_authorized: false,
      scheduler_mutated: false,
      dispatch_authorized: false,
      dispatch_executed: false,
      operational_persistence_authorized: false,
      persistence_written: false,
      real_execution_authorized: false,
      production_effect: 'ZERO'
    },
    ...overrides
  };
  return result;
}

function evaluateReady(plan = validTrialPlan(), preparation = null) {
  const prep = preparation || validPreparationEligibility(plan);
  return {
    plan,
    preparation: prep,
    result: evaluatePublicWebCanaryPreflightReadiness(prep, plan)
  };
}

function assertNoExecutionAuthority(result) {
  assert.equal(result.authority_boundary.dry_run_authorized, false);
  assert.equal(result.authority_boundary.operator_confirmation_authorized, false);
  assert.equal(result.authority_boundary.trial_execution_authorized, false);
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
  assert.equal(result.evidence.secret_material_exposed, false);
}

test('valid preparation eligibility and trial plan can enter non-side-effect preflight readiness', () => {
  const { plan, preparation, result } = evaluateReady();
  assert.equal(result.ok, true);
  assert.equal(result.status, 'PUBLIC_WEB_CANARY_PREFLIGHT_READY');
  assert.equal(result.decision, 'ENTER_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT');
  assert.equal(result.next_state, 'WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_RUN');
  assert.deepEqual(result.reason_codes, ['public_web_canary_preflight_ready_non_side_effect_only']);
  assert.equal(result.trial.trial_id, plan.trial_id);
  assert.equal(result.trial.plan_hash, plan.plan_hash);
  assert.equal(result.preparation.preparation_eligibility_id, preparation.preparation_eligibility_id);
  assert.equal(result.requirements.secret_resolution_not_performed, true);
  assertNoExecutionAuthority(result);
  assert.equal(validatePublicWebCanaryPreflightReadinessResult(result, {
    preparationEligibilityResult: preparation,
    trialPlan: plan
  }).valid, true);
});

test('missing or invalid readiness prerequisites fail closed before preflight execution', () => {
  const plan = validTrialPlan();
  const invalid = {
    ...plan,
    maximum_requests: 2
  };
  invalid.plan_hash = hashTrialPlan(invalid);
  const result = evaluatePublicWebCanaryPreflightReadiness(validPreparationEligibility(plan), invalid);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'PUBLIC_WEB_CANARY_PREFLIGHT_VALIDATION_FAILED');
  assert.ok(result.reason_codes.includes('maximum_requests_must_be_one'));
  assert.ok(result.reason_codes.includes('fail_closed'));
  assertNoExecutionAuthority(result);
});

test('invalid preparation identity and mismatched trial evidence fail closed', () => {
  const plan = validTrialPlan();
  const mismatchedPlan = validTrialPlan({ trial_id: 'public_web_trial_preflight_readiness_002' });
  const result = evaluatePublicWebCanaryPreflightReadiness(validPreparationEligibility(plan), mismatchedPlan);
  assert.equal(result.ok, false);
  assert.ok(result.reason_codes.includes('trial_id_binding_mismatch'));
  assert.ok(result.reason_codes.includes('plan_hash_binding_mismatch'));
  assert.ok(result.reason_codes.includes('fail_closed'));

  const tenantMismatch = evaluatePublicWebCanaryPreflightReadiness(
    validPreparationEligibility(plan, { identity: { tenant_id: 'other_tenant' } }),
    plan
  );
  assert.equal(tenantMismatch.ok, false);
  assert.ok(tenantMismatch.reason_codes.includes('tenant_binding_mismatch'));
});

test('stale, rejected, or authority-escalated preparation evidence is blocked', () => {
  const plan = validTrialPlan();
  const blocked = evaluatePublicWebCanaryPreflightReadiness(validPreparationEligibility(plan, {
    ok: false,
    status: 'EXECUTION_PREPARATION_BLOCKED',
    decision: 'BLOCKED'
  }), plan);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.reason_codes.includes('preparation_not_eligible'));
  assert.ok(blocked.reason_codes.includes('preparation_status_not_eligible'));

  const escalated = validPreparationEligibility(plan);
  escalated.authority_boundary.provider_called = true;
  escalated.authority_boundary.network_used = true;
  const result = evaluatePublicWebCanaryPreflightReadiness(escalated, plan);
  assert.equal(result.ok, false);
  assert.ok(result.reason_codes.includes('preparation_provider_called_must_be_false'));
  assert.ok(result.reason_codes.includes('preparation_network_used_must_be_false'));
  assertNoExecutionAuthority(result);
});

test('evaluation is deterministic and security-relevant mutation changes fingerprint or blocks', () => {
  const plan = validTrialPlan();
  const preparation = validPreparationEligibility(plan);
  const first = evaluatePublicWebCanaryPreflightReadiness(preparation, plan);
  const replay = evaluatePublicWebCanaryPreflightReadiness(preparation, plan);
  assert.deepEqual(replay, first);

  const changed = validTrialPlan({ target_path: '/allowed/other-page' });
  const changedResult = evaluatePublicWebCanaryPreflightReadiness(preparation, changed);
  assert.equal(changedResult.ok, false);
  assert.notEqual(changedResult.readiness_fingerprint, first.readiness_fingerprint);
});

test('boundary does not call provider, network, runtime, worker, queue, scheduler, dispatch or persistence hooks', () => {
  const plan = validTrialPlan();
  const preparation = validPreparationEligibility(plan);
  const calls = {
    provider: 0,
    network: 0,
    runtime: 0,
    worker: 0,
    queue: 0,
    scheduler: 0,
    dispatch: 0,
    persistence: 0
  };
  const context = {
    provider: { call() { calls.provider += 1; } },
    network: { request() { calls.network += 1; } },
    runtime: { execute() { calls.runtime += 1; } },
    worker: { start() { calls.worker += 1; } },
    queue: { mutate() { calls.queue += 1; } },
    scheduler: { mutate() { calls.scheduler += 1; } },
    dispatch: { execute() { calls.dispatch += 1; } },
    persistence: { write() { calls.persistence += 1; } }
  };
  const result = evaluatePublicWebCanaryPreflightReadiness(preparation, plan, context);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, {
    provider: 0,
    network: 0,
    runtime: 0,
    worker: 0,
    queue: 0,
    scheduler: 0,
    dispatch: 0,
    persistence: 0
  });
  assertNoExecutionAuthority(result);
});

test('implementation imports no runner, provider client, network client, queue, scheduler, dispatch or persistence modules', () => {
  const source = fs.readFileSync(
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'public-web-canary-preflight-readiness-boundary.js'),
    'utf8'
  );
  for (const forbidden of [
    'public-web-canary-runner',
    'public-web-node-https-client',
    'public-web-safe-dns-resolver',
    'runtime-',
    'worker',
    'queue-',
    'scheduler',
    'dispatch',
    'registry'
  ]) {
    assert.equal(source.includes(`require('./${forbidden}`) || source.includes(`require('../${forbidden}`), false);
  }
});
