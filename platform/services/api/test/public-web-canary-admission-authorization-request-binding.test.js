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
  evaluatePublicWebCanaryAdmissionAuthorizationRequestBinding,
  validatePublicWebCanaryAdmissionAuthorizationRequestBindingResult
} = require('../src/core/public-web-canary-admission-authorization-request-binding');
const {
  buildExecutionAuthorizationScope
} = require('../src/core/execution-authorization-scope');
const {
  evaluateExecutionAuthorizationRequest
} = require('../src/core/execution-authorization-boundary');

const repoRoot = path.resolve(__dirname, '../../..');
let cachedIntentContext;

function clone(value) {
  return structuredClone(value);
}

function preparedTrial(overrides = {}) {
  return {
    ok: true,
    plan: {
      trial_id: 'public_web_trial_binding_001',
      plan_hash: 'plan_hash_binding_001',
      ...(overrides.plan || {})
    },
    preflight: {
      status: 'preflight_passed',
      evidence_hash: 'preflight_evidence_binding_001',
      executed: false,
      real_provider_called: false,
      ...(overrides.preflight || {})
    },
    dry_run: {
      status: 'dry_run_passed',
      dry_run_passed: true,
      evidence_hash: 'dry_run_evidence_binding_001',
      fake_network_called: true,
      fake_provider_calls: 1,
      real_provider_called: false,
      ...(overrides.dry_run || {})
    },
    ...overrides.root
  };
}

function buildIntentContext() {
  if (cachedIntentContext) return clone(cachedIntentContext);
  const bundle = buildGoldenQueuePlacementBundle();
  const placementOutcome = evaluateRuntimeQueuePlacementRequest(bundle.queuePlacementRequest, {});
  const envelope = buildPublicWebCanaryQueuedSimulationEnvelope({
    queuePlacementBundle: bundle,
    queuePlacementOutcome: placementOutcome
  });
  const prepared = preparedTrial();
  const handoff = evaluatePublicWebCanaryQueuedSimulationBoundary(envelope, { preparedTrial: prepared });
  const intent = evaluatePublicWebCanaryExecutionIntentSimulation(handoff, { envelope, preparedTrial: prepared });
  cachedIntentContext = {
    envelope,
    prepared,
    handoff,
    intent,
    intentValidationContext: { handoffResult: handoff, envelope, preparedTrial: prepared }
  };
  return clone(cachedIntentContext);
}

