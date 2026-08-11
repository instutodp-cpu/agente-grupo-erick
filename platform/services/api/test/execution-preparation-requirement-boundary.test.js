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
  evaluateExecutionPreparationRequirements,
  validateExecutionPreparationEligibilityResult,
  validateExecutionPreparationRequirements
} = require('../src/core/execution-preparation-requirement-boundary');

const repoRoot = path.resolve(__dirname, '../../..');
let cachedIntentContext;
let cachedAdmissionContext;
let cachedCanonicalChain;

function clone(value) {
  return structuredClone(value);
}

function digest(value) {
  return computeCanonicalContentDigest(value);
}

function preparedTrial(overrides = {}) {
  return {
    ok: true,
    plan: {
      trial_id: 'public_web_trial_preparation_001',
      plan_hash: 'plan_hash_preparation_001',
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
  if (Object.keys(policyOverrides).length === 0 && cachedAdmissionContext) return clone(cachedAdmissionContext);
  const intentContext = buildIntentContext();
  const policy = buildPublicWebCanaryExecutionIntentAdmissionPolicy({
    admission_policy_id: 'public_web_canary_admission_policy_preparation_001',
    ...policyOverrides
  });
  const admission = evaluatePublicWebCanaryExecutionIntentAdmissionSimulation(intentContext.intent, policy, {
    intentValidationContext: intentContext.intentValidationContext
  });
  const context = {
    __custom: Object.keys(policyOverrides).length > 0,
    intentContext,
    policy,
    admission,
    admissionValidationContext: {
      intentResult: intentContext.intent,
      policyReference: policy,
      intentValidationContext: intentContext.intentValidationContext
    }
  };
  if (Object.keys(policyOverrides).length === 0) cachedAdmissionContext = clone(context);
  return context;
}

function baseAuthorizationRequest(admission, overrides = {}) {
  const request = clone(authorizationFixture.scenarios['authorized-no-llm-simulation'].request);
  request.authorization_request_id = overrides.authorization_request_id || 'authzreq-public-web-preparation-1';
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
    scope_id: 'scope-public-web-preparation-1',
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

function canonicalChain({ admissionContext = validAdmissionContext(), authorizationRequest } = {}) {
  if (!authorizationRequest && !admissionContext.__custom && cachedCanonicalChain) return clone(cachedCanonicalChain);
  const request = authorizationRequest || baseAuthorizationRequest(admissionContext.admission);
  const decision = evaluateExecutionAuthorizationRequest(request).decision;
  const binding = evaluatePublicWebCanaryAdmissionAuthorizationRequestBinding(
    admissionContext.admission,
    request,
    { admissionValidationContext: admissionContext.admissionValidationContext }
  );
  const chain = {
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
  if (!authorizationRequest && !admissionContext.__custom) cachedCanonicalChain = clone(chain);
  return chain;
}

function validRequirements(chain, overrides = {}) {
  const { request, decision, binding } = chain;
  const base = {
    preparation_requirements_id: 'execution-preparation-requirements-public-web-1',
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
  const merged = typeof overrides.mutate === 'function' ? clone(base) : base;
  if (typeof overrides.mutate === 'function') overrides.mutate(merged);
  return buildExecutionPreparationRequirements(merged);
}

function evaluatePreparation(chain, requirements = validRequirements(chain)) {
  return evaluateExecutionPreparationRequirements(
    chain.request,
    chain.decision,
    chain.binding,
    requirements,
    { bindingValidationContext: chain.bindingValidationContext }
  );
}

test('valid canonical authorization and satisfied preparation requirements are eligible without execution authority', () => {
  const chain = canonicalChain();
  const requirements = validRequirements(chain);
  const result = evaluatePreparation(chain, requirements);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'EXECUTION_PREPARATION_ELIGIBLE_SIMULATION');
  assert.equal(result.decision, 'ENTER_EXECUTION_PREPARATION_SIMULATION');
  assert.equal(result.authorization.authorization_decision_id, chain.decision.authorization_decision_id);
  assert.equal(result.binding.admission_authorization_binding_fingerprint, chain.binding.binding_fingerprint);
  assert.equal(result.binding.admission_fingerprint, chain.admissionContext.admission.admission_fingerprint);
  assert.equal(result.binding.execution_intent_fingerprint, chain.admissionContext.admission.parent.intent_fingerprint);
  assert.equal(result.requirements.secret_requirement.secret_resolved, false);
  assert.equal(result.authority_boundary.preparation_eligible, true);
  assert.equal(result.authority_boundary.execution_authorized, false);
  assert.equal(result.authority_boundary.provider_called, false);
  assert.equal(result.authority_boundary.network_used, false);
  assert.equal(result.authority_boundary.secret_resolved, false);
  assert.equal(result.authority_boundary.runtime_enabled, false);
  assert.equal(result.authority_boundary.production_effect, 'ZERO');
  assert.equal(validateExecutionPreparationEligibilityResult(result, {
    authorizationRequest: chain.request,
    authorizationDecision: chain.decision,
    admissionAuthorizationBinding: chain.binding,
    preparationRequirements: requirements,
    bindingValidationContext: chain.bindingValidationContext
  }).valid, true);
});

test('rejected and malformed authorization evidence blocks preparation fail-closed', () => {
  const admissionContext = validAdmissionContext();
  const deniedChain = canonicalChain({
    admissionContext,
    authorizationRequest: baseAuthorizationRequest(admissionContext.admission, {
      mutate(request) {
        request.authorization_policy.allow_authorized_simulation = false;
      }
    })
  });
  const deniedResult = evaluatePreparation(deniedChain, validRequirements(deniedChain));
  assert.equal(deniedResult.ok, false);
  assert.ok(deniedResult.reason_codes.includes('authorization_not_accepted_simulation'));
  assert.ok(deniedResult.reason_codes.includes('fail_closed'));

  const chain = canonicalChain();
  const malformedResult = evaluateExecutionPreparationRequirements(
    chain.request,
    { malformed: true },
    chain.binding,
    validRequirements(chain),
    { bindingValidationContext: chain.bindingValidationContext }
  );
  assert.equal(malformedResult.ok, false);
  assert.ok(malformedResult.reason_codes.includes('authorization_decision_invalid'));
});

test('stale, revoked, expired, kill-switch, and budget-blocked requirements fail closed', () => {
  const cases = [
    ['stale', (req) => { req.authorization_validity_requirement.authorization_stale = true; }, 'authorization_stale'],
    ['revoked', (req) => { req.authorization_validity_requirement.authorization_revoked = true; }, 'authorization_revoked'],
    ['registry version mismatch', (req) => { req.authorization_validity_requirement.observed_registry_version = 'registry-v-other'; }, 'authorization_registry_version_mismatch'],
    ['expired', (req) => { req.expiration_requirement.expired_logically = true; }, 'authorization_expired_logically'],
    ['budget', (req) => { req.budget_requirement.within_limits = false; }, 'budget_limit_violation'],
    ['kill switch', (req) => { req.kill_switch_requirement.kill_switch_active = true; }, 'kill_switch_active']
  ];
  for (const [name, mutate, reason] of cases) {
    const chain = canonicalChain();
    const result = evaluatePreparation(chain, validRequirements(chain, { mutate }));
    assert.equal(result.ok, false, name);
    assert.ok(result.reason_codes.includes(reason), name);
    assert.ok(result.reason_codes.includes('fail_closed'), name);
  }
});

test('PR125 binding mismatch and independent generic request substitution are blocked', () => {
  const chain = canonicalChain();
  const otherAdmissionContext = validAdmissionContext({ admission_policy_id: 'public_web_canary_admission_policy_preparation_002' });
  const otherChain = canonicalChain({ admissionContext: otherAdmissionContext });
  const wrongBindingResult = evaluateExecutionPreparationRequirements(
    chain.request,
    chain.decision,
    otherChain.binding,
    validRequirements(chain),
    { bindingValidationContext: chain.bindingValidationContext }
  );
  assert.equal(wrongBindingResult.ok, false);
  assert.ok(wrongBindingResult.reason_codes.includes('admission_authorization_binding_fingerprint_mismatch'));

  const independentRequest = clone(authorizationFixture.scenarios['authorized-no-llm-simulation'].request);
  const independentDecision = evaluateExecutionAuthorizationRequest(independentRequest).decision;
  const independentResult = evaluateExecutionPreparationRequirements(
    independentRequest,
    independentDecision,
    chain.binding,
    validRequirements(chain),
    { bindingValidationContext: chain.bindingValidationContext }
  );
  assert.equal(independentResult.ok, false);
  assert.ok(independentResult.reason_codes.includes('authorization_request_id_mismatch'));
});

test('actor, tenant, task, approval, target, environment, and policy/reference substitutions are blocked', () => {
  const cases = [
    ['actor', (req) => { req.actor_id = 'actor-other'; }, 'actor_mismatch'],
    ['tenant', (req) => { req.tenant_id = 'tenant-other'; }, 'tenant_mismatch'],
    ['task', (req) => { req.task_reference_id = 'taskref-other'; }, 'task_reference_mismatch'],
    ['approval', (req) => { req.approval_reference_id = 'approval-other'; }, 'approval_reference_mismatch'],
    ['target', (req) => { req.target_reference.target_class = 'OTHER_TARGET'; }, 'target_class_mismatch'],
    ['environment', (req) => { req.environment_reference.environment_class = 'PRODUCTION_LIKE'; }, 'environment_mismatch'],
    ['policy/reference', (req) => { req.admission_authorization_binding_fingerprint = 'sha256:wrong-binding-fingerprint'; }, 'admission_authorization_binding_fingerprint_mismatch']
  ];
  for (const [name, mutate, reason] of cases) {
    const chain = canonicalChain();
    const requirements = reason === 'execution_preparation_requirements_invalid'
      ? (() => {
        const raw = clone(validRequirements(chain));
        mutate(raw);
        return raw;
      })()
      : validRequirements(chain, { mutate });
    const result = evaluatePreparation(chain, requirements);
    assert.equal(result.ok, false, name);
    assert.ok(result.reason_codes.includes(reason), name);
  }
});

test('provider, network, runtime, and unknown security-critical requirements fail closed when missing or malformed', () => {
  const cases = [
    ['provider missing', (req) => { req.provider_requirement.status = 'REQUIRED_UNSATISFIED'; }, 'provider_requirement_unsatisfied'],
    ['network missing', (req) => { req.network_requirement.status = 'REQUIRED_UNSATISFIED'; }, 'network_requirement_unsatisfied'],
    ['runtime missing', (req) => { req.runtime_requirement.status = 'REQUIRED_UNSATISFIED'; }, 'runtime_requirement_unsatisfied'],
    ['unknown status', (req) => { req.network_requirement.status = 'UNKNOWN_SECURITY_REQUIREMENT'; }, 'execution_preparation_requirements_invalid']
  ];
  for (const [name, mutate, reason] of cases) {
    const chain = canonicalChain();
    const requirements = reason === 'execution_preparation_requirements_invalid'
      ? (() => {
        const raw = clone(validRequirements(chain));
        mutate(raw);
        return raw;
      })()
      : validRequirements(chain, { mutate });
    const result = evaluatePreparation(chain, requirements);
    assert.equal(result.ok, false, name);
    assert.ok(result.reason_codes.includes(reason), name);
  }

  const chain = canonicalChain();
  const raw = clone(validRequirements(chain));
  raw.provider_requirement = undefined;
  assert.equal(validateExecutionPreparationRequirements(raw).valid, false);
});

test('secret requirement can be represented as satisfied without resolving or exposing secret material', () => {
  const chain = canonicalChain();
  const requirements = validRequirements(chain, {
    mutate(req) {
      req.secret_requirement.required = true;
      req.secret_requirement.status = 'REQUIRED_SATISFIED';
      req.secret_requirement.secret_resolved = false;
      req.secret_requirement.secret_material_exposed = false;
    }
  });
  const result = evaluatePreparation(chain, requirements);
  assert.equal(result.ok, true);
  assert.equal(result.requirements.secret_requirement.secret_resolved, false);
  assert.equal(result.authority_boundary.secret_resolved, false);
  assert.equal(result.authority_boundary.secret_material_exposed, false);

  const withSecretValue = clone(requirements);
  withSecretValue.secret_requirement.secret_value = 'do-not-accept';
  assert.equal(validateExecutionPreparationRequirements(withSecretValue).valid, false);
});

test('same material replays deterministically and security-relevant mutation changes identity or blocks', () => {
  const chain = canonicalChain();
  const requirements = validRequirements(chain);
  const first = evaluatePreparation(chain, requirements);
  const second = evaluatePreparation(chain, clone(requirements));
  assert.deepEqual(first, second);
  assert.equal(first.preparation_eligibility_fingerprint, second.preparation_eligibility_fingerprint);

  const mutated = validRequirements(chain, {
    mutate(req) {
      req.target_reference.target_reference_id = 'target-reference-public-web-mutated';
    }
  });
  const mutatedResult = evaluatePreparation(chain, mutated);
  assert.equal(mutatedResult.ok, true);
  assert.notEqual(mutatedResult.preparation_eligibility_fingerprint, first.preparation_eligibility_fingerprint);

  const staleReplay = evaluatePreparation(chain, validRequirements(chain, {
    mutate(req) {
      req.idempotency_requirement.duplicate_execution_blocked = false;
    }
  }));
  assert.equal(staleReplay.ok, false);
  assert.ok(staleReplay.reason_codes.includes('duplicate_execution_not_blocked'));
});

test('missing causation material and mutated authorization fingerprints fail closed', () => {
  const cases = [
    ['missing binding id', (req) => { req.admission_authorization_binding_id = ''; }, 'execution_preparation_requirements_invalid'],
    ['mutated authorization request fingerprint', (req) => { req.authorization_request_fingerprint = 'sha256:wrong-request'; }, 'authorization_request_fingerprint_mismatch'],
    ['mutated authorization decision fingerprint', (req) => { req.authorization_decision_fingerprint = 'sha256:wrong-decision'; }, 'authorization_decision_fingerprint_mismatch']
  ];
  for (const [name, mutate, reason] of cases) {
    const chain = canonicalChain();
    const requirements = name === 'missing binding id'
      ? (() => {
        const raw = clone(validRequirements(chain));
        mutate(raw);
        return raw;
      })()
      : validRequirements(chain, { mutate });
    const result = evaluatePreparation(chain, requirements);
    assert.equal(result.ok, false, name);
    assert.ok(result.reason_codes.includes(reason), name);
  }
});

test('cross-admission replay cannot reuse another preparation requirement binding', () => {
  const first = canonicalChain();
  const secondAdmission = validAdmissionContext({ admission_policy_id: 'public_web_canary_admission_policy_preparation_replay' });
  const second = canonicalChain({
    admissionContext: secondAdmission,
    authorizationRequest: baseAuthorizationRequest(secondAdmission.admission, {
      authorization_request_id: 'authzreq-public-web-preparation-replay-2'
    })
  });
  const firstRequirements = validRequirements(first);
  const replayed = evaluateExecutionPreparationRequirements(
    second.request,
    second.decision,
    second.binding,
    firstRequirements,
    { bindingValidationContext: second.bindingValidationContext }
  );
  assert.equal(replayed.ok, false);
  assert.ok(replayed.reason_codes.includes('authorization_request_id_mismatch'));
});

test('evaluation result validates exact fields and rejects fake execution authority', () => {
  const chain = canonicalChain();
  const requirements = validRequirements(chain);
  const result = evaluatePreparation(chain, requirements);
  const fakeAuthority = clone(result);
  fakeAuthority.authority_boundary.real_execution_authorized = true;
  assert.equal(validateExecutionPreparationEligibilityResult(fakeAuthority, {
    authorizationRequest: chain.request,
    authorizationDecision: chain.decision,
    admissionAuthorizationBinding: chain.binding,
    preparationRequirements: requirements,
    bindingValidationContext: chain.bindingValidationContext
  }).valid, false);

  const fakeProvider = clone(result);
  fakeProvider.authority_boundary.provider_called = true;
  assert.equal(validateExecutionPreparationEligibilityResult(fakeProvider, {
    authorizationRequest: chain.request,
    authorizationDecision: chain.decision,
    admissionAuthorizationBinding: chain.binding,
    preparationRequirements: requirements,
    bindingValidationContext: chain.bindingValidationContext
  }).valid, false);
});

test('implementation imports no provider, network, secret, runtime, worker, queue, scheduler, dispatch, or persistence clients', () => {
  const implementationPath = path.join(repoRoot, 'services', 'api', 'src', 'core', 'execution-preparation-requirement-boundary.js');
  const source = fs.readFileSync(implementationPath, 'utf8');
  assert.equal(/require\(\s*['"]node:(http|https|dns|dgram|net|fs|worker_threads|cluster|vm)['"]\s*\)/.test(source), false);
  assert.equal(/\b(fetch|setTimeout|setInterval|setImmediate)\s*\(/.test(source), false);
  assert.equal(/require\(\s*['"](openai|anthropic|@aws-sdk|redis|ioredis|amqplib|bullmq)['"]/.test(source), false);
  assert.equal(/process\.env/.test(source), false);
});
