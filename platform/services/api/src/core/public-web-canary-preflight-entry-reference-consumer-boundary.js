'use strict';

const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_VALIDATOR_VERSION,
  validatePublicWebCanaryPreflightEntryReferenceBoundaryResult
} = require('./public-web-canary-preflight-entry-reference-boundary');

const PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_CONSUMER_VALIDATOR_VERSION =
  'public_web_canary_preflight_entry_reference_consumer_boundary_v1';

const PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_CONSUMER_STATUSES = Object.freeze([
  'PUBLIC_WEB_CANARY_PREFLIGHT_REQUEST_PREPARED_SIMULATION',
  'PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_CONSUMER_BLOCKED',
  'PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_CONSUMER_VALIDATION_FAILED'
]);

const PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_CONSUMER_DECISIONS = Object.freeze([
  'PREPARE_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT_REQUEST',
  'BLOCKED'
]);

const PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_CONSUMER_NEXT_STATES = Object.freeze([
  'WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_REQUEST_CONSUMER',
  'BLOCKED_REFERENCE'
]);

const SUCCESS = Object.freeze({
  status: 'PUBLIC_WEB_CANARY_PREFLIGHT_REQUEST_PREPARED_SIMULATION',
  decision: 'PREPARE_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT_REQUEST',
  next_state: 'WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_REQUEST_CONSUMER'
});

const BLOCKED = Object.freeze({
  decision: 'BLOCKED',
  next_state: 'BLOCKED_REFERENCE'
});

const REFERENCE_SUCCESS_REASON =
  'public_web_canary_preflight_entry_reference_prepared_non_side_effect_only';

const SAFE_FALSE_AUTHORITY_FIELDS = Object.freeze([
  'preflight_execution',
  'dry_run_execution',
  'operator_confirmation',
  'trial_execution',
  'provider_called',
  'external_network_used',
  'secret_resolved',
  'runtime_execution',
  'worker_execution',
  'queue_mutation',
  'scheduler_mutation',
  'dispatch_execution',
  'operational_persistence',
  'real_execution_authorized'
]);

const READINESS_REFERENCE_FIELDS = Object.freeze([
  'readiness_id',
  'readiness_fingerprint',
  'readiness_validator_version',
  'trial_id',
  'plan_hash',
  'preparation_eligibility_id',
  'tenant_id'
]);

function digest(value) {
  return computeCanonicalContentDigest(value);
}

function valuesEqual(left, right) {
  try {
    return stablePayload(left) === stablePayload(right);
  } catch (_error) {
    return false;
  }
}

function referenceMaterial(referenceResult) {
  const safe = isPlainObject(referenceResult) ? referenceResult : {};
  return {
    validator_version: safe.validator_version,
    status: safe.status,
    decision: safe.decision,
    next_state: safe.next_state,
    reason_codes: Array.isArray(safe.reason_codes) ? safe.reason_codes : [],
    entry_reference: isPlainObject(safe.entry_reference) ? safe.entry_reference : {},
    authority_boundary: isPlainObject(safe.authority_boundary) ? safe.authority_boundary : {},
    simulated: true,
    executed: false,
    production_effect: 'ZERO'
  };
}

function expectedReferenceIdentity(referenceResult) {
  const material = referenceMaterial(referenceResult);
  const evidence = isPlainObject(referenceResult && referenceResult.evidence)
    ? referenceResult.evidence
    : {};
  const audit = isPlainObject(referenceResult && referenceResult.audit)
    ? referenceResult.audit
    : {};
  return {
    entry_reference_id:
      `public_web_canary_preflight_entry_reference:${digest({ material, evidence })}`,
    entry_reference_fingerprint: digest({ material, evidence, audit })
  };
}

