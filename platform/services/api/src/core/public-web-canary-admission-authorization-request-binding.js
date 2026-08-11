'use strict';

const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { findCanaryForbiddenFields } = require('./public-web-canary-session-contract');
const {
  PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_SIMULATION_VALIDATOR_VERSION,
  validatePublicWebCanaryExecutionIntentAdmissionSimulationResult
} = require('./public-web-canary-execution-intent-admission-simulation-boundary');
const { validateExecutionAuthorizationRequest } = require('./execution-authorization-request');
const { evaluateExecutionAuthorizationRequest } = require('./execution-authorization-boundary');
const { validateExecutionAuthorizationDecision } = require('./execution-authorization-decision');

const PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_BINDING_VALIDATOR_VERSION =
  'public_web_canary_admission_authorization_request_binding_validator_v1';

const PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_BINDING_STATUSES = Object.freeze([
  'PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_REQUEST_BOUND_SIMULATION',
  'PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_REQUEST_REJECTED_SIMULATION',
  'PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_REQUEST_VALIDATION_FAILED'
]);

const PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_BINDING_DECISIONS = Object.freeze([
  'BIND_CANONICAL_EXECUTION_AUTHORIZATION_REQUEST_SIMULATION',
  'BLOCKED'
]);

const PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_BINDING_NEXT_STATES = Object.freeze([
  'WAITING_CANONICAL_EXECUTION_AUTHORIZATION_REFERENCE',
  'BLOCKED_REFERENCE'
]);

const PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_BINDING_RESULT_FIELDS = Object.freeze([
  'ok',
  'status',
  'decision',
  'next_state',
  'reason_codes',
  'binding_id',
  'binding_fingerprint',
  'source',
  'destination',
  'identity',
  'scope',
  'target',
  'policy',
  'authority_boundary',
  'evidence',
  'audit',
  'validator_version'
]);

const SOURCE_FIELDS = Object.freeze([
  'admission_id',
  'admission_fingerprint',
  'admission_status',
  'admission_validator_version',
  'intent_id',
  'intent_fingerprint',
  'intent_validator_version',
  'parent_handoff_fingerprint',
  'dispatch_package_id',
  'trial_id',
  'plan_hash'
]);

const DESTINATION_FIELDS = Object.freeze([
  'authorization_request_id',
  'authorization_causation_id',
  'authorization_request_fingerprint',
  'authorization_decision_id',
  'authorization_decision_fingerprint',
  'authorization_status',
  'authorization_decision',
  'authorization_next_state'
]);

const IDENTITY_FIELDS = Object.freeze([
  'request_id',
  'correlation_id',
  'trace_id',
  'tenant_id',
  'organization_id',
  'project_id',
  'agent_id',
  'session_reference_id',
  'actor_id',
  'actor_role'
]);

const SCOPE_FIELDS = Object.freeze([
  'authorization_scope_id',
  'authorization_scope_fingerprint',
  'task_reference_id',
  'task_fingerprint',
  'task_type',
  'risk_classification'
]);

const TARGET_FIELDS = Object.freeze([
  'capability',
  'target_class',
  'admission_environment'
]);

const POLICY_FIELDS = Object.freeze([
  'admission_policy_id',
  'admission_policy_version',
  'admission_policy_fingerprint',
  'authorization_policy_id',
  'authorization_policy_version'
]);

const AUTHORITY_BOUNDARY_FIELDS = Object.freeze([
  'admission_seen',
  'authorization_request_bound',
  'authorization_simulated',
  'execution_authorized',
  'provider_authorized',
  'secret_resolution_authorized',
  'network_authorized',
  'runtime_authorized',
  'worker_authorized',
  'queue_mutation_authorized',
  'scheduler_mutation_authorized',
  'dispatch_authorized',
  'operational_persistence_authorized',
  'real_execution_authorized',
  'legacy_public_web_authorization_used',
  'canonical_authorization_model'
]);

