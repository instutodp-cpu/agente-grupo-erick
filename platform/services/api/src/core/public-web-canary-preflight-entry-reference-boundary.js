'use strict';

const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_VALIDATOR_VERSION
} = require('./public-web-canary-preflight-entry-boundary');

const PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_VALIDATOR_VERSION =
  'public_web_canary_preflight_entry_reference_boundary_v1';

const PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_STATUSES = Object.freeze([
  'PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_PREPARED_SIMULATION',
  'PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_BLOCKED',
  'PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_VALIDATION_FAILED'
]);

const PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_DECISIONS = Object.freeze([
  'PREPARE_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT_ENTRY_REFERENCE',
  'BLOCKED'
]);

const PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_NEXT_STATES = Object.freeze([
  'WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_CONSUMER',
  'BLOCKED_REFERENCE'
]);

const SUCCESS = Object.freeze({
  status: 'PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_PREPARED_SIMULATION',
  decision: 'PREPARE_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT_ENTRY_REFERENCE',
  next_state: 'WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_CONSUMER'
});

const BLOCKED = Object.freeze({
  decision: 'BLOCKED',
  next_state: 'BLOCKED_REFERENCE'
});

const ENTRY_SUCCESS_REASON = 'public_web_canary_preflight_entry_prepared_non_side_effect_only';

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

function entryMaterial(entryResult) {
  const safe = isPlainObject(entryResult) ? entryResult : {};
  return {
    validator_version: safe.validator_version,
    status: safe.status,
    decision: safe.decision,
    next_state: safe.next_state,
    reason_codes: Array.isArray(safe.reason_codes) ? safe.reason_codes : [],
    readiness_reference: isPlainObject(safe.readiness_reference) ? safe.readiness_reference : {},
    authority_boundary: isPlainObject(safe.authority_boundary) ? safe.authority_boundary : {},
    simulated: true,
    executed: false,
    production_effect: 'ZERO'
  };
}

function expectedEntryIdentity(entryResult) {
  const material = entryMaterial(entryResult);
  const evidence = isPlainObject(entryResult && entryResult.evidence) ? entryResult.evidence : {};
  const audit = isPlainObject(entryResult && entryResult.audit) ? entryResult.audit : {};
  return {
    entry_id: `public_web_canary_preflight_entry:${digest({ material, evidence })}`,
    entry_fingerprint: digest({ material, evidence, audit })
  };
}

function safeEntryReference(entryResult) {
  const safe = isPlainObject(entryResult) ? entryResult : {};
  const readiness = isPlainObject(safe.readiness_reference) ? safe.readiness_reference : {};
  return {
    entry_id: isNonEmptyString(safe.entry_id) ? safe.entry_id : null,
    entry_fingerprint: isNonEmptyString(safe.entry_fingerprint) ? safe.entry_fingerprint : null,
    entry_validator_version: isNonEmptyString(safe.validator_version) ? safe.validator_version : null,
    readiness_id: isNonEmptyString(readiness.readiness_id) ? readiness.readiness_id : null,
    readiness_fingerprint: isNonEmptyString(readiness.readiness_fingerprint)
      ? readiness.readiness_fingerprint
      : null,
    readiness_validator_version: isNonEmptyString(readiness.readiness_validator_version)
      ? readiness.readiness_validator_version
      : null,
    trial_id: isNonEmptyString(readiness.trial_id) ? readiness.trial_id : null,
    plan_hash: isNonEmptyString(readiness.plan_hash) ? readiness.plan_hash : null,
    preparation_eligibility_id: isNonEmptyString(readiness.preparation_eligibility_id)
      ? readiness.preparation_eligibility_id
      : null,
    tenant_id: isNonEmptyString(readiness.tenant_id) ? readiness.tenant_id : null
  };
}

