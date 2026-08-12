'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const authorizationFixture = require('./fixtures/hermes-execution-authorization-boundary.json');
const {
  buildGoldenQueuePlacementBundle,
  evaluateRuntimeQueuePlacementRequest
} = require('./helpers/runtime-queue-placement-simulation-test-data');
const {
  buildPublicWebCanaryQueuedSimulationEnvelope
} = require('./helpers/public-web-canary-queued-handoff-test-helper');
const { computeCanonicalContentDigest } = require('../src/core/canonical-content-digest');
const {
  buildTrialPlanFromConfig
} = require('../src/pilots/public-web-canary-trial-config-loader');
const {
  hashTrialPlan
} = require('../src/core/public-web-canary-trial-contract');
const {
  evaluatePublicWebCanaryQueuedSimulationBoundary
} = require('../src/core/public-web-canary-queued-simulation-boundary');
const {
  evaluatePublicWebCanaryExecutionIntentSimulation
} = require('../src/core/public-web-canary-execution-intent-simulation-boundary');
const {
  buildPublicWebCanaryExecutionIntentAdmissionPolicy,
  evaluatePublicWebCanaryExecutionIntentAdmissionSimulation
} = require('../src/core/public-web-canary-execution-intent-admission-simulation-boundary');
const {
  evaluatePublicWebCanaryAdmissionAuthorizationRequestBinding
} = require('../src/core/public-web-canary-admission-authorization-request-binding');
const { buildExecutionAuthorizationScope } = require('../src/core/execution-authorization-scope');
const { evaluateExecutionAuthorizationRequest } = require('../src/core/execution-authorization-boundary');
const {
  buildExecutionPreparationRequirements,
  evaluateExecutionPreparationRequirements
} = require('../src/core/execution-preparation-requirement-boundary');
const {
  evaluatePublicWebCanaryPreflightReadiness,
  validatePublicWebCanaryPreflightReadinessResult
} = require('../src/core/public-web-canary-preflight-readiness-boundary');

const repoRoot = path.resolve(__dirname, '../../..');
let cachedCanonicalBundle;

function clone(value) {
  return structuredClone(value);
}

function digest(value) {
  return computeCanonicalContentDigest(value);
}

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

function preparedTrial(plan, overrides = {}) {
  return {
    ok: true,
    plan: {
      trial_id: plan.trial_id,
      plan_hash: plan.plan_hash,
      ...(overrides.plan || {})
    },
    preflight: {
      status: 'preflight_passed',
      evidence_hash: 'preflight_evidence_preparation_001',
      executed: false,
      real_provider_called: false,
      ...(overrides.preflight || {})
    },
    dry_run: {
      status: 'dry_run_passed',
      dry_run_passed: true,
      evidence_hash: 'dry_run_evidence_preparation_001',
      fake_network_called: true,
      fake_provider_calls: 1,
      real_provider_called: false,
      ...(overrides.dry_run || {})
    },
    ...overrides.root
  };
}

function buildIntentContext(plan) {
  const bundle = buildGoldenQueuePlacementBundle();
  const placementOutcome = evaluateRuntimeQueuePlacementRequest(bundle.queuePlacementRequest, {});
  const envelope = buildPublicWebCanaryQueuedSimulationEnvelope({
    queuePlacementBundle: bundle,
    queuePlacementOutcome: placementOutcome
  });
  const prepared = preparedTrial(plan);
  const handoff = evaluatePublicWebCanaryQueuedSimulationBoundary(envelope, { preparedTrial: prepared });
  const intent = evaluatePublicWebCanaryExecutionIntentSimulation(handoff, { envelope, preparedTrial: prepared });
  return {
    envelope,
    prepared,
    handoff,
    intent,
    intentValidationContext: { handoffResult: handoff, envelope, preparedTrial: prepared }
  };
}

function validAdmissionContext(plan, policyOverrides = {}) {
  const intentContext = buildIntentContext(plan);
  const policy = buildPublicWebCanaryExecutionIntentAdmissionPolicy({
    admission_policy_id: policyOverrides.admission_policy_id || `public_web_canary_admission_policy_${plan.trial_id}`,
    ...policyOverrides
  });
  const admission = evaluatePublicWebCanaryExecutionIntentAdmissionSimulation(intentContext.intent, policy, {
    intentValidationContext: intentContext.intentValidationContext
  });
  return {
    intentContext,
    policy,
    admission,
    admissionValidationContext: {
      intentResult: intentContext.intent,
      policyReference: policy,
      intentValidationContext: intentContext.intentValidationContext
    }
  };
}