const EVIDENCE_FIELDS = Object.freeze([
  'admission_validated',
  'authorization_request_validated',
  'authorization_decision_validated',
  'scope_minimized',
  'binding_material_fingerprint',
  'simulation_only',
  'production_effect'
]);

const AUDIT_FIELDS = Object.freeze([
  'event_name',
  'admission_id',
  'admission_fingerprint',
  'authorization_request_id',
  'authorization_request_fingerprint',
  'authorization_decision_id',
  'authorization_decision_fingerprint',
  'actor_id',
  'risk_classification',
  'decision',
  'next_state',
  'reason_codes',
  'simulation_only',
  'production_effect'
]);

const AUTHORITY_SAFE_FALSE_FIELDS = Object.freeze([
  'execution_authorized',
  'provider_authorized',
  'secret_resolution_authorized',
  'network_authorized',
  'runtime_authorized',
  'worker_authorized',
  'queue_mutation_authorized',
  'scheduler_mutation_authorized',
  'dispatch_authorized',
  'operational_persistence_authorized',
  'real_execution_authorized',
  'legacy_public_web_authorization_used'
]);

const GENERIC_DECISION_SAFE_FALSE_FIELDS = Object.freeze([
  'execution_authorized',
  'execution_started',
  'agent_executed',
  'tool_called',
  'workflow_executed',
  'provider_called',
  'model_called',
  'network_used',
  'memory_read',
  'memory_written',
  'tokens_consumed',
  'cost_consumed',
  'runtime_enabled',
  'executed'
]);

const OUTCOMES = Object.freeze({
  PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_REQUEST_BOUND_SIMULATION: {
    decision: 'BIND_CANONICAL_EXECUTION_AUTHORIZATION_REQUEST_SIMULATION',
    next_state: 'WAITING_CANONICAL_EXECUTION_AUTHORIZATION_REFERENCE'
  },
  PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_REQUEST_REJECTED_SIMULATION: {
    decision: 'BLOCKED',
    next_state: 'BLOCKED_REFERENCE'
  },
  PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_REQUEST_VALIDATION_FAILED: {
    decision: 'BLOCKED',
    next_state: 'BLOCKED_REFERENCE'
  }
});

function valuesEqual(left, right) {
  try {
    return stablePayload(left) === stablePayload(right);
  } catch (_error) {
    return false;
  }
}

function exactOne(list, value) {
  return Array.isArray(list) && list.length === 1 && list[0] === value;
}

function fingerprint(value) {
  return computeCanonicalContentDigest(value);
}

function fingerprintRequest(request) {
  return fingerprint(request);
}

function sourceFromAdmission(admissionResult) {
  const admission = isPlainObject(admissionResult) ? admissionResult : {};
  const parent = isPlainObject(admission.parent) ? admission.parent : {};
  return {
    admission_id: admission.admission_id || null,
    admission_fingerprint: admission.admission_fingerprint || null,
    admission_status: admission.status || null,
    admission_validator_version: admission.validator_version || null,
    intent_id: parent.intent_id || null,
    intent_fingerprint: parent.intent_fingerprint || null,
    intent_validator_version: parent.intent_validator_version || null,
    parent_handoff_fingerprint: parent.parent_handoff_fingerprint || null,
    dispatch_package_id: parent.dispatch_package_id || null,
    trial_id: parent.trial_id || null,
    plan_hash: parent.plan_hash || null
  };
}

function destinationFromAuthorization(authorizationRequest, authorizationDecision) {
  const request = isPlainObject(authorizationRequest) ? authorizationRequest : {};
  const decision = isPlainObject(authorizationDecision) ? authorizationDecision : {};
  return {
    authorization_request_id: request.authorization_request_id || null,
    authorization_causation_id: request.causation_id || null,
    authorization_request_fingerprint: isPlainObject(authorizationRequest) ? fingerprintRequest(authorizationRequest) : null,
    authorization_decision_id: decision.authorization_decision_id || null,
    authorization_decision_fingerprint: isPlainObject(authorizationDecision) ? fingerprint(authorizationDecision) : null,
    authorization_status: decision.status || null,
    authorization_decision: decision.decision || null,
    authorization_next_state: decision.next_state || null
  };
}

