'use strict';

const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { findCanaryForbiddenFields } = require('./public-web-canary-session-contract');
const {
  PUBLIC_WEB_CANARY_CAPABILITY,
  SAFE_FLAGS,
  computeHandoffFingerprint,
  validatePublicWebCanaryQueuedSimulationResult
} = require('./public-web-canary-queued-simulation-boundary');

const PUBLIC_WEB_CANARY_EXECUTION_INTENT_SIMULATION_VALIDATOR_VERSION = 'public_web_canary_execution_intent_simulation_validator_v1';

const PUBLIC_WEB_CANARY_EXECUTION_INTENT_SIMULATION_STATUSES = Object.freeze([
  'PUBLIC_WEB_CANARY_EXECUTION_INTENT_SIMULATED',
  'PUBLIC_WEB_CANARY_EXECUTION_INTENT_BLOCKED',
  'PUBLIC_WEB_CANARY_EXECUTION_INTENT_NOT_SUPPORTED'
]);

const PUBLIC_WEB_CANARY_EXECUTION_INTENT_SIMULATION_RESULT_FIELDS = Object.freeze([
  'ok',
  'status',
  'reason_codes',
  'capability',
  'simulation_mode',
  'production_blocked',
  'executed',
  'runtime_enabled',
  'network_used',
  'real_provider_called',
  'secret_resolved',
  'can_trigger_real_execution',
  'intent_id',
  'intent_fingerprint',
  'identity',
  'scope',
  'parent',
  'authority',
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
  'handoff_fingerprint',
  'handoff_status',
  'handoff_validator_version',
  'dispatch_package_id',
  'dispatch_fingerprint',
  'dispatch_digest',
  'worker_assignment_package_id',
  'worker_assignment_fingerprint',
  'queue_placement_package_id',
  'trial_id',
  'plan_hash',
  'preflight_evidence_hash',
  'dry_run_evidence_hash'
]);

const AUTHORITY_FIELDS = Object.freeze([
  'intent_created',
  'admission_granted',
  'execution_authorized',
  'provider_authorized',
  'network_authorized',
  'secret_resolution_authorized',
  'execution_started',
  'runtime_enabled',
  'worker_started',
  'queue_mutated',
  'persistence_written',
  'real_canary_executed',
  'can_trigger_real_execution'
]);

const EVIDENCE_FIELDS = Object.freeze([
  'parent_validated',
  'handoff_fingerprint',
  'intent_input_fingerprint',
  'authority_fingerprint',
  'simulation_only',
  'production_effect'
]);

const AUDIT_FIELDS = Object.freeze([
  'event_name',
  'capability',
  'request_id',
  'correlation_id',
  'trace_id',
  'intent_id',
  'parent_handoff_fingerprint',
  'dispatch_package_id',
  'reason_codes',
  'authority_fingerprint',
  'evidence_fingerprint',
  'simulation_mode',
  'production_blocked',
  'executed',
  'runtime_enabled',
  'network_used',
  'real_provider_called',
  'secret_resolved',
  'can_trigger_real_execution'
]);

const INTENT_SAFE_FLAGS = Object.freeze({
  ...SAFE_FLAGS,
  can_trigger_real_execution: false
});

function computeIntentFingerprint(payload) {
  return computeCanonicalContentDigest(payload);
}

function valuesEqual(left, right) {
  try {
    return stablePayload(left) === stablePayload(right);
  } catch (_error) {
    return false;
  }
}

function nullIdentity(capability = PUBLIC_WEB_CANARY_CAPABILITY) {
  return {
    request_id: null,
    correlation_id: null,
    trace_id: null,
    capability
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
    handoff_fingerprint: null,
    handoff_status: null,
    handoff_validator_version: null,
    dispatch_package_id: null,
    dispatch_fingerprint: null,
    dispatch_digest: null,
    worker_assignment_package_id: null,
    worker_assignment_fingerprint: null,
    queue_placement_package_id: null,
    trial_id: null,
    plan_hash: null,
    preflight_evidence_hash: null,
    dry_run_evidence_hash: null
  };
}