function baseAuthorizationRequest(admission, overrides = {}) {
  const request = clone(authorizationFixture.scenarios['authorized-no-llm-simulation'].request);
  request.authorization_request_id = overrides.authorization_request_id || `authzreq-${admission.identity.request_id}`;
  request.correlation_id = admission.identity.correlation_id;
  request.trace_id = admission.identity.trace_id;
  request.causation_id = admission.admission_id;
  request.orchestrator_decision_reference.tenant_id = admission.scope.tenant_id;
  request.orchestrator_decision_reference.organization_id = admission.scope.organization_id;
  request.orchestrator_decision_reference.project_id = admission.scope.project_id;
  request.readiness_evidence_bundle_reference.tenant_id = admission.scope.tenant_id;
  request.readiness_evidence_bundle_reference.organization_id = admission.scope.organization_id;
  request.readiness_evidence_bundle_reference.project_id = admission.scope.project_id;
  request.planning_result_reference.tenant_id = admission.scope.tenant_id;
  request.planning_result_reference.organization_id = admission.scope.organization_id;
  request.planning_result_reference.project_id = admission.scope.project_id;
  request.orchestration_plan_reference.tenant_id = admission.scope.tenant_id;
  request.orchestration_plan_reference.organization_id = admission.scope.organization_id;
  request.orchestration_plan_reference.project_id = admission.scope.project_id;
  request.task_reference.tenant_id = admission.scope.tenant_id;
  request.task_reference.organization_id = admission.scope.organization_id;
  request.task_reference.project_id = admission.scope.project_id;
  request.actor_context.tenant_id = admission.scope.tenant_id;
  request.actor_context.organization_id = admission.scope.organization_id;
  request.actor_context.project_id = admission.scope.project_id;
  request.approval_reference.tenant_id = admission.scope.tenant_id;
  request.approval_reference.organization_id = admission.scope.organization_id;
  request.approval_reference.project_id = admission.scope.project_id;
  request.budget_authorization_reference.tenant_id = admission.scope.tenant_id;
  request.budget_authorization_reference.organization_id = admission.scope.organization_id;
  request.budget_authorization_reference.project_id = admission.scope.project_id;
  request.authorization_scope = buildExecutionAuthorizationScope({
    scope_id: `scope-${admission.identity.request_id}`,
    tenant_id: admission.scope.tenant_id,
    organization_id: admission.scope.organization_id,
    allowed_agent_ids: [request.orchestrator_decision_reference.agent_id],
    allowed_project_ids: [admission.scope.project_id],
    allowed_session_reference_ids: [request.orchestrator_decision_reference.session_reference_id],
    allowed_plan_ids: [request.orchestrator_decision_reference.plan_id],
    allowed_actor_ids: [request.actor_context.actor_id],
    allowed_actor_roles: [request.actor_context.actor_role],
    allowed_task_types: [request.task_reference.task_type],
    allowed_risk_classifications: [request.task_reference.risk_classification],
    allowed_tool_reference_ids: [],
    allowed_workflow_reference_ids: [],
    maximum_authorized_cost_minor_units: 1000,
    maximum_authorized_tokens: 10000
  });
  if (typeof overrides.mutate === 'function') overrides.mutate(request);
  return request;
}

function canonicalChain(plan, overrides = {}) {
  const admissionContext = validAdmissionContext(plan, overrides.policyOverrides || {});
  const request = overrides.authorizationRequest || baseAuthorizationRequest(admissionContext.admission, overrides.requestOverrides || {});
  const decision = evaluateExecutionAuthorizationRequest(request).decision;
  const binding = evaluatePublicWebCanaryAdmissionAuthorizationRequestBinding(
    admissionContext.admission,
    request,
    { admissionValidationContext: admissionContext.admissionValidationContext }
  );
  return {
    admissionContext,
    request,
    decision,
    binding,
    bindingValidationContext: {
      admissionResult: admissionContext.admission,
      authorizationRequest: request,
      admissionValidationContext: admissionContext.admissionValidationContext
    }
  };
}

