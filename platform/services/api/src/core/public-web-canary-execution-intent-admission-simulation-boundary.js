'use strict';

const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { findCanaryForbiddenFields } = require('./public-web-canary-session-contract');
const { PUBLIC_WEB_CANARY_CAPABILITY } = require('./public-web-canary-queued-simulation-boundary');
const {
  PUBLIC_WEB_CANARY_EXECUTION_INTENT_SIMULATION_VALIDATOR_VERSION,
  validatePublicWebCanaryExecutionIntentSimulationResult
} = require('./public-web-canary-execution-intent-simulation-boundary');

const PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_POLICY_VALIDATOR_VERSION =
  'public_web_canary_execution_intent_admission_policy_validator_v1';
const PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_SIMULATION_VALIDATOR_VERSION =
  'public_web_canary_execution_intent_admission_simulation_validator_v1';

const PUBLIC_WEB_CANARY_ADMISSION_ENVIRONMENTS = Object.freeze(['SIMULATION_ONLY']);
const PUBLIC_WEB_CANARY_ADMISSION_TARGET_CLASSES = Object.freeze(['PUBLIC_WEB_CANARY_SIMULATED_HANDOFF']);
const PUBLIC_WEB_CANARY_REQUIRED_NEXT_AUTHORITY_STAGES = Object.freeze(['PUBLIC_WEB_CANARY_EXECUTION_AUTHORITY_REQUIRED']);

const PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_POLICY_FIELDS = Object.freeze([
  'admission_policy_id',
  'admission_policy_version',
  'supported_capability',
  'target_class',
  'admission_environment',
  'require_simulation_mode',
  'require_production_blocked',
  'require_parent_validated',
  'require_zero_later_authority',
  'allow_admission_simulation',
  'required_next_authority_stage',
  'fail_closed',
  'simulation_only',
  'production_effect',
  'admission_policy_fingerprint',
  'validator_version'
]);

const PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_STATUSES = Object.freeze([
  'PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMITTED_SIMULATION',
  'PUBLIC_WEB_CANARY_EXECUTION_INTENT_REJECTED_SIMULATION',
  'PUBLIC_WEB_CANARY_EXECUTION_INTENT_NOT_SUPPORTED',
  'PUBLIC_WEB_CANARY_EXECUTION_INTENT_POLICY_BLOCKED',
  'PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_VALIDATION_FAILED'
]);

const PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_DECISIONS = Object.freeze([
  'ADMIT_EXECUTION_INTENT_SIMULATION',
  'REJECT_EXECUTION_INTENT_SIMULATION',
  'REQUEST_ADMISSION_POLICY_REFERENCE',
  'BLOCKED'
]);

const PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_NEXT_STATES = Object.freeze([
  'WAITING_FUTURE_EXECUTION_AUTHORITY_REFERENCE',
  'WAITING_ADMISSION_POLICY_REFERENCE',
  'BLOCKED_REFERENCE'
]);

const STATUS_OUTCOME_MAP = Object.freeze({
  PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMITTED_SIMULATION: {
    decision: 'ADMIT_EXECUTION_INTENT_SIMULATION',
    next_state: 'WAITING_FUTURE_EXECUTION_AUTHORITY_REFERENCE'
  },
  PUBLIC_WEB_CANARY_EXECUTION_INTENT_POLICY_BLOCKED: {
    decision: 'REQUEST_ADMISSION_POLICY_REFERENCE',
    next_state: 'WAITING_ADMISSION_POLICY_REFERENCE'
  },
  PUBLIC_WEB_CANARY_EXECUTION_INTENT_REJECTED_SIMULATION: {
    decision: 'REJECT_EXECUTION_INTENT_SIMULATION',
    next_state: 'BLOCKED_REFERENCE'
  }
});

const DEFAULT_OUTCOME = Object.freeze({
  decision: 'BLOCKED',
  next_state: 'BLOCKED_REFERENCE'
});

const PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_RESULT_FIELDS = Object.freeze([
  'ok',
  'status',
  'decision',
  'next_state',
  'reason_codes',
  'capability',
  'admission_id',
  'admission_fingerprint',
  'identity',
  'scope',
  'parent',
  'policy',
  'target',
  'environment',
  'authority_boundary',
  'evidence',
  'audit',
  'validator_version'
]);

const IDENTITY_FIELDS = Object.freeze([
  'request_id',
  'correlation_id',
  'trace_id',
  'capability'
]);

const SCOPE_FIELDS = Object.freeze([
  'tenant_id',
  'organization_id',
  'project_id'
]);

const PARENT_FIELDS = Object.freeze([
  'intent_id',
  'intent_fingerprint',
  'intent_status',
  'intent_validator_version',
  'parent_handoff_fingerprint',
  'dispatch_package_id',
  'trial_id',
  'plan_hash'
]);

const POLICY_SUMMARY_FIELDS = Object.freeze([
  'admission_policy_id',
  'admission_policy_version',
  'admission_policy_fingerprint',
  'supported_capability',
  'target_class',
  'admission_environment',
  'required_next_authority_stage'
]);

const TARGET_FIELDS = Object.freeze(['target_class']);
const ENVIRONMENT_FIELDS = Object.freeze(['admission_environment']);

const AUTHORITY_BOUNDARY_FIELDS = Object.freeze([
  'intent_creation_seen',
  'admission_simulated',
  'future_authority_required',
  'later_authority',
  'operational_effect'
]);

const EVIDENCE_FIELDS = Object.freeze([
  'intent_validated',
  'policy_validated',
  'parent_intent_fingerprint',
  'policy_fingerprint',
  'admission_material_fingerprint',
  'simulation_only',
  'production_effect'
]);

const AUDIT_FIELDS = Object.freeze([
  'event_name',
  'capability',
  'request_id',
  'correlation_id',
  'trace_id',
  'admission_id',
  'intent_id',
  'intent_fingerprint',
  'admission_policy_id',
  'admission_policy_fingerprint',
  'target_class',
  'admission_environment',
  'decision',
  'next_state',
  'reason_codes',
  'simulation_only',
  'production_effect'
]);

const POLICY_BOOLEAN_FIELDS = Object.freeze([
  'require_simulation_mode',
  'require_production_blocked',
  'require_parent_validated',
  'require_zero_later_authority',
  'allow_admission_simulation',
  'fail_closed',
  'simulation_only'
]);

const ADMITTED_REASON_CODE = 'admitted_simulation';

function computeAdmissionFingerprint(payload) {
  return computeCanonicalContentDigest(payload);
}

function valuesEqual(left, right) {
  try {
    return stablePayload(left) === stablePayload(right);
  } catch (_error) {
    return false;
  }
}

function buildPolicyFingerprintMaterial(policy) {
  return {
    validator_version: PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_POLICY_VALIDATOR_VERSION,
    admission_policy_id: policy.admission_policy_id,
    admission_policy_version: policy.admission_policy_version,
    supported_capability: policy.supported_capability,
    target_class: policy.target_class,
    admission_environment: policy.admission_environment,
    require_simulation_mode: policy.require_simulation_mode,
    require_production_blocked: policy.require_production_blocked,
    require_parent_validated: policy.require_parent_validated,
    require_zero_later_authority: policy.require_zero_later_authority,
    allow_admission_simulation: policy.allow_admission_simulation,
    required_next_authority_stage: policy.required_next_authority_stage,
    fail_closed: policy.fail_closed,
    simulation_only: policy.simulation_only,
    production_effect: policy.production_effect
  };
}

function computeAdmissionPolicyFingerprint(policy) {
  return computeAdmissionFingerprint(buildPolicyFingerprintMaterial(policy));
}