function identityFrom(admissionResult, authorizationRequest) {
  const admission = isPlainObject(admissionResult) ? admissionResult : {};
  const request = isPlainObject(authorizationRequest) ? authorizationRequest : {};
  const decision = isPlainObject(request.orchestrator_decision_reference) ? request.orchestrator_decision_reference : {};
  const actor = isPlainObject(request.actor_context) ? request.actor_context : {};
  const task = isPlainObject(request.task_reference) ? request.task_reference : {};
  const admissionIdentity = isPlainObject(admission.identity) ? admission.identity : {};
  const admissionScope = isPlainObject(admission.scope) ? admission.scope : {};
  return {
    request_id: admissionIdentity.request_id || null,
    correlation_id: request.correlation_id || admissionIdentity.correlation_id || null,
    trace_id: request.trace_id || admissionIdentity.trace_id || null,
    tenant_id: decision.tenant_id || admissionScope.tenant_id || null,
    organization_id: decision.organization_id || admissionScope.organization_id || null,
    project_id: decision.project_id || admissionScope.project_id || null,
    agent_id: decision.agent_id || task.agent_id || null,
    session_reference_id: decision.session_reference_id || task.session_reference_id || null,
    actor_id: actor.actor_id || null,
    actor_role: actor.actor_role || null
  };
}

function scopeFrom(authorizationRequest) {
  const request = isPlainObject(authorizationRequest) ? authorizationRequest : {};
  const scope = isPlainObject(request.authorization_scope) ? request.authorization_scope : {};
  const task = isPlainObject(request.task_reference) ? request.task_reference : {};
  return {
    authorization_scope_id: scope.scope_id || null,
    authorization_scope_fingerprint: scope.scope_fingerprint || null,
    task_reference_id: task.task_reference_id || null,
    task_fingerprint: task.task_fingerprint || null,
    task_type: task.task_type || null,
    risk_classification: task.risk_classification || null
  };
}

function targetFromAdmission(admissionResult) {
  const admission = isPlainObject(admissionResult) ? admissionResult : {};
  const target = isPlainObject(admission.target) ? admission.target : {};
  const environment = isPlainObject(admission.environment) ? admission.environment : {};
  return {
    capability: admission.capability || null,
    target_class: target.target_class || null,
    admission_environment: environment.admission_environment || null
  };
}

function policyFrom(admissionResult, authorizationRequest) {
  const admission = isPlainObject(admissionResult) ? admissionResult : {};
  const admissionPolicy = isPlainObject(admission.policy) ? admission.policy : {};
  const authorizationPolicy = isPlainObject(authorizationRequest && authorizationRequest.authorization_policy)
    ? authorizationRequest.authorization_policy : {};
  return {
    admission_policy_id: admissionPolicy.admission_policy_id || null,
    admission_policy_version: Number.isInteger(admissionPolicy.admission_policy_version) ? admissionPolicy.admission_policy_version : null,
    admission_policy_fingerprint: admissionPolicy.admission_policy_fingerprint || null,
    authorization_policy_id: authorizationPolicy.authorization_policy_id || null,
    authorization_policy_version: Number.isInteger(authorizationPolicy.authorization_policy_version) ? authorizationPolicy.authorization_policy_version : null
  };
}