function safeEntryReferenceBinding(referenceResult) {
  const safe = isPlainObject(referenceResult) ? referenceResult : {};
  const entryReference = isPlainObject(safe.entry_reference) ? safe.entry_reference : {};
  return {
    entry_reference_id: isNonEmptyString(safe.entry_reference_id)
      ? safe.entry_reference_id
      : null,
    entry_reference_fingerprint: isNonEmptyString(safe.entry_reference_fingerprint)
      ? safe.entry_reference_fingerprint
      : null,
    entry_reference_validator_version: isNonEmptyString(safe.validator_version)
      ? safe.validator_version
      : null,
    entry_id: isNonEmptyString(entryReference.entry_id) ? entryReference.entry_id : null,
    entry_fingerprint: isNonEmptyString(entryReference.entry_fingerprint)
      ? entryReference.entry_fingerprint
      : null,
    entry_validator_version: isNonEmptyString(entryReference.entry_validator_version)
      ? entryReference.entry_validator_version
      : null,
    readiness_id: isNonEmptyString(entryReference.readiness_id)
      ? entryReference.readiness_id
      : null,
    readiness_fingerprint: isNonEmptyString(entryReference.readiness_fingerprint)
      ? entryReference.readiness_fingerprint
      : null,
    readiness_validator_version: isNonEmptyString(entryReference.readiness_validator_version)
      ? entryReference.readiness_validator_version
      : null,
    trial_id: isNonEmptyString(entryReference.trial_id) ? entryReference.trial_id : null,
    plan_hash: isNonEmptyString(entryReference.plan_hash) ? entryReference.plan_hash : null,
    preparation_eligibility_id: isNonEmptyString(entryReference.preparation_eligibility_id)
      ? entryReference.preparation_eligibility_id
      : null,
    tenant_id: isNonEmptyString(entryReference.tenant_id) ? entryReference.tenant_id : null
  };
}