function buildPublicWebCanaryExecutionIntentAdmissionPolicy(input = {}) {
  const policy = {
    admission_policy_id: input.admission_policy_id,
    admission_policy_version: Number.isInteger(input.admission_policy_version) ? input.admission_policy_version : 1,
    supported_capability: input.supported_capability || PUBLIC_WEB_CANARY_CAPABILITY,
    target_class: input.target_class || 'PUBLIC_WEB_CANARY_SIMULATED_HANDOFF',
    admission_environment: input.admission_environment || 'SIMULATION_ONLY',
    require_simulation_mode: true,
    require_production_blocked: true,
    require_parent_validated: true,
    require_zero_later_authority: true,
    allow_admission_simulation: true,
    required_next_authority_stage: input.required_next_authority_stage || 'PUBLIC_WEB_CANARY_EXECUTION_AUTHORITY_REQUIRED',
    fail_closed: true,
    simulation_only: true,
    production_effect: 'ZERO',
    validator_version: PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_POLICY_VALIDATOR_VERSION
  };
  policy.admission_policy_fingerprint = computeAdmissionPolicyFingerprint(policy);
  const validation = validatePublicWebCanaryExecutionIntentAdmissionPolicy(policy);
  if (!validation.valid) {
    throw new Error(`public_web_canary_execution_intent_admission_policy_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(policy);
}

function validatePublicWebCanaryExecutionIntentAdmissionPolicy(policy) {
  const errors = [];
  if (!isPlainObject(policy)) return { valid: false, errors: ['policy_reference_missing'] };
  exactFields(policy, PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_POLICY_FIELDS, 'admission_policy', errors);
  if (!isNonEmptyString(policy.admission_policy_id)) errors.push('admission_policy_id_invalid');
  if (!Number.isInteger(policy.admission_policy_version) || policy.admission_policy_version < 1) {
    errors.push('admission_policy_version_invalid');
  }
  if (policy.supported_capability !== PUBLIC_WEB_CANARY_CAPABILITY) errors.push('unsupported_capability');
  if (!PUBLIC_WEB_CANARY_ADMISSION_TARGET_CLASSES.includes(policy.target_class)) errors.push('unsupported_target');
  if (!PUBLIC_WEB_CANARY_ADMISSION_ENVIRONMENTS.includes(policy.admission_environment)) errors.push('unsupported_environment');
  if (!PUBLIC_WEB_CANARY_REQUIRED_NEXT_AUTHORITY_STAGES.includes(policy.required_next_authority_stage)) {
    errors.push('unknown_enum');
  }
  for (const field of POLICY_BOOLEAN_FIELDS) {
    if (policy[field] !== true) errors.push(`${field}_must_be_true`);
  }
  if (policy.production_effect !== 'ZERO') errors.push('production_effect_must_be_zero');
  if (policy.validator_version !== PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_POLICY_VALIDATOR_VERSION) {
    errors.push('policy_reference_mismatch');
  }
  if (!isNonEmptyString(policy.admission_policy_fingerprint)) errors.push('admission_policy_fingerprint_invalid');
  if (isNonEmptyString(policy.admission_policy_fingerprint) && policy.admission_policy_fingerprint !== computeAdmissionPolicyFingerprint(policy)) {
    errors.push('policy_reference_mismatch');
  }
  try {
    stablePayload(policy);
  } catch (error) {
    errors.push(`non_canonical_input::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function nullIdentity() {
  return {
    request_id: null,
    correlation_id: null,
    trace_id: null,
    capability: PUBLIC_WEB_CANARY_CAPABILITY
  };
}

function nullScope() {
  return {
    tenant_id: null,
    organization_id: null,
    project_id: null
  };
}

function nullParent() {
  return {
    intent_id: null,
    intent_fingerprint: null,
    intent_status: null,
    intent_validator_version: null,
    parent_handoff_fingerprint: null,
    dispatch_package_id: null,
    trial_id: null,
    plan_hash: null
  };
}

function nullPolicySummary(policyReference) {
  const policy = isPlainObject(policyReference) ? policyReference : {};
  return {
    admission_policy_id: policy.admission_policy_id || null,
    admission_policy_version: Number.isInteger(policy.admission_policy_version) ? policy.admission_policy_version : null,
    admission_policy_fingerprint: policy.admission_policy_fingerprint || null,
    supported_capability: policy.supported_capability || null,
    target_class: policy.target_class || null,
    admission_environment: policy.admission_environment || null,
    required_next_authority_stage: policy.required_next_authority_stage || null
  };
}

function identityFromIntent(intentResult) {
  return {
    request_id: intentResult.identity.request_id,
    correlation_id: intentResult.identity.correlation_id,
    trace_id: intentResult.identity.trace_id,
    capability: intentResult.identity.capability
  };
}

function scopeFromIntent(intentResult) {
  return {
    tenant_id: intentResult.scope.tenant_id,
    organization_id: intentResult.scope.organization_id,
    project_id: intentResult.scope.project_id
  };
}

function parentFromIntent(intentResult) {
  return {
    intent_id: intentResult.intent_id,
    intent_fingerprint: intentResult.intent_fingerprint,
    intent_status: intentResult.status,
    intent_validator_version: intentResult.validator_version,
    parent_handoff_fingerprint: intentResult.parent.handoff_fingerprint,
    dispatch_package_id: intentResult.parent.dispatch_package_id,
    trial_id: intentResult.parent.trial_id,
    plan_hash: intentResult.parent.plan_hash
  };
}

function policySummary(policyReference) {
  return {
    admission_policy_id: policyReference.admission_policy_id,
    admission_policy_version: policyReference.admission_policy_version,
    admission_policy_fingerprint: policyReference.admission_policy_fingerprint,
    supported_capability: policyReference.supported_capability,
    target_class: policyReference.target_class,
    admission_environment: policyReference.admission_environment,
    required_next_authority_stage: policyReference.required_next_authority_stage
  };
}

function buildAdmissionFingerprintMaterial({ identity, scope, parent, policy, target, environment, authorityBoundary, status, decision, nextState, reasonCodes }) {
  return {
    validator_version: PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_SIMULATION_VALIDATOR_VERSION,
    capability: identity.capability,
    request_id: identity.request_id,
    correlation_id: identity.correlation_id,
    trace_id: identity.trace_id,
    tenant_id: scope.tenant_id,
    organization_id: scope.organization_id,
    project_id: scope.project_id,
    parent_intent_id: parent.intent_id,
    parent_intent_fingerprint: parent.intent_fingerprint,
    parent_intent_status: parent.intent_status,
    parent_intent_validator_version: parent.intent_validator_version,
    parent_handoff_fingerprint: parent.parent_handoff_fingerprint,
    dispatch_package_id: parent.dispatch_package_id,
    trial_id: parent.trial_id,
    plan_hash: parent.plan_hash,
    admission_policy_id: policy.admission_policy_id,
    admission_policy_version: policy.admission_policy_version,
    admission_policy_fingerprint: policy.admission_policy_fingerprint,
    target_class: target.target_class,
    admission_environment: environment.admission_environment,
    status,
    decision,
    next_state: nextState,
    reason_codes: uniqueSorted(reasonCodes),
    intent_creation_seen: authorityBoundary.intent_creation_seen,
    admission_simulated: authorityBoundary.admission_simulated,
    future_authority_required: authorityBoundary.future_authority_required,
    later_authority: authorityBoundary.later_authority,
    operational_effect: authorityBoundary.operational_effect,
    simulation_only: true,
    production_effect: 'ZERO'
  };
}

function statusFor(reasonCodes) {
  if (reasonCodes.includes('unsupported_capability')) return 'PUBLIC_WEB_CANARY_EXECUTION_INTENT_NOT_SUPPORTED';
  if (reasonCodes.includes('policy_reference_missing') || reasonCodes.includes('policy_reference_mismatch')) {
    return 'PUBLIC_WEB_CANARY_EXECUTION_INTENT_POLICY_BLOCKED';
  }
  if (reasonCodes.includes('malformed_intent') || reasonCodes.some((reason) => reason.startsWith('intent_'))) {
    return 'PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_VALIDATION_FAILED';
  }
  return 'PUBLIC_WEB_CANARY_EXECUTION_INTENT_REJECTED_SIMULATION';
}

function outcomeForStatus(status) {
  return STATUS_OUTCOME_MAP[status] || DEFAULT_OUTCOME;
}

function buildAuthorityBoundary(admitted, intentCreationSeen) {
  return {
    intent_creation_seen: intentCreationSeen === true,
    admission_simulated: admitted === true,
    future_authority_required: true,
    later_authority: 'NONE',
    operational_effect: 'ZERO'
  };
}

function buildResult({ admitted, status, reasonCodes, identity, scope, parent, policy, target, environment, intentCreationSeen }) {
  const outcome = outcomeForStatus(status);
  const authorityBoundary = buildAuthorityBoundary(admitted, intentCreationSeen);
  const normalizedReasons = uniqueSorted(reasonCodes);
  const material = buildAdmissionFingerprintMaterial({
    identity,
    scope,
    parent,
    policy,
    target,
    environment,
    authorityBoundary,
    status,
    decision: outcome.decision,
    nextState: outcome.next_state,
    reasonCodes: normalizedReasons
  });
  const evidence = {
    intent_validated: admitted === true,
    policy_validated: admitted === true,
    parent_intent_fingerprint: parent.intent_fingerprint,
    policy_fingerprint: policy.admission_policy_fingerprint,
    admission_material_fingerprint: computeAdmissionFingerprint(material),
    simulation_only: true,
    production_effect: 'ZERO'
  };
  const admissionId = `public_web_canary_execution_intent_admission:${computeAdmissionFingerprint({ material, evidence })}`;
  const audit = {
    event_name: admitted === true
      ? 'public_web_canary_execution_intent_admission_simulated'
      : 'public_web_canary_execution_intent_admission_blocked',
    capability: identity.capability,
    request_id: identity.request_id,
    correlation_id: identity.correlation_id,
    trace_id: identity.trace_id,
    admission_id: admissionId,
    intent_id: parent.intent_id,
    intent_fingerprint: parent.intent_fingerprint,
    admission_policy_id: policy.admission_policy_id,
    admission_policy_fingerprint: policy.admission_policy_fingerprint,
    target_class: target.target_class,
    admission_environment: environment.admission_environment,
    decision: outcome.decision,
    next_state: outcome.next_state,
    reason_codes: normalizedReasons,
    simulation_only: true,
    production_effect: 'ZERO'
  };
  const result = {
    ok: admitted === true,
    status,
    decision: outcome.decision,
    next_state: outcome.next_state,
    reason_codes: normalizedReasons,
    capability: PUBLIC_WEB_CANARY_CAPABILITY,
    admission_id: admissionId,
    admission_fingerprint: computeAdmissionFingerprint({ material, evidence, audit }),
    identity,
    scope,
    parent,
    policy,
    target,
    environment,
    authority_boundary: authorityBoundary,
    evidence,
    audit,
    validator_version: PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_SIMULATION_VALIDATOR_VERSION
  };
  return cloneFrozen(result);
}

function collectIntentAuthorityFailures(intentResult) {
  const authority = intentResult && intentResult.authority;
  const failures = [];
  if (!isPlainObject(authority)) return ['intent_authority_missing'];
  if (authority.intent_created !== true) failures.push('intent_not_created');
  for (const field of Object.keys(authority)) {
    if (field !== 'intent_created' && authority[field] !== false) failures.push('authority_escalation_detected');
  }
  return uniqueSorted(failures);
}

function evaluatePublicWebCanaryExecutionIntentAdmissionSimulation(intentResult, policyReference, context = {}) {
  const intentValidationContext = context.intentValidationContext || context;
  const intentValidation = validatePublicWebCanaryExecutionIntentSimulationResult(intentResult, intentValidationContext);
  const policyValidation = validatePublicWebCanaryExecutionIntentAdmissionPolicy(policyReference);
  const reasonCodes = [];

  if (!intentValidation.valid) {
    reasonCodes.push('malformed_intent');
    if (isPlainObject(intentResult) && intentResult.capability !== PUBLIC_WEB_CANARY_CAPABILITY) reasonCodes.push('unsupported_capability');
    if (intentValidation.errors.includes('intent_fingerprint_mismatch')) reasonCodes.push('intent_fingerprint_mismatch');
    if (intentValidation.errors.includes('intent_context_mismatch')) reasonCodes.push('parent_reference_mismatch');
    if (intentValidation.errors.some((error) => error.includes('authority_'))) reasonCodes.push('authority_escalation_detected');
    if (intentValidation.errors.some((error) => error.includes('scope_') || error.includes('tenant') || error.includes('organization') || error.includes('project'))) {
      reasonCodes.push('isolation_boundary_mismatch');
    }
  }

  if (!policyValidation.valid) reasonCodes.push(...policyValidation.errors);

  if (intentValidation.valid) reasonCodes.push(...collectIntentAuthorityFailures(intentResult));

  const policy = policyValidation.valid ? policySummary(policyReference) : nullPolicySummary(policyReference);
  const target = { target_class: policy.target_class };
  const environment = { admission_environment: policy.admission_environment };

  if (policyValidation.valid && intentValidation.valid) {
    if (policy.supported_capability !== intentResult.capability) reasonCodes.push('unsupported_capability');
    if (policy.target_class !== 'PUBLIC_WEB_CANARY_SIMULATED_HANDOFF') reasonCodes.push('unsupported_target');
    if (policy.admission_environment !== 'SIMULATION_ONLY') reasonCodes.push('unsupported_environment');
    if (intentResult.simulation_mode !== true || intentResult.production_blocked !== true || intentResult.evidence.parent_validated !== true) {
      reasonCodes.push('simulation_boundary_required');
    }
  }

  const admitted = reasonCodes.length === 0;
  const finalReasonCodes = admitted ? [ADMITTED_REASON_CODE] : uniqueSorted([...reasonCodes, 'fail_closed']);
  return buildResult({
    admitted,
    status: admitted ? 'PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMITTED_SIMULATION' : statusFor(finalReasonCodes),
    reasonCodes: finalReasonCodes,
    identity: intentValidation.valid ? identityFromIntent(intentResult) : nullIdentity(),
    scope: intentValidation.valid ? scopeFromIntent(intentResult) : nullScope(),
    parent: intentValidation.valid ? parentFromIntent(intentResult) : nullParent(),
    policy,
    target,
    environment,
    intentCreationSeen: intentValidation.valid && intentResult.authority.intent_created === true
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

function validateStringFields(value, fields, prefix, errors) {
  for (const field of fields) {
    if (!isNonEmptyString(value[field])) errors.push(`${prefix}_${field}_invalid`);
  }
}

function validatePublicWebCanaryExecutionIntentAdmissionSimulationResult(result, context = {}) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['admission_result_must_be_object'] };
  exactFields(result, PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_RESULT_FIELDS, 'admission_result', errors);
  if (typeof result.ok !== 'boolean') errors.push('ok_must_be_boolean');
  if (!PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_STATUSES.includes(result.status)) errors.push('status_invalid');
  if (!PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_DECISIONS.includes(result.decision)) errors.push('decision_invalid');
  if (!PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_NEXT_STATES.includes(result.next_state)) errors.push('next_state_invalid');
  const expectedOutcome = outcomeForStatus(result.status);
  if (result.decision !== expectedOutcome.decision) errors.push('decision_status_mismatch');
  if (result.next_state !== expectedOutcome.next_state) errors.push('next_state_status_mismatch');
  if (!Array.isArray(result.reason_codes) || result.reason_codes.some((reason) => !isNonEmptyString(reason))) errors.push('reason_codes_invalid');
  if (result.capability !== PUBLIC_WEB_CANARY_CAPABILITY) errors.push('capability_invalid');
  if (!isNonEmptyString(result.admission_id)) errors.push('admission_id_invalid');
  if (!isNonEmptyString(result.admission_fingerprint)) errors.push('admission_fingerprint_invalid');
  if (result.validator_version !== PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_SIMULATION_VALIDATOR_VERSION) {
    errors.push('validator_version_invalid');
  }

  const hasIdentity = validateObjectFields(result.identity, IDENTITY_FIELDS, 'identity', errors);
  const hasScope = validateObjectFields(result.scope, SCOPE_FIELDS, 'scope', errors);
  const hasParent = validateObjectFields(result.parent, PARENT_FIELDS, 'parent', errors);
  const hasPolicy = validateObjectFields(result.policy, POLICY_SUMMARY_FIELDS, 'policy', errors);
  const hasTarget = validateObjectFields(result.target, TARGET_FIELDS, 'target', errors);
  const hasEnvironment = validateObjectFields(result.environment, ENVIRONMENT_FIELDS, 'environment', errors);
  const hasAuthority = validateObjectFields(result.authority_boundary, AUTHORITY_BOUNDARY_FIELDS, 'authority_boundary', errors);
  const hasEvidence = validateObjectFields(result.evidence, EVIDENCE_FIELDS, 'evidence', errors);
  const hasAudit = validateObjectFields(result.audit, AUDIT_FIELDS, 'audit', errors);

  if (result.ok === true) {
    if (result.status !== 'PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMITTED_SIMULATION') errors.push('ok_status_mismatch');
    if (!valuesEqual(result.reason_codes, [ADMITTED_REASON_CODE])) errors.push('ok_reason_codes_mismatch');
    if (hasIdentity) validateStringFields(result.identity, IDENTITY_FIELDS, 'identity', errors);
    if (hasScope) validateStringFields(result.scope, SCOPE_FIELDS, 'scope', errors);
    if (hasParent) validateStringFields(result.parent, PARENT_FIELDS, 'parent', errors);
    if (hasPolicy) validateStringFields(result.policy, POLICY_SUMMARY_FIELDS.filter((field) => field !== 'admission_policy_version'), 'policy', errors);
  } else {
    if (result.status === 'PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMITTED_SIMULATION') errors.push('blocked_status_mismatch');
    if (!result.reason_codes.includes('fail_closed')) errors.push('blocked_fail_closed_required');
  }

  if (hasAuthority) {
    if (typeof result.authority_boundary.intent_creation_seen !== 'boolean') errors.push('authority_boundary_intent_creation_seen_must_be_boolean');
    if (result.authority_boundary.admission_simulated !== (result.ok === true)) errors.push('authority_boundary_admission_simulated_mismatch');
    if (result.authority_boundary.future_authority_required !== true) errors.push('authority_boundary_future_authority_required');
    if (result.authority_boundary.later_authority !== 'NONE') errors.push('authority_boundary_later_authority_must_be_none');
    if (result.authority_boundary.operational_effect !== 'ZERO') errors.push('authority_boundary_operational_effect_must_be_zero');
  }

  if (hasIdentity && result.identity.capability !== result.capability) errors.push('identity_capability_mismatch');
  if (hasTarget && hasPolicy && result.target.target_class !== result.policy.target_class) errors.push('target_policy_mismatch');
  if (hasEnvironment && hasPolicy && result.environment.admission_environment !== result.policy.admission_environment) errors.push('environment_policy_mismatch');
  if (hasEvidence) {
    if (result.evidence.simulation_only !== true) errors.push('evidence_simulation_only_required');
    if (result.evidence.production_effect !== 'ZERO') errors.push('evidence_production_effect_must_be_zero');
    if (hasParent && result.evidence.parent_intent_fingerprint !== result.parent.intent_fingerprint) errors.push('evidence_parent_intent_fingerprint_mismatch');
    if (hasPolicy && result.evidence.policy_fingerprint !== result.policy.admission_policy_fingerprint) errors.push('evidence_policy_fingerprint_mismatch');
  }
  if (hasAudit) {
    if (!valuesEqual(result.audit.reason_codes, result.reason_codes)) errors.push('audit_reason_codes_mismatch');
    if (hasIdentity) {
      for (const field of ['request_id', 'correlation_id', 'trace_id', 'capability']) {
        if (result.audit[field] !== result.identity[field]) errors.push(`audit_${field}_mismatch`);
      }
    }
    if (hasParent) {
      if (result.audit.intent_id !== result.parent.intent_id) errors.push('audit_intent_id_mismatch');
      if (result.audit.intent_fingerprint !== result.parent.intent_fingerprint) errors.push('audit_intent_fingerprint_mismatch');
    }
    if (hasPolicy) {
      if (result.audit.admission_policy_id !== result.policy.admission_policy_id) errors.push('audit_policy_id_mismatch');
      if (result.audit.admission_policy_fingerprint !== result.policy.admission_policy_fingerprint) errors.push('audit_policy_fingerprint_mismatch');
    }
    if (result.audit.decision !== result.decision) errors.push('audit_decision_mismatch');
    if (result.audit.next_state !== result.next_state) errors.push('audit_next_state_mismatch');
    if (result.audit.simulation_only !== true) errors.push('audit_simulation_only_required');
    if (result.audit.production_effect !== 'ZERO') errors.push('audit_production_effect_must_be_zero');
  }

  if (hasIdentity && hasScope && hasParent && hasPolicy && hasTarget && hasEnvironment && hasAuthority && hasEvidence && hasAudit) {
    const material = buildAdmissionFingerprintMaterial({
      identity: result.identity,
      scope: result.scope,
      parent: result.parent,
      policy: result.policy,
      target: result.target,
      environment: result.environment,
      authorityBoundary: result.authority_boundary,
      status: result.status,
      decision: result.decision,
      nextState: result.next_state,
      reasonCodes: result.reason_codes
    });
    if (result.evidence.admission_material_fingerprint !== computeAdmissionFingerprint(material)) {
      errors.push('admission_material_fingerprint_mismatch');
    }
    const expectedAdmissionId = `public_web_canary_execution_intent_admission:${computeAdmissionFingerprint({ material, evidence: result.evidence })}`;
    if (result.admission_id !== expectedAdmissionId) errors.push('admission_id_mismatch');
    if (result.admission_fingerprint !== computeAdmissionFingerprint({ material, evidence: result.evidence, audit: result.audit })) {
      errors.push('admission_fingerprint_mismatch');
    }
  }

  if (!isPlainObject(context) || !Object.prototype.hasOwnProperty.call(context, 'intentResult') || !Object.prototype.hasOwnProperty.call(context, 'policyReference')) {
    errors.push('admission_validation_context_required');
  } else {
    const expected = evaluatePublicWebCanaryExecutionIntentAdmissionSimulation(context.intentResult, context.policyReference, {
      intentValidationContext: context.intentValidationContext
    });
    if (!valuesEqual(result, expected)) errors.push('admission_context_mismatch');
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
  ADMITTED_REASON_CODE,
  DEFAULT_OUTCOME,
  PUBLIC_WEB_CANARY_ADMISSION_ENVIRONMENTS,
  PUBLIC_WEB_CANARY_ADMISSION_TARGET_CLASSES,
  PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_DECISIONS,
  PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_NEXT_STATES,
  PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_POLICY_FIELDS,
  PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_POLICY_VALIDATOR_VERSION,
  PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_RESULT_FIELDS,
  PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_SIMULATION_VALIDATOR_VERSION,
  PUBLIC_WEB_CANARY_EXECUTION_INTENT_ADMISSION_STATUSES,
  PUBLIC_WEB_CANARY_REQUIRED_NEXT_AUTHORITY_STAGES,
  STATUS_OUTCOME_MAP,
  buildAdmissionFingerprintMaterial,
  buildPolicyFingerprintMaterial,
  buildPublicWebCanaryExecutionIntentAdmissionPolicy,
  computeAdmissionFingerprint,
  computeAdmissionPolicyFingerprint,
  evaluatePublicWebCanaryExecutionIntentAdmissionSimulation,
  validatePublicWebCanaryExecutionIntentAdmissionPolicy,
  validatePublicWebCanaryExecutionIntentAdmissionSimulationResult
};