function validRequirements(chain, overrides = {}) {
  const { request, decision, binding } = chain;
  const base = {
    preparation_requirements_id: `execution-preparation-requirements-${binding.source.trial_id}`,
    preparation_requirements_version: 1,
    authorization_request_id: request.authorization_request_id,
    authorization_request_fingerprint: digest(request),
    authorization_decision_id: decision.authorization_decision_id,
    authorization_decision_fingerprint: digest(decision),
    admission_authorization_binding_id: binding.binding_id,
    admission_authorization_binding_fingerprint: binding.binding_fingerprint,
    tenant_id: decision.tenant_id,
    organization_id: decision.organization_id,
    project_id: decision.project_id,
    actor_id: decision.actor_id,
    task_reference_id: decision.task_reference_id,
    approval_reference_id: decision.approval_reference_id,
    target_reference: {
      required: true,
      status: 'REQUIRED_SATISFIED',
      target_class: binding.target.target_class,
      target_reference_id: 'target-reference-public-web-1',
      target_fingerprint: binding.source.intent_fingerprint
    },
    environment_reference: {
      required: true,
      status: 'REQUIRED_SATISFIED',
      environment_class: binding.target.admission_environment,
      environment_reference_id: 'environment-reference-public-web-1',
      environment_fingerprint: binding.policy.admission_policy_fingerprint,
      production: false
    },
    authorization_validity_requirement: {
      required: true,
      status: 'REQUIRED_SATISFIED',
      authorization_revoked: false,
      authorization_stale: false,
      expected_registry_version: decision.registry_version,
      observed_registry_version: decision.registry_version
    },
    provider_requirement: {
      required: true,
      status: 'REQUIRED_SATISFIED',
      provider_class: 'PUBLIC_WEB_CANARY_PROVIDER_CLASS_REFERENCE',
      provider_reference_id: 'provider-reference-public-web-1',
      provider_fingerprint: 'sha256:provider-reference-public-web-1',
      provider_called: false
    },
    network_requirement: {
      required: true,
      status: 'REQUIRED_SATISFIED',
      network_policy_reference_id: 'network-policy-public-web-1',
      destination_class: 'PUBLIC_WEB_TARGET_REFERENCE_ONLY',
      network_policy_fingerprint: 'sha256:network-policy-public-web-1',
      network_used: false
    },
    secret_requirement: {
      required: true,
      status: 'REQUIRED_SATISFIED',
      secret_policy_reference_id: 'secret-policy-public-web-1',
      secret_reference_id: 'secret-reference-public-web-1',
      secret_reference_fingerprint: 'sha256:secret-reference-public-web-1',
      secret_resolved: false,
      secret_material_exposed: false
    },
    runtime_requirement: {
      required: true,
      status: 'REQUIRED_SATISFIED',
      runtime_capability_reference_id: 'runtime-capability-public-web-1',
      runtime_capability_fingerprint: 'sha256:runtime-capability-public-web-1',
      runtime_enabled: false,
      worker_started: false,
      queue_mutated: false,
      scheduler_mutated: false,
      dispatch_executed: false
    },
    budget_requirement: {
      required: true,
      status: 'REQUIRED_SATISFIED',
      budget_authorization_id: decision.budget_authorization_id,
      budget_fingerprint: decision.budget_fingerprint,
      within_limits: true,
      budget_consumed: false
    },
    expiration_requirement: {
      required: true,
      status: 'REQUIRED_SATISFIED',
      expiration_evaluation_id: decision.expiration_evaluation_id,
      expiration_fingerprint: decision.expiration_fingerprint,
      expired_logically: false,
      clock_accessed: false
    },
    idempotency_requirement: {
      required: true,
      status: 'REQUIRED_SATISFIED',
      idempotency_key_reference: 'idempotency-reference-public-web-1',
      idempotency_fingerprint: 'sha256:idempotency-public-web-1',
      replay_allowed: true,
      duplicate_execution_blocked: true,
      idempotency_consumed: false
    },
    kill_switch_requirement: {
      required: true,
      status: 'REQUIRED_SATISFIED',
      kill_switch_reference_id: 'kill-switch-public-web-1',
      kill_switch_fingerprint: 'sha256:kill-switch-public-web-1',
      kill_switch_active: false
    },
    audit_requirement: {
      required: true,
      status: 'REQUIRED_SATISFIED',
      audit_reference_id: 'audit-public-web-1',
      audit_fingerprint: 'sha256:audit-public-web-1',
      evidence_required: true,
      persistence_written: false
    }
  };
  const merged = clone(base);
  if (typeof overrides.mutate === 'function') overrides.mutate(merged);
  return buildExecutionPreparationRequirements(merged);
}