function validAdmissionContext(policyOverrides = {}) {
  const intentContext = buildIntentContext();
  const policy = buildPublicWebCanaryExecutionIntentAdmissionPolicy({
    admission_policy_id: 'public_web_canary_admission_policy_binding_001',
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
  request.authorization_request_id = overrides.authorization_request_id || 'authzreq-public-web-binding-1';
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
    scope_id: 'scope-public-web-binding-1',
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

function evaluateBinding({ admissionContext = validAdmissionContext(), authorizationRequest } = {}) {
  const request = authorizationRequest || baseAuthorizationRequest(admissionContext.admission);
  const binding = evaluatePublicWebCanaryAdmissionAuthorizationRequestBinding(
    admissionContext.admission,
    request,
    { admissionValidationContext: admissionContext.admissionValidationContext }
  );
  return { admissionContext, request, binding };
}

test('valid PR3 admitted result binds to the canonical generic authorization request simulation', () => {
  const { admissionContext, request, binding } = evaluateBinding();
  assert.equal(binding.ok, true);
  assert.equal(binding.status, 'PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_REQUEST_BOUND_SIMULATION');
  assert.equal(binding.source.admission_fingerprint, admissionContext.admission.admission_fingerprint);
  assert.equal(binding.source.intent_fingerprint, admissionContext.admission.parent.intent_fingerprint);
  assert.equal(request.causation_id, admissionContext.admission.admission_id);
  assert.equal(binding.destination.authorization_causation_id, admissionContext.admission.admission_id);
  assert.equal(binding.destination.authorization_status, 'AUTHORIZED_SIMULATION');
  assert.equal(binding.identity.tenant_id, admissionContext.admission.scope.tenant_id);
  assert.equal(binding.identity.actor_id, request.actor_context.actor_id);
  assert.equal(binding.scope.risk_classification, request.task_reference.risk_classification);
  assert.equal(binding.target.capability, admissionContext.admission.capability);
  assert.equal(binding.target.target_class, admissionContext.admission.target.target_class);
  assert.equal(binding.policy.admission_policy_fingerprint, admissionContext.policy.admission_policy_fingerprint);
  assert.equal(binding.authority_boundary.canonical_authorization_model, 'GENERIC_EXECUTION_AUTHORIZATION');
  assert.equal(validatePublicWebCanaryAdmissionAuthorizationRequestBindingResult(binding, {
    admissionResult: admissionContext.admission,
    authorizationRequest: request,
    admissionValidationContext: admissionContext.admissionValidationContext
  }).valid, true);
});

test('non-admitted and malformed PR3 admission results are rejected fail-closed', () => {
  const admissionContext = validAdmissionContext();
  const badPolicy = { ...admissionContext.policy, admission_policy_fingerprint: 'sha256:bad' };
  const rejected = evaluatePublicWebCanaryExecutionIntentAdmissionSimulation(admissionContext.intentContext.intent, badPolicy, {
    intentValidationContext: admissionContext.intentContext.intentValidationContext
  });
  const rejectedBinding = evaluatePublicWebCanaryAdmissionAuthorizationRequestBinding(
    rejected,
    baseAuthorizationRequest(admissionContext.admission),
    { admissionValidationContext: { ...admissionContext.admissionValidationContext, policyReference: badPolicy } }
  );
  assert.equal(rejectedBinding.ok, false);
  assert.ok(rejectedBinding.reason_codes.includes('admission_not_admitted'));
  assert.ok(rejectedBinding.reason_codes.includes('fail_closed'));

  const malformedBinding = evaluatePublicWebCanaryAdmissionAuthorizationRequestBinding(
    { ok: true, status: 'PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMITTED_SIMULATION' },
    baseAuthorizationRequest(admissionContext.admission),
    { admissionValidationContext: admissionContext.admissionValidationContext }
  );
  assert.equal(malformedBinding.ok, false);
  assert.ok(malformedBinding.reason_codes.includes('admission_result_invalid'));
});

test('same PR3 admission and same generic request produce deterministic identical binding', () => {
  const admissionContext = validAdmissionContext();
  const request = baseAuthorizationRequest(admissionContext.admission);
  const first = evaluatePublicWebCanaryAdmissionAuthorizationRequestBinding(admissionContext.admission, request, {
    admissionValidationContext: admissionContext.admissionValidationContext
  });
  const second = evaluatePublicWebCanaryAdmissionAuthorizationRequestBinding(clone(admissionContext.admission), clone(request), {
    admissionValidationContext: admissionContext.admissionValidationContext
  });
  assert.deepEqual(first, second);
  assert.equal(first.binding_id, second.binding_id);
  assert.equal(first.binding_fingerprint, second.binding_fingerprint);
});

test('generic authorization request must be caused by the exact PR3 admission', () => {
  const admissionContext = validAdmissionContext();
  const wrongCausationRequest = baseAuthorizationRequest(admissionContext.admission, {
    mutate(request) {
      request.causation_id = 'public_web_canary_execution_intent_admission:sha256:other';
    }
  });
  const wrongCausationBinding = evaluatePublicWebCanaryAdmissionAuthorizationRequestBinding(
    admissionContext.admission,
    wrongCausationRequest,
    { admissionValidationContext: admissionContext.admissionValidationContext }
  );
  assert.equal(wrongCausationBinding.ok, false);
  assert.ok(wrongCausationBinding.reason_codes.includes('authorization_request_causation_mismatch'));

  const missingCausationRequest = baseAuthorizationRequest(admissionContext.admission, {
    mutate(request) {
      request.causation_id = '';
    }
  });
  const missingCausationBinding = evaluatePublicWebCanaryAdmissionAuthorizationRequestBinding(
    admissionContext.admission,
    missingCausationRequest,
    { admissionValidationContext: admissionContext.admissionValidationContext }
  );
  assert.equal(missingCausationBinding.ok, false);
  assert.ok(missingCausationBinding.reason_codes.includes('authorization_request_invalid'));
});

test('request bound to another PR3 admission cannot be replayed as this admission continuation', () => {
  const firstAdmissionContext = validAdmissionContext();
  const secondAdmissionContext = validAdmissionContext({
    admission_policy_id: 'public_web_canary_admission_policy_binding_002'
  });
  assert.notEqual(firstAdmissionContext.admission.admission_id, secondAdmissionContext.admission.admission_id);

  const requestForFirstAdmission = baseAuthorizationRequest(firstAdmissionContext.admission);
  const replayedBinding = evaluatePublicWebCanaryAdmissionAuthorizationRequestBinding(
    secondAdmissionContext.admission,
    requestForFirstAdmission,
    { admissionValidationContext: secondAdmissionContext.admissionValidationContext }
  );
  assert.equal(replayedBinding.ok, false);
  assert.ok(replayedBinding.reason_codes.includes('authorization_request_causation_mismatch'));
});

test('mutated intent, admission fingerprint, target, or policy reference rejects by canonical PR3 validation', () => {
  const admissionContext = validAdmissionContext();
  const request = baseAuthorizationRequest(admissionContext.admission);
  for (const [name, mutate] of [
    ['intent', (admission) => { admission.source = undefined; admission.parent.intent_fingerprint = 'sha256:mutated'; }],
    ['admission', (admission) => { admission.admission_fingerprint = 'sha256:mutated'; }],
    ['target', (admission) => { admission.target.target_class = 'OTHER_TARGET'; }],
    ['policy', (admission) => { admission.policy.admission_policy_fingerprint = 'sha256:mutated'; }]
  ]) {
    const candidate = clone(admissionContext.admission);
    mutate(candidate);
    const binding = evaluatePublicWebCanaryAdmissionAuthorizationRequestBinding(candidate, request, {
      admissionValidationContext: admissionContext.admissionValidationContext
    });
    assert.equal(binding.ok, false, name);
    assert.ok(binding.reason_codes.includes('admission_result_invalid'), name);
  }
});

test('wrong tenant and wrong actor/requester are blocked by canonical generic authorization checks', () => {
  const admissionContext = validAdmissionContext();
  const tenantRequest = baseAuthorizationRequest(admissionContext.admission, {
    mutate(request) {
      request.orchestrator_decision_reference.tenant_id = 'tenant-other';
    }
  });
  const tenantBinding = evaluatePublicWebCanaryAdmissionAuthorizationRequestBinding(admissionContext.admission, tenantRequest, {
    admissionValidationContext: admissionContext.admissionValidationContext
  });
  assert.equal(tenantBinding.ok, false);
  assert.ok(tenantBinding.reason_codes.includes('authorization_request_not_authorized_simulation'));
  assert.ok(tenantBinding.reason_codes.includes('tenant_mismatch'));

  const actorRequest = baseAuthorizationRequest(admissionContext.admission, {
    mutate(request) {
      request.actor_context.actor_id = 'actor-other';
    }
  });
  const actorBinding = evaluatePublicWebCanaryAdmissionAuthorizationRequestBinding(admissionContext.admission, actorRequest, {
    admissionValidationContext: admissionContext.admissionValidationContext
  });
  assert.equal(actorBinding.ok, false);
  assert.ok(actorBinding.reason_codes.includes('authorization_request_not_authorized_simulation'));
});

test('widened risk and widened scope/capability are blocked by public-web minimization', () => {
  const admissionContext = validAdmissionContext();
  const riskRequest = baseAuthorizationRequest(admissionContext.admission, {
    mutate(request) {
      request.authorization_scope = {
        ...request.authorization_scope,
        allowed_risk_classifications: ['HIGH', 'LOW'],
        scope_fingerprint: 'intentionally-stale'
      };
    }
  });
  const riskBinding = evaluatePublicWebCanaryAdmissionAuthorizationRequestBinding(admissionContext.admission, riskRequest, {
    admissionValidationContext: admissionContext.admissionValidationContext
  });
  assert.equal(riskBinding.ok, false);
  assert.ok(riskBinding.reason_codes.includes('authorization_scope_not_minimized_risk'));

  const scopeRequest = baseAuthorizationRequest(admissionContext.admission, {
    mutate(request) {
      request.authorization_scope = buildExecutionAuthorizationScope({
        ...request.authorization_scope,
        allowed_actor_roles: ['ADMIN', 'MANAGER'],
        allowed_risk_classifications: [request.task_reference.risk_classification]
      });
    }
  });
  const scopeBinding = evaluatePublicWebCanaryAdmissionAuthorizationRequestBinding(admissionContext.admission, scopeRequest, {
    admissionValidationContext: admissionContext.admissionValidationContext
  });
  assert.equal(scopeBinding.ok, false);
  assert.ok(scopeBinding.reason_codes.includes('authorization_scope_not_minimized_role'));
});

test('replay cannot silently widen authorization and duplicate request remains identical simulation binding', () => {
  const admissionContext = validAdmissionContext();
  const request = baseAuthorizationRequest(admissionContext.admission);
  const duplicate = evaluateBinding({ admissionContext, authorizationRequest: request }).binding;
  const replay = evaluateBinding({ admissionContext, authorizationRequest: clone(request) }).binding;
  assert.deepEqual(duplicate, replay);

  const widened = baseAuthorizationRequest(admissionContext.admission, {
    authorization_request_id: 'authzreq-public-web-binding-widened',
    mutate(candidate) {
      candidate.authorization_scope = buildExecutionAuthorizationScope({
        ...candidate.authorization_scope,
        allowed_actor_ids: ['actor-1', 'actor-2']
      });
    }
  });
  const widenedBinding = evaluateBinding({ admissionContext, authorizationRequest: widened }).binding;
  assert.equal(widenedBinding.ok, false);
  assert.ok(widenedBinding.reason_codes.includes('authorization_scope_not_minimized_actor'));
});

test('generic authorization result remains simulation-only and cannot execute', () => {
  const { admissionContext, request, binding } = evaluateBinding();
  const outcome = evaluateExecutionAuthorizationRequest(request);
  assert.equal(outcome.decision.status, 'AUTHORIZED_SIMULATION');
  assert.equal(outcome.decision.authorized_in_simulation, true);
  for (const field of [
    'execution_authorized',
    'execution_started',
    'provider_called',
    'network_used',
    'runtime_enabled',
    'executed'
  ]) {
    assert.equal(outcome.decision[field], false, field);
  }
  assert.equal(binding.authority_boundary.execution_authorized, false);
  assert.equal(binding.authority_boundary.real_execution_authorized, false);
  assert.equal(binding.source.admission_fingerprint, admissionContext.admission.admission_fingerprint);
});

test('adapter has no provider/network/secret/runtime/queue/scheduler/dispatch dependency and does not import legacy public-web authorization', () => {
  const source = fs.readFileSync(
    path.join(repoRoot, 'services/api/src/core/public-web-canary-admission-authorization-request-binding.js'),
    'utf8'
  );
  assert.equal(source.includes('public-web-canary-trial-execution-authorization'), false);
  assert.equal(source.includes('createPublicWebCanaryTrialExecutionAuthorization'), false);
  assert.equal(/require\(['"]node:(http|https|net|tls|dns|dgram|fs|child_process|worker_threads|vm)['"]\)/.test(source), false);
  assert.equal(source.includes('fetch('), false);
  assert.equal(source.includes('process.env'), false);
  assert.equal(source.includes('Date.now()'), false);
  assert.equal(/\bnew Date\(/.test(source), false);
  assert.equal(source.includes('Math.random'), false);
  assert.equal(source.includes('provider_called = true'), false);
  assert.equal(source.includes('network_used = true'), false);
  assert.equal(source.includes('secret_resolved = true'), false);
});