function buildAuthority(intentCreated) {
  return {
    intent_created: intentCreated === true,
    admission_granted: false,
    execution_authorized: false,
    provider_authorized: false,
    network_authorized: false,
    secret_resolution_authorized: false,
    execution_started: false,
    runtime_enabled: false,
    worker_started: false,
    queue_mutated: false,
    persistence_written: false,
    real_canary_executed: false,
    can_trigger_real_execution: false
  };
}

function extractScopeFromContext(context) {
  const dispatchPackage = context && context.envelope && context.envelope.dispatch && context.envelope.dispatch.package;
  if (!isPlainObject(dispatchPackage)) return nullScope();
  return {
    tenant_id: dispatchPackage.tenant_id || null,
    organization_id: dispatchPackage.organization_id || null,
    project_id: dispatchPackage.project_id || null
  };
}

function buildIdentityFromHandoff(handoffResult) {
  const pipeline = handoffResult.pipeline;
  return {
    request_id: pipeline.request_id,
    correlation_id: pipeline.correlation_id,
    trace_id: pipeline.trace_id,
    capability: handoffResult.capability
  };
}

function buildParentFromHandoff(handoffResult) {
  return {
    handoff_fingerprint: handoffResult.handoff_fingerprint,
    handoff_status: handoffResult.status,
    handoff_validator_version: handoffResult.validator_version,
    dispatch_package_id: handoffResult.pipeline.dispatch_package_id,
    dispatch_fingerprint: handoffResult.pipeline.dispatch_fingerprint,
    dispatch_digest: handoffResult.pipeline.dispatch_digest,
    worker_assignment_package_id: handoffResult.pipeline.worker_assignment_package_id,
    worker_assignment_fingerprint: handoffResult.pipeline.worker_assignment_fingerprint,
    queue_placement_package_id: handoffResult.pipeline.queue_placement_package_id,
    trial_id: handoffResult.evidence.trial_id,
    plan_hash: handoffResult.evidence.plan_hash,
    preflight_evidence_hash: handoffResult.evidence.preflight_evidence_hash,
    dry_run_evidence_hash: handoffResult.evidence.dry_run_evidence_hash
  };
}

function buildIntentFingerprintMaterial({ identity, scope, parent, authority }) {
  return {
    validator_version: PUBLIC_WEB_CANARY_EXECUTION_INTENT_SIMULATION_VALIDATOR_VERSION,
    capability: identity.capability,
    request_id: identity.request_id,
    correlation_id: identity.correlation_id,
    trace_id: identity.trace_id,
    tenant_id: scope.tenant_id,
    organization_id: scope.organization_id,
    project_id: scope.project_id,
    parent_handoff_fingerprint: parent.handoff_fingerprint,
    parent_handoff_status: parent.handoff_status,
    parent_handoff_validator_version: parent.handoff_validator_version,
    dispatch_package_id: parent.dispatch_package_id,
    dispatch_fingerprint: parent.dispatch_fingerprint,
    dispatch_digest: parent.dispatch_digest,
    worker_assignment_package_id: parent.worker_assignment_package_id,
    worker_assignment_fingerprint: parent.worker_assignment_fingerprint,
    queue_placement_package_id: parent.queue_placement_package_id,
    trial_id: parent.trial_id,
    plan_hash: parent.plan_hash,
    preflight_evidence_hash: parent.preflight_evidence_hash,
    dry_run_evidence_hash: parent.dry_run_evidence_hash,
    intent_created: authority.intent_created,
    admission_granted: authority.admission_granted,
    execution_authorized: authority.execution_authorized,
    provider_authorized: authority.provider_authorized,
    network_authorized: authority.network_authorized,
    secret_resolution_authorized: authority.secret_resolution_authorized,
    execution_started: authority.execution_started,
    runtime_enabled: authority.runtime_enabled,
    worker_started: authority.worker_started,
    queue_mutated: authority.queue_mutated,
    persistence_written: authority.persistence_written,
    real_canary_executed: authority.real_canary_executed,
    can_trigger_real_execution: authority.can_trigger_real_execution,
    simulation_mode: INTENT_SAFE_FLAGS.simulation_mode,
    production_blocked: INTENT_SAFE_FLAGS.production_blocked,
    executed: INTENT_SAFE_FLAGS.executed,
    network_used: INTENT_SAFE_FLAGS.network_used,
    real_provider_called: INTENT_SAFE_FLAGS.real_provider_called,
    secret_resolved: INTENT_SAFE_FLAGS.secret_resolved
  };
}