function collectReferenceFailures(referenceResult, entryResult) {
  const failures = [];
  if (!isPlainObject(referenceResult)) return ['preflight_entry_reference_result_missing'];

  if (referenceResult.ok !== true) failures.push('preflight_entry_reference_not_ok');
  if (referenceResult.status !== 'PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_PREPARED_SIMULATION') {
    failures.push('preflight_entry_reference_status_not_prepared');
  }
  if (
    referenceResult.decision !==
    'PREPARE_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT_ENTRY_REFERENCE'
  ) {
    failures.push('preflight_entry_reference_decision_not_prepare');
  }
  if (referenceResult.next_state !== 'WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_CONSUMER') {
    failures.push('preflight_entry_reference_next_state_not_waiting_consumer');
  }
  if (
    referenceResult.validator_version !==
    PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_VALIDATOR_VERSION
  ) {
    failures.push('preflight_entry_reference_validator_version_mismatch');
  }
  if (!valuesEqual(referenceResult.reason_codes, [REFERENCE_SUCCESS_REASON])) {
    failures.push('preflight_entry_reference_reason_codes_mismatch');
  }

  for (const legacyField of [
    'ready',
    'authorized',
    'canary_authorized',
    'execution_authorized',
    'ready_for_real_execution',
    'can_trigger_real_execution'
  ]) {
    if (Object.prototype.hasOwnProperty.call(referenceResult, legacyField)) {
      failures.push(`legacy_preflight_entry_reference_field_forbidden::${legacyField}`);
    }
  }

  if (!isPlainObject(entryResult)) {
    failures.push('preflight_entry_result_missing');
  } else {
    const validation =
      validatePublicWebCanaryPreflightEntryReferenceBoundaryResult(referenceResult, entryResult);
    if (!validation.valid) {
      for (const error of validation.errors) {
        failures.push(`preflight_entry_reference_validation::${error}`);
      }
    }
  }

  if (!isNonEmptyString(referenceResult.entry_reference_id)) {
    failures.push('preflight_entry_reference_id_invalid');
  }
  if (!isNonEmptyString(referenceResult.entry_reference_fingerprint)) {
    failures.push('preflight_entry_reference_fingerprint_invalid');
  }

  const expectedIdentity = expectedReferenceIdentity(referenceResult);
  if (referenceResult.entry_reference_id !== expectedIdentity.entry_reference_id) {
    failures.push('preflight_entry_reference_id_mismatch');
  }
  if (referenceResult.entry_reference_fingerprint !== expectedIdentity.entry_reference_fingerprint) {
    failures.push('preflight_entry_reference_fingerprint_mismatch');
  }

  const entryReference = isPlainObject(referenceResult.entry_reference)
    ? referenceResult.entry_reference
    : null;
  if (!entryReference) {
    failures.push('preflight_entry_reference_binding_missing');
  } else {
    for (const field of [
      'entry_id',
      'entry_fingerprint',
      'entry_validator_version',
      ...READINESS_REFERENCE_FIELDS
    ]) {
      if (!isNonEmptyString(entryReference[field])) {
        failures.push(`preflight_entry_reference_binding_${field}_invalid`);
      }
    }
  }

  if (isPlainObject(entryResult) && entryReference) {
    if (entryReference.entry_id !== entryResult.entry_id) {
      failures.push('preflight_entry_reference_entry_id_mismatch');
    }
    if (entryReference.entry_fingerprint !== entryResult.entry_fingerprint) {
      failures.push('preflight_entry_reference_entry_fingerprint_mismatch');
    }
    if (entryReference.entry_validator_version !== entryResult.validator_version) {
      failures.push('preflight_entry_reference_entry_validator_version_mismatch');
    }

    const readiness = isPlainObject(entryResult.readiness_reference)
      ? entryResult.readiness_reference
      : null;
    if (!readiness) {
      failures.push('preflight_entry_readiness_reference_missing');
    } else {
      for (const field of READINESS_REFERENCE_FIELDS) {
        if (entryReference[field] !== readiness[field]) {
          failures.push(`preflight_entry_reference_${field}_mismatch`);
        }
      }
      if (readiness.status !== 'PUBLIC_WEB_CANARY_PREFLIGHT_READY') {
        failures.push('preflight_entry_readiness_status_mismatch');
      }
      if (readiness.decision !== 'ENTER_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT') {
        failures.push('preflight_entry_readiness_decision_mismatch');
      }
      if (readiness.next_state !== 'WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_RUN') {
        failures.push('preflight_entry_readiness_next_state_mismatch');
      }
    }
  }

  const authority = isPlainObject(referenceResult.authority_boundary)
    ? referenceResult.authority_boundary
    : null;
  if (!authority) {
    failures.push('preflight_entry_reference_authority_missing');
  } else {
    if (authority.preflight_entry_seen !== true) {
      failures.push('preflight_entry_reference_preflight_entry_seen_required');
    }
    if (authority.preflight_entry_validated !== true) {
      failures.push('preflight_entry_reference_preflight_entry_validated_required');
    }
    if (authority.preflight_entry_reference_prepared !== true) {
      failures.push('preflight_entry_reference_prepared_required');
    }
    if (authority.non_side_effect_only !== true) {
      failures.push('preflight_entry_reference_non_side_effect_only_required');
    }
    for (const field of SAFE_FALSE_AUTHORITY_FIELDS) {
      if (authority[field] !== false) {
        failures.push(`preflight_entry_reference_authority_${field}_must_be_false`);
      }
    }
    if (authority.production_effect !== 'ZERO') {
      failures.push('preflight_entry_reference_authority_production_effect_must_be_zero');
    }
  }

  const evidence = isPlainObject(referenceResult.evidence) ? referenceResult.evidence : null;
  if (!evidence) {
    failures.push('preflight_entry_reference_evidence_missing');
  } else {
    if (evidence.preflight_entry_validated !== true) {
      failures.push('preflight_entry_reference_evidence_preflight_entry_validated_required');
    }
    if (evidence.preflight_entry_identity_bound !== true) {
      failures.push('preflight_entry_reference_evidence_entry_identity_bound_required');
    }
    if (evidence.simulated !== true) {
      failures.push('preflight_entry_reference_evidence_simulated_required');
    }
    if (evidence.executed !== false) {
      failures.push('preflight_entry_reference_evidence_executed_must_be_false');
    }
    if (evidence.real_provider_called !== false) {
      failures.push('preflight_entry_reference_evidence_real_provider_called_must_be_false');
    }
    if (evidence.can_trigger_real_execution !== false) {
      failures.push('preflight_entry_reference_evidence_can_trigger_real_execution_must_be_false');
    }
    if (evidence.production_effect !== 'ZERO') {
      failures.push('preflight_entry_reference_evidence_production_effect_must_be_zero');
    }
  }

  const audit = isPlainObject(referenceResult.audit) ? referenceResult.audit : null;
  if (!audit) {
    failures.push('preflight_entry_reference_audit_missing');
  } else {
    if (audit.event_name !== 'public_web_canary_preflight_entry_reference_prepared_simulation') {
      failures.push('preflight_entry_reference_audit_event_mismatch');
    }
    if (
      audit.decision !==
      'PREPARE_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT_ENTRY_REFERENCE'
    ) {
      failures.push('preflight_entry_reference_audit_decision_mismatch');
    }
    if (audit.next_state !== 'WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_CONSUMER') {
      failures.push('preflight_entry_reference_audit_next_state_mismatch');
    }
    if (!valuesEqual(audit.reason_codes, [REFERENCE_SUCCESS_REASON])) {
      failures.push('preflight_entry_reference_audit_reason_codes_mismatch');
    }
    if (audit.provider_called !== false) {
      failures.push('preflight_entry_reference_audit_provider_called_must_be_false');
    }
    if (audit.external_network_used !== false) {
      failures.push('preflight_entry_reference_audit_external_network_used_must_be_false');
    }
    if (audit.production_effect !== 'ZERO') {
      failures.push('preflight_entry_reference_audit_production_effect_must_be_zero');
    }
  }

  return uniqueSorted(failures);
}