function buildAuthorityBoundary(ok) {
  return {
    admission_seen: ok === true,
    authorization_request_bound: ok === true,
    authorization_simulated: ok === true,
    execution_authorized: false,
    provider_authorized: false,
    secret_resolution_authorized: false,
    network_authorized: false,
    runtime_authorized: false,
    worker_authorized: false,
    queue_mutation_authorized: false,
    scheduler_mutation_authorized: false,
    dispatch_authorized: false,
    operational_persistence_authorized: false,
    real_execution_authorized: false,
    legacy_public_web_authorization_used: false,
    canonical_authorization_model: 'GENERIC_EXECUTION_AUTHORIZATION'
  };
}

function buildBindingMaterial({
  source,
  destination,
  identity,
  scope,
  target,
  policy,
  authorityBoundary,
  status,
  decision,
  nextState,
  reasonCodes
}) {
  return {
    validator_version: PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_BINDING_VALIDATOR_VERSION,
    source_admission_id: source.admission_id,
    source_admission_fingerprint: source.admission_fingerprint,
    source_admission_status: source.admission_status,
    source_intent_id: source.intent_id,
    source_intent_fingerprint: source.intent_fingerprint,
    source_parent_handoff_fingerprint: source.parent_handoff_fingerprint,
    source_dispatch_package_id: source.dispatch_package_id,
    source_trial_id: source.trial_id,
    source_plan_hash: source.plan_hash,
    destination_authorization_request_id: destination.authorization_request_id,
    destination_authorization_causation_id: destination.authorization_causation_id,
    destination_authorization_request_fingerprint: destination.authorization_request_fingerprint,
    destination_authorization_decision_id: destination.authorization_decision_id,
    destination_authorization_decision_fingerprint: destination.authorization_decision_fingerprint,
    destination_authorization_status: destination.authorization_status,
    request_id: identity.request_id,
    correlation_id: identity.correlation_id,
    trace_id: identity.trace_id,
    tenant_id: identity.tenant_id,
    organization_id: identity.organization_id,
    project_id: identity.project_id,
    agent_id: identity.agent_id,
    session_reference_id: identity.session_reference_id,
    actor_id: identity.actor_id,
    actor_role: identity.actor_role,
    authorization_scope_id: scope.authorization_scope_id,
    authorization_scope_fingerprint: scope.authorization_scope_fingerprint,
    task_reference_id: scope.task_reference_id,
    task_fingerprint: scope.task_fingerprint,
    task_type: scope.task_type,
    risk_classification: scope.risk_classification,
    capability: target.capability,
    target_class: target.target_class,
    admission_environment: target.admission_environment,
    admission_policy_id: policy.admission_policy_id,
    admission_policy_version: policy.admission_policy_version,
    admission_policy_fingerprint: policy.admission_policy_fingerprint,
    authorization_policy_id: policy.authorization_policy_id,
    authorization_policy_version: policy.authorization_policy_version,
    status,
    decision,
    next_state: nextState,
    reason_codes: uniqueSorted(reasonCodes),
    admission_seen: authorityBoundary.admission_seen,
    authorization_request_bound: authorityBoundary.authorization_request_bound,
    authorization_simulated: authorityBoundary.authorization_simulated,
    canonical_authorization_model: authorityBoundary.canonical_authorization_model,
    simulation_only: true,
    production_effect: 'ZERO'
  };
}

function collectScopeMinimizationFailures(request) {
  const scope = request.authorization_scope;
  const actor = request.actor_context;
  const decision = request.orchestrator_decision_reference;
  const task = request.task_reference;
  const failures = [];
  if (!exactOne(scope.allowed_agent_ids, decision.agent_id)) failures.push('authorization_scope_not_minimized_agent');
  if (!exactOne(scope.allowed_project_ids, decision.project_id)) failures.push('authorization_scope_not_minimized_project');
  if (!exactOne(scope.allowed_session_reference_ids, decision.session_reference_id)) failures.push('authorization_scope_not_minimized_session');
  if (!exactOne(scope.allowed_plan_ids, decision.plan_id)) failures.push('authorization_scope_not_minimized_plan');
  if (!exactOne(scope.allowed_actor_ids, actor.actor_id)) failures.push('authorization_scope_not_minimized_actor');
  if (!exactOne(scope.allowed_actor_roles, actor.actor_role)) failures.push('authorization_scope_not_minimized_role');
  if (!exactOne(scope.allowed_task_types, task.task_type)) failures.push('authorization_scope_not_minimized_task_type');
  if (!exactOne(scope.allowed_risk_classifications, task.risk_classification)) failures.push('authorization_scope_not_minimized_risk');
  return failures;
}