function canonicalPreparationBundle(overrides = {}) {
  if (!overrides.planOverrides && !overrides.requirementOverrides && cachedCanonicalBundle) {
    return clone(cachedCanonicalBundle);
  }
  const plan = validTrialPlan({
    tenant_id: 'tenant-a',
    ...(overrides.planOverrides || {})
  });
  const chain = canonicalChain(plan, overrides.chainOverrides || {});
  const requirements = validRequirements(chain, overrides.requirementOverrides || {});
  const preparation = evaluateExecutionPreparationRequirements(
    chain.request,
    chain.decision,
    chain.binding,
    requirements,
    { bindingValidationContext: chain.bindingValidationContext }
  );
  const bundle = {
    plan,
    chain,
    requirements,
    preparation,
    readinessContext: {
      preparationEligibilityResult: preparation,
      trialPlan: plan,
      preparationValidationContext: {
        authorizationRequest: chain.request,
        authorizationDecision: chain.decision,
        admissionAuthorizationBinding: chain.binding,
        preparationRequirements: requirements,
        bindingValidationContext: chain.bindingValidationContext
      }
    }
  };
  if (!overrides.planOverrides && !overrides.requirementOverrides) cachedCanonicalBundle = clone(bundle);
  return bundle;
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

function evaluateReady(bundle = canonicalPreparationBundle()) {
  return {
    plan: bundle.plan,
    preparation: bundle.preparation,
    result: evaluatePublicWebCanaryPreflightReadiness(
      bundle.preparation,
      bundle.plan,
      bundle.readinessContext
    ),
    context: bundle.readinessContext
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
  const { plan, preparation, result, context } = evaluateReady();
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
    trialPlan: plan,
    preparationValidationContext: context.preparationValidationContext
  }).valid, true);
});

test('missing or invalid readiness prerequisites fail closed before preflight execution', () => {
  const bundle = canonicalPreparationBundle();
  const plan = bundle.plan;
  const invalid = {
    ...plan,
    maximum_requests: 2
  };
  invalid.plan_hash = hashTrialPlan(invalid);
  const result = evaluatePublicWebCanaryPreflightReadiness(bundle.preparation, invalid, bundle.readinessContext);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'PUBLIC_WEB_CANARY_PREFLIGHT_VALIDATION_FAILED');
  assert.ok(result.reason_codes.includes('maximum_requests_must_be_one'));
  assert.ok(result.reason_codes.includes('fail_closed'));
  assertNoExecutionAuthority(result);
});

test('invalid preparation identity and mismatched trial evidence fail closed', () => {
  const bundle = canonicalPreparationBundle();
  const plan = bundle.plan;
  const mismatchedPlan = validTrialPlan({ trial_id: 'public_web_trial_preflight_readiness_002' });
  const result = evaluatePublicWebCanaryPreflightReadiness(bundle.preparation, mismatchedPlan, bundle.readinessContext);
  assert.equal(result.ok, false);
  assert.ok(result.reason_codes.includes('trial_id_binding_mismatch'));
  assert.ok(result.reason_codes.includes('plan_hash_binding_mismatch'));
  assert.ok(result.reason_codes.includes('fail_closed'));

  const tenantPreparation = clone(bundle.preparation);
  tenantPreparation.identity.tenant_id = 'other_tenant';
  const tenantMismatch = evaluatePublicWebCanaryPreflightReadiness(tenantPreparation, plan, bundle.readinessContext);
  assert.equal(tenantMismatch.ok, false);
  assert.ok(tenantMismatch.reason_codes.includes('tenant_binding_mismatch'));
  assert.ok(tenantMismatch.reason_codes.includes('preparation_validation_context_mismatch'));
});