function authorityBoundary(ok) {
  return {
    preflight_entry_reference_seen: true,
    preflight_entry_reference_validated: ok === true,
    preflight_request_prepared: ok === true,
    non_side_effect_only: true,
    preflight_execution: false,
    dry_run_execution: false,
    operator_confirmation: false,
    trial_execution: false,
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
  };
}

function buildResult(referenceResult, failures) {
  const ok = failures.length === 0;
  const validationFailure = failures.some(
    (reason) =>
      reason.endsWith('_missing') ||
      reason.endsWith('_invalid') ||
      reason.includes('mismatch') ||
      reason.startsWith('preflight_entry_reference_validation::')
  );
  const status = ok
    ? SUCCESS.status
    : validationFailure
      ? 'PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_CONSUMER_VALIDATION_FAILED'
      : 'PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_CONSUMER_BLOCKED';
  const decision = ok ? SUCCESS.decision : BLOCKED.decision;
  const nextState = ok ? SUCCESS.next_state : BLOCKED.next_state;
  const reasonCodes = ok
    ? ['public_web_canary_preflight_request_prepared_from_validated_entry_reference_non_side_effect_only']
    : uniqueSorted([...failures, 'fail_closed']);
  const entryReferenceBinding = safeEntryReferenceBinding(referenceResult);
  const authority = authorityBoundary(ok);
  const preflightRequest = {
    request_type: 'PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT_REQUEST_SIMULATION',
    entry_reference_id: entryReferenceBinding.entry_reference_id,
    entry_reference_fingerprint: entryReferenceBinding.entry_reference_fingerprint,
    entry_id: entryReferenceBinding.entry_id,
    entry_fingerprint: entryReferenceBinding.entry_fingerprint,
    readiness_id: entryReferenceBinding.readiness_id,
    readiness_fingerprint: entryReferenceBinding.readiness_fingerprint,
    readiness_validator_version: entryReferenceBinding.readiness_validator_version,
    trial_id: entryReferenceBinding.trial_id,
    plan_hash: entryReferenceBinding.plan_hash,
    preparation_eligibility_id: entryReferenceBinding.preparation_eligibility_id,
    tenant_id: entryReferenceBinding.tenant_id,
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    production_effect: 'ZERO'
  };
  const material = {
    validator_version: PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_CONSUMER_VALIDATOR_VERSION,
    status,
    decision,
    next_state: nextState,
    reason_codes: reasonCodes,
    entry_reference_binding: entryReferenceBinding,
    preflight_request: preflightRequest,
    authority_boundary: authority,
    simulated: true,
    executed: false,
    production_effect: 'ZERO'
  };
  const evidence = {
    preflight_entry_reference_validated: ok,
    entry_reference_identity_bound:
      ok &&
      isNonEmptyString(entryReferenceBinding.entry_reference_id) &&
      isNonEmptyString(entryReferenceBinding.entry_reference_fingerprint),
    entry_identity_bound:
      ok &&
      isNonEmptyString(entryReferenceBinding.entry_id) &&
      isNonEmptyString(entryReferenceBinding.entry_fingerprint),
    readiness_identity_bound:
      ok &&
      isNonEmptyString(entryReferenceBinding.readiness_id) &&
      isNonEmptyString(entryReferenceBinding.readiness_fingerprint),
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    production_effect: 'ZERO'
  };
  const audit = {
    event_name: ok
      ? 'public_web_canary_preflight_request_prepared_simulation'
      : 'public_web_canary_preflight_entry_reference_consumer_blocked',
    decision,
    next_state: nextState,
    reason_codes: reasonCodes,
    provider_called: false,
    external_network_used: false,
    production_effect: 'ZERO'
  };
  const preflightRequestId =
    `public_web_canary_preflight_request:${digest({ material, evidence })}`;
  return cloneFrozen({
    ok,
    status,
    decision,
    next_state: nextState,
    reason_codes: reasonCodes,
    preflight_request_id: preflightRequestId,
    preflight_request_fingerprint: digest({ material, evidence, audit }),
    preflight_request: preflightRequest,
    entry_reference_binding: entryReferenceBinding,
    authority_boundary: authority,
    evidence,
    audit,
    validator_version: PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_CONSUMER_VALIDATOR_VERSION
  });
}