function collectAdmissionRequestBindingFailures(admissionResult, authorizationRequest) {
  const admissionIdentity = admissionResult.identity;
  const admissionScope = admissionResult.scope;
  const decision = authorizationRequest.orchestrator_decision_reference;
  const actor = authorizationRequest.actor_context;
  const task = authorizationRequest.task_reference;
  const policy = authorizationRequest.authorization_policy;
  const failures = [];
  if (authorizationRequest.causation_id !== admissionResult.admission_id) failures.push('authorization_request_causation_mismatch');
  if (authorizationRequest.correlation_id !== admissionIdentity.correlation_id) failures.push('correlation_id_mismatch');
  if (authorizationRequest.trace_id !== admissionIdentity.trace_id) failures.push('trace_id_mismatch');
  if (decision.tenant_id !== admissionScope.tenant_id) failures.push('tenant_mismatch');
  if (decision.organization_id !== admissionScope.organization_id) failures.push('organization_mismatch');
  if (decision.project_id !== admissionScope.project_id) failures.push('project_mismatch');
  if (task.tenant_id !== admissionScope.tenant_id) failures.push('task_tenant_mismatch');
  if (task.organization_id !== admissionScope.organization_id) failures.push('task_organization_mismatch');
  if (task.project_id !== admissionScope.project_id) failures.push('task_project_mismatch');
  if (actor.tenant_id !== admissionScope.tenant_id) failures.push('actor_tenant_mismatch');
  if (actor.organization_id !== admissionScope.organization_id) failures.push('actor_organization_mismatch');
  if (actor.project_id !== admissionScope.project_id) failures.push('actor_project_mismatch');
  if (policy.simulation !== true || policy.production_blocked !== true) failures.push('authorization_policy_not_simulation_only');
  failures.push(...collectScopeMinimizationFailures(authorizationRequest));
  return uniqueSorted(failures);
}

function collectGenericDecisionSafetyFailures(decision) {
  const failures = [];
  for (const field of GENERIC_DECISION_SAFE_FALSE_FIELDS) {
    if (decision[field] !== false) failures.push(`generic_decision_${field}_must_be_false`);
  }
  if (decision.simulation !== true) failures.push('generic_decision_simulation_must_be_true');
  if (decision.production_blocked !== true) failures.push('generic_decision_production_blocked_must_be_true');
  if (decision.rollout_percentage !== 0) failures.push('generic_decision_rollout_percentage_must_be_zero');
  return failures;
}

function statusFor(reasonCodes) {
  if (reasonCodes.includes('admission_result_invalid') || reasonCodes.includes('authorization_request_invalid')) {
    return 'PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_REQUEST_VALIDATION_FAILED';
  }
  return 'PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_REQUEST_REJECTED_SIMULATION';
}