function buildEvidence({ parent, authority }) {
  return {
    parent_validated: true,
    handoff_fingerprint: parent.handoff_fingerprint,
    intent_input_fingerprint: computeIntentFingerprint(parent),
    authority_fingerprint: computeIntentFingerprint(authority),
    simulation_only: true,
    production_effect: 'ZERO'
  };
}

function buildAudit({ identity, parent, authority, evidence, intentId, reasonCodes }) {
  return {
    event_name: 'public_web_canary_execution_intent_prepared_simulation',
    capability: identity.capability,
    request_id: identity.request_id,
    correlation_id: identity.correlation_id,
    trace_id: identity.trace_id,
    intent_id: intentId,
    parent_handoff_fingerprint: parent.handoff_fingerprint,
    dispatch_package_id: parent.dispatch_package_id,
    reason_codes: uniqueSorted(reasonCodes),
    authority_fingerprint: computeIntentFingerprint(authority),
    evidence_fingerprint: computeIntentFingerprint(evidence),
    ...INTENT_SAFE_FLAGS
  };
}

function buildResult({ ok, status, reasonCodes, identity, scope, parent }) {
  const authority = buildAuthority(ok === true);
  const evidence = ok === true
    ? buildEvidence({ parent, authority })
    : {
        parent_validated: false,
        handoff_fingerprint: parent.handoff_fingerprint,
        intent_input_fingerprint: computeIntentFingerprint(parent),
        authority_fingerprint: computeIntentFingerprint(authority),
        simulation_only: true,
        production_effect: 'ZERO'
      };
  const material = buildIntentFingerprintMaterial({ identity, scope, parent, authority });
  const intentFingerprint = computeIntentFingerprint({
    material,
    evidence
  });
  const intentId = `public_web_canary_execution_intent:${intentFingerprint}`;
  const audit = buildAudit({
    identity,
    parent,
    authority,
    evidence,
    intentId,
    reasonCodes
  });
  const result = {
    ok,
    status,
    reason_codes: uniqueSorted(reasonCodes),
    capability: PUBLIC_WEB_CANARY_CAPABILITY,
    ...INTENT_SAFE_FLAGS,
    intent_id: intentId,
    intent_fingerprint: computeIntentFingerprint({
      material,
      evidence,
      audit
    }),
    identity,
    scope,
    parent,
    authority,
    evidence,
    audit,
    validator_version: PUBLIC_WEB_CANARY_EXECUTION_INTENT_SIMULATION_VALIDATOR_VERSION
  };
  return cloneFrozen(result);
}

function blockedStatusFor(reasonCodes) {
  return reasonCodes.includes('capability_not_supported')
    ? 'PUBLIC_WEB_CANARY_EXECUTION_INTENT_NOT_SUPPORTED'
    : 'PUBLIC_WEB_CANARY_EXECUTION_INTENT_BLOCKED';
}

function validateParentHandoff(handoffResult, context) {
  const validation = validatePublicWebCanaryQueuedSimulationResult(handoffResult, context);
  const errors = validation.valid ? [] : validation.errors.map((error) => `parent_${error}`);
  if (validation.valid && handoffResult.ok !== true) errors.push('parent_handoff_not_successful');
  return uniqueSorted(errors);
}