function evaluatePublicWebCanaryPreflightEntryReferenceConsumerBoundary(
  referenceResult,
  entryResult
) {
  const failures = collectReferenceFailures(referenceResult, entryResult);
  return buildResult(referenceResult, failures);
}

function validatePublicWebCanaryPreflightEntryReferenceConsumerBoundaryResult(
  result,
  referenceResult,
  entryResult
) {
  const errors = [];
  if (!isPlainObject(result)) {
    return { valid: false, errors: ['preflight_entry_reference_consumer_result_must_be_object'] };
  }
  if (!PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_CONSUMER_STATUSES.includes(result.status)) {
    errors.push('status_invalid');
  }
  if (!PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_CONSUMER_DECISIONS.includes(result.decision)) {
    errors.push('decision_invalid');
  }
  if (!PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_CONSUMER_NEXT_STATES.includes(result.next_state)) {
    errors.push('next_state_invalid');
  }
  if (!isNonEmptyString(result.preflight_request_id)) {
    errors.push('preflight_request_id_invalid');
  }
  if (!isNonEmptyString(result.preflight_request_fingerprint)) {
    errors.push('preflight_request_fingerprint_invalid');
  }
  if (
    result.validator_version !==
    PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_CONSUMER_VALIDATOR_VERSION
  ) {
    errors.push('validator_version_invalid');
  }

  const expected = evaluatePublicWebCanaryPreflightEntryReferenceConsumerBoundary(
    referenceResult,
    entryResult
  );
  if (!valuesEqual(result, expected)) {
    errors.push('preflight_entry_reference_consumer_context_mismatch');
  }

  if (isPlainObject(result.authority_boundary)) {
    for (const field of SAFE_FALSE_AUTHORITY_FIELDS) {
      if (result.authority_boundary[field] !== false) {
        errors.push(`authority_${field}_must_be_false`);
      }
    }
    if (result.authority_boundary.production_effect !== 'ZERO') {
      errors.push('authority_production_effect_must_be_zero');
    }
  } else {
    errors.push('authority_boundary_must_be_object');
  }

  if (isPlainObject(result.preflight_request)) {
    if (result.preflight_request.simulated !== true) {
      errors.push('preflight_request_simulated_required');
    }
    if (result.preflight_request.executed !== false) {
      errors.push('preflight_request_executed_must_be_false');
    }
    if (result.preflight_request.real_provider_called !== false) {
      errors.push('preflight_request_real_provider_called_must_be_false');
    }
    if (result.preflight_request.can_trigger_real_execution !== false) {
      errors.push('preflight_request_can_trigger_real_execution_must_be_false');
    }
    if (result.preflight_request.production_effect !== 'ZERO') {
      errors.push('preflight_request_production_effect_must_be_zero');
    }
  } else {
    errors.push('preflight_request_must_be_object');
  }

  if (isPlainObject(result.evidence)) {
    if (result.evidence.simulated !== true) errors.push('evidence_simulated_required');
    if (result.evidence.executed !== false) errors.push('evidence_executed_must_be_false');
    if (result.evidence.real_provider_called !== false) {
      errors.push('evidence_real_provider_called_must_be_false');
    }
    if (result.evidence.can_trigger_real_execution !== false) {
      errors.push('evidence_can_trigger_real_execution_must_be_false');
    }
    if (result.evidence.production_effect !== 'ZERO') {
      errors.push('evidence_production_effect_must_be_zero');
    }
  } else {
    errors.push('evidence_must_be_object');
  }

  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_CONSUMER_DECISIONS,
  PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_CONSUMER_NEXT_STATES,
  PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_CONSUMER_STATUSES,
  PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_CONSUMER_VALIDATOR_VERSION,
  evaluatePublicWebCanaryPreflightEntryReferenceConsumerBoundary,
  validatePublicWebCanaryPreflightEntryReferenceConsumerBoundaryResult
};