function buildResult({ ok, status, reasonCodes, admissionResult, authorizationRequest, authorizationDecision }) {
  const outcome = OUTCOMES[status];
  const normalizedReasons = ok ? ['canonical_authorization_request_bound_simulation_only'] : uniqueSorted([...reasonCodes, 'fail_closed']);
  const source = sourceFromAdmission(admissionResult);
  const destination = destinationFromAuthorization(authorizationRequest, authorizationDecision);
  const identity = identityFrom(admissionResult, authorizationRequest);
  const scope = scopeFrom(authorizationRequest);
  const target = targetFromAdmission(admissionResult);
  const policy = policyFrom(admissionResult, authorizationRequest);
  const authorityBoundary = buildAuthorityBoundary(ok);
  const material = buildBindingMaterial({
    source,
    destination,
    identity,
    scope,
    target,
    policy,
    authorityBoundary,
    status,
    decision: outcome.decision,
    nextState: outcome.next_state,
    reasonCodes: normalizedReasons
  });
  const evidence = {
    admission_validated: ok === true,
    authorization_request_validated: ok === true,
    authorization_decision_validated: ok === true,
    scope_minimized: ok === true,
    binding_material_fingerprint: fingerprint(material),
    simulation_only: true,
    production_effect: 'ZERO'
  };
  const bindingId = `public_web_canary_admission_authorization_request_binding:${fingerprint({ material, evidence })}`;
  const audit = {
    event_name: ok === true
      ? 'public_web_canary_admission_authorization_request_bound_simulation'
      : 'public_web_canary_admission_authorization_request_blocked',
    admission_id: source.admission_id,
    admission_fingerprint: source.admission_fingerprint,
    authorization_request_id: destination.authorization_request_id,
    authorization_request_fingerprint: destination.authorization_request_fingerprint,
    authorization_decision_id: destination.authorization_decision_id,
    authorization_decision_fingerprint: destination.authorization_decision_fingerprint,
    actor_id: identity.actor_id,
    risk_classification: scope.risk_classification,
    decision: outcome.decision,
    next_state: outcome.next_state,
    reason_codes: normalizedReasons,
    simulation_only: true,
    production_effect: 'ZERO'
  };
  return cloneFrozen({
    ok,
    status,
    decision: outcome.decision,
    next_state: outcome.next_state,
    reason_codes: normalizedReasons,
    binding_id: bindingId,
    binding_fingerprint: fingerprint({ material, evidence, audit }),
    source,
    destination,
    identity,
    scope,
    target,
    policy,
    authority_boundary: authorityBoundary,
    evidence,
    audit,
    validator_version: PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_BINDING_VALIDATOR_VERSION
  });
}

function evaluatePublicWebCanaryAdmissionAuthorizationRequestBinding(admissionResult, authorizationRequest, context = {}) {
  const admissionValidation = validatePublicWebCanaryExecutionIntentAdmissionSimulationResult(
    admissionResult,
    context.admissionValidationContext
  );
  const reasonCodes = [];
  let authorizationDecision = null;

  if (!admissionValidation.valid) {
    reasonCodes.push('admission_result_invalid');
  } else if (admissionResult.ok !== true || admissionResult.status !== 'PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMITTED_SIMULATION') {
    reasonCodes.push('admission_not_admitted');
  }

  const requestValidation = validateExecutionAuthorizationRequest(authorizationRequest);
  if (!requestValidation.valid) {
    reasonCodes.push('authorization_request_invalid');
  } else {
    const outcome = evaluateExecutionAuthorizationRequest(authorizationRequest);
    authorizationDecision = outcome.decision;
    const decisionValidation = validateExecutionAuthorizationDecision(authorizationDecision);
    if (!decisionValidation.valid) reasonCodes.push('authorization_decision_invalid');
    if (authorizationDecision.status !== 'AUTHORIZED_SIMULATION') reasonCodes.push('authorization_request_not_authorized_simulation');
    reasonCodes.push(...collectGenericDecisionSafetyFailures(authorizationDecision));
  }

  if (admissionValidation.valid && requestValidation.valid) {
    reasonCodes.push(...collectAdmissionRequestBindingFailures(admissionResult, authorizationRequest));
  }

  const ok = reasonCodes.length === 0;
  return buildResult({
    ok,
    status: ok ? 'PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_REQUEST_BOUND_SIMULATION' : statusFor(reasonCodes),
    reasonCodes,
    admissionResult,
    authorizationRequest,
    authorizationDecision
  });
}