function evaluatePublicWebCanaryExecutionIntentSimulation(handoffResult, context = {}) {
  const parentErrors = validateParentHandoff(handoffResult, context);
  if (parentErrors.length > 0) {
    const capability = isPlainObject(handoffResult) && isNonEmptyString(handoffResult.capability)
      ? handoffResult.capability
      : PUBLIC_WEB_CANARY_CAPABILITY;
    const reasonCodes = capability === PUBLIC_WEB_CANARY_CAPABILITY
      ? parentErrors
      : uniqueSorted([...parentErrors, 'capability_not_supported']);
    return buildResult({
      ok: false,
      status: blockedStatusFor(reasonCodes),
      reasonCodes,
      identity: nullIdentity(),
      scope: extractScopeFromContext(context),
      parent: nullParent()
    });
  }

  const identity = buildIdentityFromHandoff(handoffResult);
  const scope = extractScopeFromContext(context);
  const parent = buildParentFromHandoff(handoffResult);
  return buildResult({
    ok: true,
    status: 'PUBLIC_WEB_CANARY_EXECUTION_INTENT_SIMULATED',
    reasonCodes: [],
    identity,
    scope,
    parent
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

function validateAuthority(authority, errors) {
  if (!validateObjectFields(authority, AUTHORITY_FIELDS, 'authority', errors)) return;
  if (authority.intent_created !== true && authority.intent_created !== false) errors.push('authority_intent_created_must_be_boolean');
  for (const field of AUTHORITY_FIELDS.filter((field) => field !== 'intent_created')) {
    if (authority[field] !== false) errors.push(`authority_${field}_must_be_false`);
  }
}

function validatePublicWebCanaryExecutionIntentSimulationResult(result, context = {}) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['public_web_canary_execution_intent_result_must_be_object'] };
  exactFields(result, PUBLIC_WEB_CANARY_EXECUTION_INTENT_SIMULATION_RESULT_FIELDS, 'public_web_canary_execution_intent_result', errors);
  if (typeof result.ok !== 'boolean') errors.push('ok_must_be_boolean');
  if (!PUBLIC_WEB_CANARY_EXECUTION_INTENT_SIMULATION_STATUSES.includes(result.status)) errors.push('status_invalid');
  if (!Array.isArray(result.reason_codes) || result.reason_codes.some((reason) => !isNonEmptyString(reason))) errors.push('reason_codes_invalid');
  if (result.capability !== PUBLIC_WEB_CANARY_CAPABILITY) errors.push('capability_invalid');
  for (const [field, expected] of Object.entries(INTENT_SAFE_FLAGS)) {
    if (result[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (!isNonEmptyString(result.intent_id)) errors.push('intent_id_invalid');
  if (!isNonEmptyString(result.intent_fingerprint)) errors.push('intent_fingerprint_invalid');
  if (result.validator_version !== PUBLIC_WEB_CANARY_EXECUTION_INTENT_SIMULATION_VALIDATOR_VERSION) errors.push('validator_version_invalid');

  const hasIdentity = validateObjectFields(result.identity, IDENTITY_FIELDS, 'identity', errors);
  const hasScope = validateObjectFields(result.scope, SCOPE_FIELDS, 'scope', errors);
  const hasParent = validateObjectFields(result.parent, PARENT_FIELDS, 'parent', errors);
  const hasEvidence = validateObjectFields(result.evidence, EVIDENCE_FIELDS, 'evidence', errors);
  const hasAudit = validateObjectFields(result.audit, AUDIT_FIELDS, 'audit', errors);
  validateAuthority(result.authority, errors);

  if (result.ok === true) {
    if (result.status !== 'PUBLIC_WEB_CANARY_EXECUTION_INTENT_SIMULATED') errors.push('ok_status_mismatch');
    if (result.reason_codes.length !== 0) errors.push('ok_reason_codes_must_be_empty');
    if (hasIdentity) validateStringFields(result.identity, IDENTITY_FIELDS, 'identity', errors);
    if (hasScope) validateStringFields(result.scope, SCOPE_FIELDS, 'scope', errors);
    if (hasParent) validateStringFields(result.parent, PARENT_FIELDS, 'parent', errors);
    if (result.authority && result.authority.intent_created !== true) errors.push('authority_intent_created_required');
    if (hasEvidence && result.evidence.parent_validated !== true) errors.push('evidence_parent_validated_required');
  } else {
    if (result.status === 'PUBLIC_WEB_CANARY_EXECUTION_INTENT_SIMULATED') errors.push('blocked_status_mismatch');
    if (result.reason_codes.length === 0) errors.push('blocked_reason_codes_required');
    if (result.authority && result.authority.intent_created !== false) errors.push('blocked_intent_created_must_be_false');
    if (hasEvidence && result.evidence.parent_validated !== false) errors.push('blocked_parent_validated_must_be_false');
  }

  if (hasIdentity && result.identity.capability !== result.capability) errors.push('identity_capability_mismatch');
  if (hasParent && hasEvidence && result.evidence.handoff_fingerprint !== result.parent.handoff_fingerprint) errors.push('evidence_handoff_fingerprint_mismatch');
  if (hasEvidence && result.evidence.production_effect !== 'ZERO') errors.push('evidence_production_effect_must_be_zero');
  if (hasEvidence && result.evidence.simulation_only !== true) errors.push('evidence_simulation_only_required');
  if (hasAudit) {
    if (!valuesEqual(result.audit.reason_codes, result.reason_codes)) errors.push('audit_reason_codes_mismatch');
    if (hasIdentity) {
      for (const field of ['request_id', 'correlation_id', 'trace_id', 'capability']) {
        if (result.audit[field] !== result.identity[field]) errors.push(`audit_${field}_mismatch`);
      }
    }
    if (hasParent) {
      if (result.audit.parent_handoff_fingerprint !== result.parent.handoff_fingerprint) errors.push('audit_parent_handoff_fingerprint_mismatch');
      if (result.audit.dispatch_package_id !== result.parent.dispatch_package_id) errors.push('audit_dispatch_package_id_mismatch');
    }
    if (result.audit.intent_id !== result.intent_id) errors.push('audit_intent_id_mismatch');
    for (const [field, expected] of Object.entries(INTENT_SAFE_FLAGS)) {
      if (result.audit[field] !== expected) errors.push(`audit_${field}_must_be_${String(expected)}`);
    }
  }

  if (hasEvidence && hasParent && result.evidence.intent_input_fingerprint !== computeIntentFingerprint(result.parent)) errors.push('evidence_intent_input_fingerprint_mismatch');
  if (hasEvidence && result.authority && result.evidence.authority_fingerprint !== computeIntentFingerprint(result.authority)) errors.push('evidence_authority_fingerprint_mismatch');
  if (hasAudit && hasEvidence && result.audit.evidence_fingerprint !== computeIntentFingerprint(result.evidence)) errors.push('audit_evidence_fingerprint_mismatch');
  if (hasAudit && result.authority && result.audit.authority_fingerprint !== computeIntentFingerprint(result.authority)) errors.push('audit_authority_fingerprint_mismatch');

  if (hasIdentity && hasScope && hasParent && result.authority && hasEvidence && hasAudit) {
    const material = buildIntentFingerprintMaterial({
      identity: result.identity,
      scope: result.scope,
      parent: result.parent,
      authority: result.authority
    });
    const intentFingerprint = computeIntentFingerprint({ material, evidence: result.evidence, audit: result.audit });
    if (intentFingerprint !== result.intent_fingerprint) errors.push('intent_fingerprint_mismatch');
    if (result.intent_id !== `public_web_canary_execution_intent:${computeIntentFingerprint({ material, evidence: result.evidence })}`) {
      errors.push('intent_id_mismatch');
    }
  }

  if (!isPlainObject(context) || !Object.prototype.hasOwnProperty.call(context, 'handoffResult')) {
    errors.push('intent_validation_context_required');
  } else {
    const expected = evaluatePublicWebCanaryExecutionIntentSimulation(context.handoffResult, {
      envelope: context.envelope,
      preparedTrial: context.preparedTrial || context.canaryPreparation
    });
    if (!valuesEqual(result, expected)) errors.push('intent_context_mismatch');
  }
  if (findCanaryForbiddenFields(result).length > 0) errors.push('forbidden_field_detected');
  try {
    stablePayload(result);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  PUBLIC_WEB_CANARY_EXECUTION_INTENT_SIMULATION_RESULT_FIELDS,
  PUBLIC_WEB_CANARY_EXECUTION_INTENT_SIMULATION_STATUSES,
  PUBLIC_WEB_CANARY_EXECUTION_INTENT_SIMULATION_VALIDATOR_VERSION,
  INTENT_SAFE_FLAGS,
  buildExecutionIntentFingerprintMaterial: buildIntentFingerprintMaterial,
  computeIntentFingerprint,
  evaluatePublicWebCanaryExecutionIntentSimulation,
  validatePublicWebCanaryExecutionIntentSimulationResult
};