function collectEntryFailures(entryResult) {
  const failures = [];
  if (!isPlainObject(entryResult)) return ['preflight_entry_result_missing'];

  if (entryResult.ok !== true) failures.push('preflight_entry_not_ok');
  if (entryResult.status !== 'PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_PREPARED_SIMULATION') {
    failures.push('preflight_entry_status_not_prepared');
  }
  if (entryResult.decision !== 'PREPARE_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT_ENTRY') {
    failures.push('preflight_entry_decision_not_prepare');
  }
  if (entryResult.next_state !== 'WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE') {
    failures.push('preflight_entry_next_state_not_waiting_reference');
  }
  if (entryResult.validator_version !== PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_VALIDATOR_VERSION) {
    failures.push('preflight_entry_validator_version_mismatch');
  }
  if (!valuesEqual(entryResult.reason_codes, [ENTRY_SUCCESS_REASON])) {
    failures.push('preflight_entry_reason_codes_mismatch');
  }

  for (const legacyField of [
    'ready',
    'authorized',
    'canary_authorized',
    'execution_authorized',
    'ready_for_real_execution'
  ]) {
    if (Object.prototype.hasOwnProperty.call(entryResult, legacyField)) {
      failures.push(`legacy_preflight_entry_field_forbidden::${legacyField}`);
    }
  }

  const readiness = isPlainObject(entryResult.readiness_reference)
    ? entryResult.readiness_reference
    : null;
  if (!readiness) {
    failures.push('preflight_entry_readiness_reference_missing');
  } else {
    for (const field of [
      'readiness_id',
      'readiness_fingerprint',
      'readiness_validator_version',
      'trial_id',
      'plan_hash',
      'preparation_eligibility_id',
      'tenant_id'
    ]) {
      if (!isNonEmptyString(readiness[field])) {
        failures.push(`preflight_entry_readiness_reference_${field}_invalid`);
      }
    }
    if (readiness.status !== 'PUBLIC_WEB_CANARY_PREFLIGHT_READY') {
      failures.push('preflight_entry_readiness_reference_status_mismatch');
    }
    if (readiness.decision !== 'ENTER_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT') {
      failures.push('preflight_entry_readiness_reference_decision_mismatch');
    }
    if (readiness.next_state !== 'WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_RUN') {
      failures.push('preflight_entry_readiness_reference_next_state_mismatch');
    }
  }

  const authority = isPlainObject(entryResult.authority_boundary)
    ? entryResult.authority_boundary
    : null;
  if (!authority) {
    failures.push('preflight_entry_authority_missing');
  } else {
    if (authority.readiness_seen !== true) failures.push('preflight_entry_readiness_seen_required');
    if (authority.readiness_validated !== true) failures.push('preflight_entry_readiness_validated_required');
    if (authority.preflight_entry_prepared !== true) failures.push('preflight_entry_prepared_required');
    if (authority.non_side_effect_only !== true) failures.push('preflight_entry_non_side_effect_only_required');
    for (const field of SAFE_FALSE_AUTHORITY_FIELDS) {
      if (authority[field] !== false) failures.push(`preflight_entry_authority_${field}_must_be_false`);
    }
    if (authority.production_effect !== 'ZERO') {
      failures.push('preflight_entry_authority_production_effect_must_be_zero');
    }
  }

  const evidence = isPlainObject(entryResult.evidence) ? entryResult.evidence : null;
  if (!evidence) {
    failures.push('preflight_entry_evidence_missing');
  } else {
    if (evidence.readiness_validated !== true) failures.push('preflight_entry_evidence_readiness_validated_required');
    if (evidence.readiness_fingerprint_bound !== true) {
      failures.push('preflight_entry_evidence_readiness_fingerprint_bound_required');
    }
    if (evidence.simulated !== true) failures.push('preflight_entry_evidence_simulated_required');
    if (evidence.executed !== false) failures.push('preflight_entry_evidence_executed_must_be_false');
    if (evidence.real_provider_called !== false) {
      failures.push('preflight_entry_evidence_real_provider_called_must_be_false');
    }
    if (evidence.can_trigger_real_execution !== false) {
      failures.push('preflight_entry_evidence_can_trigger_real_execution_must_be_false');
    }
    if (evidence.production_effect !== 'ZERO') {
      failures.push('preflight_entry_evidence_production_effect_must_be_zero');
    }
  }

  const audit = isPlainObject(entryResult.audit) ? entryResult.audit : null;
  if (!audit) {
    failures.push('preflight_entry_audit_missing');
  } else {
    if (audit.event_name !== 'public_web_canary_preflight_entry_prepared_simulation') {
      failures.push('preflight_entry_audit_event_mismatch');
    }
    if (audit.decision !== 'PREPARE_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT_ENTRY') {
      failures.push('preflight_entry_audit_decision_mismatch');
    }
    if (audit.next_state !== 'WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE') {
      failures.push('preflight_entry_audit_next_state_mismatch');
    }
    if (!valuesEqual(audit.reason_codes, [ENTRY_SUCCESS_REASON])) {
      failures.push('preflight_entry_audit_reason_codes_mismatch');
    }
    if (audit.provider_called !== false) failures.push('preflight_entry_audit_provider_called_must_be_false');
    if (audit.external_network_used !== false) {
      failures.push('preflight_entry_audit_external_network_used_must_be_false');
    }
    if (audit.production_effect !== 'ZERO') {
      failures.push('preflight_entry_audit_production_effect_must_be_zero');
    }
  }

  if (!isNonEmptyString(entryResult.entry_id)) failures.push('preflight_entry_id_invalid');
  if (!isNonEmptyString(entryResult.entry_fingerprint)) failures.push('preflight_entry_fingerprint_invalid');

  if (isPlainObject(evidence) && isPlainObject(audit)) {
    const expected = expectedEntryIdentity(entryResult);
    if (entryResult.entry_id !== expected.entry_id) failures.push('preflight_entry_id_mismatch');
    if (entryResult.entry_fingerprint !== expected.entry_fingerprint) {
      failures.push('preflight_entry_fingerprint_mismatch');
    }
  }

  return uniqueSorted(failures);
}