function validateObjectFields(value, fields, prefix, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${prefix}_must_be_object`);
    return false;
  }
  exactFields(value, fields, prefix, errors);
  return true;
}

function validatePublicWebCanaryAdmissionAuthorizationRequestBindingResult(result, context = {}) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['binding_result_must_be_object'] };
  exactFields(result, PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_BINDING_RESULT_FIELDS, 'binding_result', errors);
  if (typeof result.ok !== 'boolean') errors.push('ok_must_be_boolean');
  if (!PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_BINDING_STATUSES.includes(result.status)) errors.push('status_invalid');
  if (!PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_BINDING_DECISIONS.includes(result.decision)) errors.push('decision_invalid');
  if (!PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_BINDING_NEXT_STATES.includes(result.next_state)) errors.push('next_state_invalid');
  const expectedOutcome = OUTCOMES[result.status];
  if (expectedOutcome && result.decision !== expectedOutcome.decision) errors.push('decision_status_mismatch');
  if (expectedOutcome && result.next_state !== expectedOutcome.next_state) errors.push('next_state_status_mismatch');
  if (!Array.isArray(result.reason_codes) || result.reason_codes.some((reason) => !isNonEmptyString(reason))) errors.push('reason_codes_invalid');
  if (!isNonEmptyString(result.binding_id)) errors.push('binding_id_invalid');
  if (!isNonEmptyString(result.binding_fingerprint)) errors.push('binding_fingerprint_invalid');
  if (result.validator_version !== PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_BINDING_VALIDATOR_VERSION) errors.push('validator_version_invalid');

  const hasSource = validateObjectFields(result.source, SOURCE_FIELDS, 'source', errors);
  const hasDestination = validateObjectFields(result.destination, DESTINATION_FIELDS, 'destination', errors);
  const hasIdentity = validateObjectFields(result.identity, IDENTITY_FIELDS, 'identity', errors);
  const hasScope = validateObjectFields(result.scope, SCOPE_FIELDS, 'scope', errors);
  const hasTarget = validateObjectFields(result.target, TARGET_FIELDS, 'target', errors);
  const hasPolicy = validateObjectFields(result.policy, POLICY_FIELDS, 'policy', errors);
  const hasAuthority = validateObjectFields(result.authority_boundary, AUTHORITY_BOUNDARY_FIELDS, 'authority_boundary', errors);
  const hasEvidence = validateObjectFields(result.evidence, EVIDENCE_FIELDS, 'evidence', errors);
  const hasAudit = validateObjectFields(result.audit, AUDIT_FIELDS, 'audit', errors);

  if (result.ok === true) {
    if (result.status !== 'PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_REQUEST_BOUND_SIMULATION') errors.push('ok_status_mismatch');
    if (!valuesEqual(result.reason_codes, ['canonical_authorization_request_bound_simulation_only'])) errors.push('ok_reason_codes_mismatch');
  } else {
    if (result.status === 'PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_REQUEST_BOUND_SIMULATION') errors.push('blocked_status_mismatch');
    if (!result.reason_codes.includes('fail_closed')) errors.push('blocked_fail_closed_required');
  }

  if (hasAuthority) {
    for (const field of AUTHORITY_SAFE_FALSE_FIELDS) {
      if (result.authority_boundary[field] !== false) errors.push(`authority_boundary_${field}_must_be_false`);
    }
    if (result.authority_boundary.admission_seen !== (result.ok === true)) errors.push('authority_boundary_admission_seen_mismatch');
    if (result.authority_boundary.authorization_request_bound !== (result.ok === true)) errors.push('authority_boundary_request_bound_mismatch');
    if (result.authority_boundary.authorization_simulated !== (result.ok === true)) errors.push('authority_boundary_authorization_simulated_mismatch');
    if (result.authority_boundary.canonical_authorization_model !== 'GENERIC_EXECUTION_AUTHORIZATION') {
      errors.push('canonical_authorization_model_invalid');
    }
  }
  if (hasEvidence) {
    if (result.evidence.simulation_only !== true) errors.push('evidence_simulation_only_required');
    if (result.evidence.production_effect !== 'ZERO') errors.push('evidence_production_effect_must_be_zero');
    if (result.evidence.admission_validated !== (result.ok === true)) errors.push('evidence_admission_validated_mismatch');
    if (result.evidence.authorization_request_validated !== (result.ok === true)) errors.push('evidence_request_validated_mismatch');
  }
  if (hasAudit) {
    if (!valuesEqual(result.audit.reason_codes, result.reason_codes)) errors.push('audit_reason_codes_mismatch');
    if (hasSource && result.audit.admission_fingerprint !== result.source.admission_fingerprint) errors.push('audit_admission_fingerprint_mismatch');
    if (hasDestination && result.audit.authorization_request_fingerprint !== result.destination.authorization_request_fingerprint) {
      errors.push('audit_authorization_request_fingerprint_mismatch');
    }
    if (result.audit.simulation_only !== true) errors.push('audit_simulation_only_required');
    if (result.audit.production_effect !== 'ZERO') errors.push('audit_production_effect_must_be_zero');
  }

  if (hasSource && hasDestination && hasIdentity && hasScope && hasTarget && hasPolicy && hasAuthority && hasEvidence && hasAudit) {
    const material = buildBindingMaterial({
      source: result.source,
      destination: result.destination,
      identity: result.identity,
      scope: result.scope,
      target: result.target,
      policy: result.policy,
      authorityBoundary: result.authority_boundary,
      status: result.status,
      decision: result.decision,
      nextState: result.next_state,
      reasonCodes: result.reason_codes
    });
    if (result.evidence.binding_material_fingerprint !== fingerprint(material)) errors.push('binding_material_fingerprint_mismatch');
    if (result.binding_id !== `public_web_canary_admission_authorization_request_binding:${fingerprint({ material, evidence: result.evidence })}`) {
      errors.push('binding_id_mismatch');
    }
    if (result.binding_fingerprint !== fingerprint({ material, evidence: result.evidence, audit: result.audit })) {
      errors.push('binding_fingerprint_mismatch');
    }
  }

  if (!isPlainObject(context) || !Object.prototype.hasOwnProperty.call(context, 'admissionResult') || !Object.prototype.hasOwnProperty.call(context, 'authorizationRequest')) {
    errors.push('binding_validation_context_required');
  } else {
    const expected = evaluatePublicWebCanaryAdmissionAuthorizationRequestBinding(context.admissionResult, context.authorizationRequest, {
      admissionValidationContext: context.admissionValidationContext
    });
    if (!valuesEqual(result, expected)) errors.push('binding_context_mismatch');
  }
  if (findCanaryForbiddenFields(result).length > 0) errors.push('forbidden_field_detected');
  try {
    stablePayload(result);
  } catch (error) {
    errors.push(`non_canonical_input::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  AUTHORITY_SAFE_FALSE_FIELDS,
  DESTINATION_FIELDS,
  EVIDENCE_FIELDS,
  IDENTITY_FIELDS,
  POLICY_FIELDS,
  PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_BINDING_DECISIONS,
  PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_BINDING_NEXT_STATES,
  PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_BINDING_RESULT_FIELDS,
  PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_BINDING_STATUSES,
  PUBLIC_WEB_CANARY_ADMISSION_AUTHORIZATION_BINDING_VALIDATOR_VERSION,
  SCOPE_FIELDS,
  SOURCE_FIELDS,
  TARGET_FIELDS,
  buildBindingMaterial,
  evaluatePublicWebCanaryAdmissionAuthorizationRequestBinding,
  validatePublicWebCanaryAdmissionAuthorizationRequestBindingResult
};