test('stale, rejected, or authority-escalated preparation evidence is blocked', () => {
  const bundle = canonicalPreparationBundle();
  const plan = bundle.plan;
  const rejectedPreparation = clone(bundle.preparation);
  rejectedPreparation.ok = false;
  rejectedPreparation.status = 'EXECUTION_PREPARATION_BLOCKED';
  rejectedPreparation.decision = 'BLOCKED';
  const blocked = evaluatePublicWebCanaryPreflightReadiness(rejectedPreparation, plan, bundle.readinessContext);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.reason_codes.includes('preparation_not_eligible'));
  assert.ok(blocked.reason_codes.includes('preparation_status_not_eligible'));

  const escalated = clone(bundle.preparation);
  escalated.authority_boundary.provider_called = true;
  escalated.authority_boundary.network_used = true;
  const result = evaluatePublicWebCanaryPreflightReadiness(escalated, plan, bundle.readinessContext);
  assert.equal(result.ok, false);
  assert.ok(result.reason_codes.includes('preparation_provider_called_must_be_false'));
  assert.ok(result.reason_codes.includes('preparation_network_used_must_be_false'));
  assertNoExecutionAuthority(result);
});

test('missing canonical preparation validation context or incomplete evidence never becomes ready', () => {
  const plan = validTrialPlan();
  const incomplete = validPreparationEligibility(plan);
  delete incomplete.preparation_eligibility_id;
  delete incomplete.preparation_eligibility_fingerprint;
  delete incomplete.next_state;
  delete incomplete.validator_version;
  const result = evaluatePublicWebCanaryPreflightReadiness(incomplete, plan);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'PUBLIC_WEB_CANARY_PREFLIGHT_VALIDATION_FAILED');
  assert.ok(result.reason_codes.includes('preparation_validation_context_required'));
  assert.ok(result.reason_codes.includes('preparation_preparation_eligibility_id_missing'));
  assert.ok(result.reason_codes.includes('preparation_preparation_eligibility_fingerprint_missing'));
  assert.ok(result.reason_codes.includes('preparation_next_state_missing'));
  assert.ok(result.reason_codes.includes('preparation_validator_version_missing'));
  assert.ok(result.reason_codes.includes('fail_closed'));
  assertNoExecutionAuthority(result);
});

test('stale or cross-context preparation evidence cannot be reused for another canonical context', () => {
  const first = canonicalPreparationBundle();
  const second = canonicalPreparationBundle({
    planOverrides: { trial_id: 'public_web_trial_preflight_readiness_previous_commit' }
  });
  const wrongContext = {
    ...first.readinessContext,
    preparationValidationContext: second.readinessContext.preparationValidationContext
  };
  const result = evaluatePublicWebCanaryPreflightReadiness(first.preparation, first.plan, wrongContext);
  assert.equal(result.ok, false);
  assert.ok(result.reason_codes.includes('preparation_validation_context_mismatch'));
  assert.ok(result.reason_codes.includes('fail_closed'));
  assertNoExecutionAuthority(result);
});

test('evaluation is deterministic and security-relevant mutation changes fingerprint or blocks', () => {
  const bundle = canonicalPreparationBundle();
  const first = evaluatePublicWebCanaryPreflightReadiness(
    bundle.preparation,
    bundle.plan,
    bundle.readinessContext
  );
  const replay = evaluatePublicWebCanaryPreflightReadiness(
    bundle.preparation,
    bundle.plan,
    bundle.readinessContext
  );
  assert.deepEqual(replay, first);

  const changed = validTrialPlan({ target_path: '/allowed/other-page' });
  const changedResult = evaluatePublicWebCanaryPreflightReadiness(
    bundle.preparation,
    changed,
    bundle.readinessContext
  );
  assert.equal(changedResult.ok, false);
  assert.notEqual(changedResult.readiness_fingerprint, first.readiness_fingerprint);
});

test('boundary does not call provider, network, runtime, worker, queue, scheduler, dispatch or persistence hooks', () => {
  const bundle = canonicalPreparationBundle();
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
  const result = evaluatePublicWebCanaryPreflightReadiness(bundle.preparation, bundle.plan, {
    ...context,
    preparationEligibilityResult: bundle.preparation,
    trialPlan: bundle.plan,
    preparationValidationContext: bundle.readinessContext.preparationValidationContext
  });
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