function authorityBoundary(ok) {
  return {
    preflight_entry_seen: true,
    preflight_entry_validated: ok === true,
    preflight_entry_reference_prepared: ok === true,
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

function buildResult(entryResult, failures) {
  const ok = failures.length === 0;
  const validationFailure = failures.some((reason) =>
    reason.endsWith('_missing') || reason.endsWith('_invalid') || reason.includes('mismatch')
  );
  const status = ok
    ? SUCCESS.status
    : validationFailure
      ? 'PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_VALIDATION_FAILED'
      : 'PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_BLOCKED';
  const decision = ok ? SUCCESS.decision : BLOCKED.decision;
  const nextState = ok ? SUCCESS.next_state : BLOCKED.next_state;
  const reasonCodes = ok
    ? ['public_web_canary_preflight_entry_reference_prepared_non_side_effect_only']
    : uniqueSorted([...failures, 'fail_closed']);
  const entryReference = safeEntryReference(entryResult);
  const authority = authorityBoundary(ok);
  const material = {
    validator_version: PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_VALIDATOR_VERSION,
    status,
    decision,
    next_state: nextState,
    reason_codes: reasonCodes,
    entry_reference: entryReference,
    authority_boundary: authority,
    simulated: true,
    executed: false,
    production_effect: 'ZERO'
  };
  const evidence = {
    preflight_entry_validated: ok,
    preflight_entry_identity_bound:
      ok && isNonEmptyString(entryReference.entry_id) && isNonEmptyString(entryReference.entry_fingerprint),
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    production_effect: 'ZERO'
  };
  const audit = {
    event_name: ok
      ? 'public_web_canary_preflight_entry_reference_prepared_simulation'
      : 'public_web_canary_preflight_entry_reference_blocked',
    decision,
    next_state: nextState,
    reason_codes: reasonCodes,
    provider_called: false,
    external_network_used: false,
    production_effect: 'ZERO'
  };
  const entryReferenceId = `public_web_canary_preflight_entry_reference:${digest({ material, evidence })}`;
  return cloneFrozen({
    ok,
    status,
    decision,
    next_state: nextState,
    reason_codes: reasonCodes,
    entry_reference_id: entryReferenceId,
    entry_reference_fingerprint: digest({ material, evidence, audit }),
    entry_reference: entryReference,
    authority_boundary: authority,
    evidence,
    audit,
    validator_version: PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_VALIDATOR_VERSION
  });
}

function evaluatePublicWebCanaryPreflightEntryReferenceBoundary(entryResult) {
  const failures = collectEntryFailures(entryResult);
  return buildResult(entryResult, failures);
}

function validatePublicWebCanaryPreflightEntryReferenceBoundaryResult(result, entryResult) {
  const errors = [];
  if (!isPlainObject(result)) {
    return { valid: false, errors: ['preflight_entry_reference_result_must_be_object'] };
  }
  if (!PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_STATUSES.includes(result.status)) {
    errors.push('status_invalid');
  }
  if (!PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_DECISIONS.includes(result.decision)) {
    errors.push('decision_invalid');
  }
  if (!PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_NEXT_STATES.includes(result.next_state)) {
    errors.push('next_state_invalid');
  }
  if (!isNonEmptyString(result.entry_reference_id)) errors.push('entry_reference_id_invalid');
  if (!isNonEmptyString(result.entry_reference_fingerprint)) {
    errors.push('entry_reference_fingerprint_invalid');
  }
  if (result.validator_version !== PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_VALIDATOR_VERSION) {
    errors.push('validator_version_invalid');
  }
  const expected = evaluatePublicWebCanaryPreflightEntryReferenceBoundary(entryResult);
  if (!valuesEqual(result, expected)) errors.push('preflight_entry_reference_context_mismatch');
  if (isPlainObject(result.authority_boundary)) {
    for (const field of SAFE_FALSE_AUTHORITY_FIELDS) {
      if (result.authority_boundary[field] !== false) errors.push(`authority_${field}_must_be_false`);
    }
    if (result.authority_boundary.production_effect !== 'ZERO') {
      errors.push('authority_production_effect_must_be_zero');
    }
  } else {
    errors.push('authority_boundary_must_be_object');
  }
  if (isPlainObject(result.evidence)) {
    if (result.evidence.simulated !== true) errors.push('evidence_simulated_required');
    if (result.evidence.executed !== false) errors.push('evidence_executed_must_be_false');
    if (result.evidence.real_provider_called !== false) errors.push('evidence_real_provider_called_must_be_false');
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
  PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_DECISIONS,
  PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_NEXT_STATES,
  PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_STATUSES,
  PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_VALIDATOR_VERSION,
  evaluatePublicWebCanaryPreflightEntryReferenceBoundary,
  validatePublicWebCanaryPreflightEntryReferenceBoundaryResult
};
