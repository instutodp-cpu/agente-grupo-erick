'use strict';

const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_CONSUMER_VALIDATOR_VERSION,
  validatePublicWebCanaryPreflightEntryReferenceConsumerBoundaryResult
} = require('./public-web-canary-preflight-entry-reference-consumer-boundary');

const PUBLIC_WEB_CANARY_PREFLIGHT_REQUEST_CONSUMER_VALIDATOR_VERSION =
  'public_web_canary_preflight_request_consumer_boundary_v1';

const PUBLIC_WEB_CANARY_PREFLIGHT_REQUEST_CONSUMER_STATUSES = Object.freeze([
  'PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_PREPARED_SIMULATION',
  'PUBLIC_WEB_CANARY_PREFLIGHT_REQUEST_CONSUMER_BLOCKED',
  'PUBLIC_WEB_CANARY_PREFLIGHT_REQUEST_CONSUMER_VALIDATION_FAILED'
]);

const PUBLIC_WEB_CANARY_PREFLIGHT_REQUEST_CONSUMER_DECISIONS = Object.freeze([
  'PREPARE_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_DRY_RUN_REQUEST',
  'BLOCKED'
]);

const PUBLIC_WEB_CANARY_PREFLIGHT_REQUEST_CONSUMER_NEXT_STATES = Object.freeze([
  'WAITING_PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_CONSUMER',
  'BLOCKED_REFERENCE'
]);

const SUCCESS = Object.freeze({
  status: 'PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_PREPARED_SIMULATION',
  decision: 'PREPARE_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_DRY_RUN_REQUEST',
  next_state: 'WAITING_PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_CONSUMER'
});

const BLOCKED = Object.freeze({
  decision: 'BLOCKED',
  next_state: 'BLOCKED_REFERENCE'
});

const SOURCE_SUCCESS_REASON =
  'public_web_canary_preflight_request_prepared_from_validated_entry_reference_non_side_effect_only';

const SUCCESS_REASON =
  'public_web_canary_dry_run_request_prepared_from_validated_preflight_request_non_side_effect_only';

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

const REQUEST_BINDING_FIELDS = Object.freeze([
  'entry_reference_id',
  'entry_reference_fingerprint',
  'entry_id',
  'entry_fingerprint',
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

function safeSourceBinding(consumerResult) {
  const safe = isPlainObject(consumerResult) ? consumerResult : {};
  const request = isPlainObject(safe.preflight_request) ? safe.preflight_request : {};
  const binding = isPlainObject(safe.entry_reference_binding)
    ? safe.entry_reference_binding
    : {};

  return {
    preflight_request_id: isNonEmptyString(safe.preflight_request_id)
      ? safe.preflight_request_id
      : null,
    preflight_request_fingerprint: isNonEmptyString(safe.preflight_request_fingerprint)
      ? safe.preflight_request_fingerprint
      : null,
    preflight_request_validator_version: isNonEmptyString(safe.validator_version)
      ? safe.validator_version
      : null,
    entry_reference_id: isNonEmptyString(request.entry_reference_id)
      ? request.entry_reference_id
      : null,
    entry_reference_fingerprint: isNonEmptyString(request.entry_reference_fingerprint)
      ? request.entry_reference_fingerprint
      : null,
    entry_reference_validator_version: isNonEmptyString(binding.entry_reference_validator_version)
      ? binding.entry_reference_validator_version
      : null,
    entry_id: isNonEmptyString(request.entry_id) ? request.entry_id : null,
    entry_fingerprint: isNonEmptyString(request.entry_fingerprint)
      ? request.entry_fingerprint
      : null,
    entry_validator_version: isNonEmptyString(binding.entry_validator_version)
      ? binding.entry_validator_version
      : null,
    readiness_id: isNonEmptyString(request.readiness_id) ? request.readiness_id : null,
    readiness_fingerprint: isNonEmptyString(request.readiness_fingerprint)
      ? request.readiness_fingerprint
      : null,
    readiness_validator_version: isNonEmptyString(request.readiness_validator_version)
      ? request.readiness_validator_version
      : null,
    trial_id: isNonEmptyString(request.trial_id) ? request.trial_id : null,
    plan_hash: isNonEmptyString(request.plan_hash) ? request.plan_hash : null,
    preparation_eligibility_id: isNonEmptyString(request.preparation_eligibility_id)
      ? request.preparation_eligibility_id
      : null,
    tenant_id: isNonEmptyString(request.tenant_id) ? request.tenant_id : null
  };
}

function collectSourceFailures(consumerResult, referenceResult, entryResult) {
  const failures = [];
  if (!isPlainObject(consumerResult)) {
    return ['preflight_request_consumer_source_missing'];
  }

  if (consumerResult.ok !== true) failures.push('preflight_request_consumer_source_not_ok');
  if (consumerResult.status !== 'PUBLIC_WEB_CANARY_PREFLIGHT_REQUEST_PREPARED_SIMULATION') {
    failures.push('preflight_request_consumer_source_status_not_prepared');
  }
  if (
    consumerResult.decision !==
    'PREPARE_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT_REQUEST'
  ) {
    failures.push('preflight_request_consumer_source_decision_not_prepare');
  }
  if (consumerResult.next_state !== 'WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_REQUEST_CONSUMER') {
    failures.push('preflight_request_consumer_source_next_state_not_waiting_consumer');
  }
  if (
    consumerResult.validator_version !==
    PUBLIC_WEB_CANARY_PREFLIGHT_ENTRY_REFERENCE_CONSUMER_VALIDATOR_VERSION
  ) {
    failures.push('preflight_request_consumer_source_validator_version_mismatch');
  }
  if (!valuesEqual(consumerResult.reason_codes, [SOURCE_SUCCESS_REASON])) {
    failures.push('preflight_request_consumer_source_reason_codes_mismatch');
  }

  for (const legacyField of [
    'ready',
    'authorized',
    'canary_authorized',
    'execution_authorized',
    'dry_run_authorized',
    'ready_for_real_execution',
    'can_trigger_real_execution'
  ]) {
    if (Object.prototype.hasOwnProperty.call(consumerResult, legacyField)) {
      failures.push(`legacy_preflight_request_consumer_field_forbidden::${legacyField}`);
    }
  }

  if (!isPlainObject(referenceResult)) {
    failures.push('preflight_entry_reference_result_missing');
  }
  if (!isPlainObject(entryResult)) {
    failures.push('preflight_entry_result_missing');
  }
  if (isPlainObject(referenceResult) && isPlainObject(entryResult)) {
    const validation =
      validatePublicWebCanaryPreflightEntryReferenceConsumerBoundaryResult(
        consumerResult,
        referenceResult,
        entryResult
      );
    if (!validation.valid) {
      for (const error of validation.errors) {
        failures.push(`preflight_request_consumer_source_validation::${error}`);
      }
    }
  }

  if (!isNonEmptyString(consumerResult.preflight_request_id)) {
    failures.push('preflight_request_id_invalid');
  }
  if (!isNonEmptyString(consumerResult.preflight_request_fingerprint)) {
    failures.push('preflight_request_fingerprint_invalid');
  }

  const request = isPlainObject(consumerResult.preflight_request)
    ? consumerResult.preflight_request
    : null;
  const binding = isPlainObject(consumerResult.entry_reference_binding)
    ? consumerResult.entry_reference_binding
    : null;

  if (!request) {
    failures.push('preflight_request_missing');
  } else {
    if (
      request.request_type !==
      'PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT_REQUEST_SIMULATION'
    ) {
      failures.push('preflight_request_type_mismatch');
    }
    for (const field of REQUEST_BINDING_FIELDS) {
      if (!isNonEmptyString(request[field])) {
        failures.push(`preflight_request_${field}_invalid`);
      }
    }
    if (request.simulated !== true) failures.push('preflight_request_simulated_required');
    if (request.executed !== false) failures.push('preflight_request_executed_must_be_false');
    if (request.real_provider_called !== false) {
      failures.push('preflight_request_real_provider_called_must_be_false');
    }
    if (request.can_trigger_real_execution !== false) {
      failures.push('preflight_request_can_trigger_real_execution_must_be_false');
    }
    if (request.production_effect !== 'ZERO') {
      failures.push('preflight_request_production_effect_must_be_zero');
    }
  }

  if (!binding) {
    failures.push('preflight_request_entry_reference_binding_missing');
  } else {
    for (const field of [
      ...REQUEST_BINDING_FIELDS,
      'entry_reference_validator_version',
      'entry_validator_version'
    ]) {
      if (!isNonEmptyString(binding[field])) {
        failures.push(`preflight_request_entry_reference_binding_${field}_invalid`);
      }
    }
  }

  if (request && binding) {
    for (const field of REQUEST_BINDING_FIELDS) {
      if (request[field] !== binding[field]) {
        failures.push(`preflight_request_binding_${field}_mismatch`);
      }
    }
  }

  if (request && isPlainObject(referenceResult)) {
    if (request.entry_reference_id !== referenceResult.entry_reference_id) {
      failures.push('preflight_request_entry_reference_id_mismatch');
    }
    if (request.entry_reference_fingerprint !== referenceResult.entry_reference_fingerprint) {
      failures.push('preflight_request_entry_reference_fingerprint_mismatch');
    }
  }

  if (request && isPlainObject(entryResult)) {
    if (request.entry_id !== entryResult.entry_id) {
      failures.push('preflight_request_entry_id_mismatch');
    }
    if (request.entry_fingerprint !== entryResult.entry_fingerprint) {
      failures.push('preflight_request_entry_fingerprint_mismatch');
    }
    const readiness = isPlainObject(entryResult.readiness_reference)
      ? entryResult.readiness_reference
      : null;
    if (!readiness) {
      failures.push('preflight_request_readiness_reference_missing');
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
        if (request[field] !== readiness[field]) {
          failures.push(`preflight_request_${field}_mismatch`);
        }
      }
    }
  }

  const authority = isPlainObject(consumerResult.authority_boundary)
    ? consumerResult.authority_boundary
    : null;
  if (!authority) {
    failures.push('preflight_request_consumer_source_authority_missing');
  } else {
    if (authority.preflight_entry_reference_seen !== true) {
      failures.push('preflight_request_consumer_source_reference_seen_required');
    }
    if (authority.preflight_entry_reference_validated !== true) {
      failures.push('preflight_request_consumer_source_reference_validated_required');
    }
    if (authority.preflight_request_prepared !== true) {
      failures.push('preflight_request_consumer_source_request_prepared_required');
    }
    if (authority.non_side_effect_only !== true) {
      failures.push('preflight_request_consumer_source_non_side_effect_only_required');
    }
    for (const field of SAFE_FALSE_AUTHORITY_FIELDS) {
      if (authority[field] !== false) {
        failures.push(`preflight_request_consumer_source_authority_${field}_must_be_false`);
      }
    }
    if (authority.production_effect !== 'ZERO') {
      failures.push('preflight_request_consumer_source_authority_production_effect_must_be_zero');
    }
  }

  const evidence = isPlainObject(consumerResult.evidence) ? consumerResult.evidence : null;
  if (!evidence) {
    failures.push('preflight_request_consumer_source_evidence_missing');
  } else {
    for (const field of [
      'preflight_entry_reference_validated',
      'entry_reference_identity_bound',
      'entry_identity_bound',
      'readiness_identity_bound'
    ]) {
      if (evidence[field] !== true) {
        failures.push(`preflight_request_consumer_source_evidence_${field}_required`);
      }
    }
    if (evidence.simulated !== true) failures.push('preflight_request_consumer_source_evidence_simulated_required');
    if (evidence.executed !== false) failures.push('preflight_request_consumer_source_evidence_executed_must_be_false');
    if (evidence.real_provider_called !== false) {
      failures.push('preflight_request_consumer_source_evidence_real_provider_called_must_be_false');
    }
    if (evidence.can_trigger_real_execution !== false) {
      failures.push('preflight_request_consumer_source_evidence_can_trigger_real_execution_must_be_false');
    }
    if (evidence.production_effect !== 'ZERO') {
      failures.push('preflight_request_consumer_source_evidence_production_effect_must_be_zero');
    }
  }

  const audit = isPlainObject(consumerResult.audit) ? consumerResult.audit : null;
  if (!audit) {
    failures.push('preflight_request_consumer_source_audit_missing');
  } else {
    if (audit.event_name !== 'public_web_canary_preflight_request_prepared_simulation') {
      failures.push('preflight_request_consumer_source_audit_event_mismatch');
    }
    if (audit.decision !== 'PREPARE_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_PREFLIGHT_REQUEST') {
      failures.push('preflight_request_consumer_source_audit_decision_mismatch');
    }
    if (audit.next_state !== 'WAITING_PUBLIC_WEB_CANARY_PREFLIGHT_REQUEST_CONSUMER') {
      failures.push('preflight_request_consumer_source_audit_next_state_mismatch');
    }
    if (!valuesEqual(audit.reason_codes, [SOURCE_SUCCESS_REASON])) {
      failures.push('preflight_request_consumer_source_audit_reason_codes_mismatch');
    }
    if (audit.provider_called !== false) {
      failures.push('preflight_request_consumer_source_audit_provider_called_must_be_false');
    }
    if (audit.external_network_used !== false) {
      failures.push('preflight_request_consumer_source_audit_external_network_used_must_be_false');
    }
    if (audit.production_effect !== 'ZERO') {
      failures.push('preflight_request_consumer_source_audit_production_effect_must_be_zero');
    }
  }

  return uniqueSorted(failures);
}

function authorityBoundary(ok) {
  return {
    preflight_request_seen: true,
    preflight_request_validated: ok === true,
    dry_run_request_prepared: ok === true,
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

function buildResult(consumerResult, failures) {
  const ok = failures.length === 0;
  const validationFailure = failures.some(
    (reason) =>
      reason.endsWith('_missing') ||
      reason.endsWith('_invalid') ||
      reason.includes('mismatch') ||
      reason.startsWith('preflight_request_consumer_source_validation::')
  );
  const status = ok
    ? SUCCESS.status
    : validationFailure
      ? 'PUBLIC_WEB_CANARY_PREFLIGHT_REQUEST_CONSUMER_VALIDATION_FAILED'
      : 'PUBLIC_WEB_CANARY_PREFLIGHT_REQUEST_CONSUMER_BLOCKED';
  const decision = ok ? SUCCESS.decision : BLOCKED.decision;
  const nextState = ok ? SUCCESS.next_state : BLOCKED.next_state;
  const reasonCodes = ok ? [SUCCESS_REASON] : uniqueSorted([...failures, 'fail_closed']);
  const sourceBinding = safeSourceBinding(consumerResult);
  const authority = authorityBoundary(ok);
  const dryRunRequest = {
    request_type: 'PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_DRY_RUN_REQUEST_SIMULATION',
    preflight_request_id: sourceBinding.preflight_request_id,
    preflight_request_fingerprint: sourceBinding.preflight_request_fingerprint,
    preflight_request_validator_version: sourceBinding.preflight_request_validator_version,
    entry_reference_id: sourceBinding.entry_reference_id,
    entry_reference_fingerprint: sourceBinding.entry_reference_fingerprint,
    entry_reference_validator_version: sourceBinding.entry_reference_validator_version,
    entry_id: sourceBinding.entry_id,
    entry_fingerprint: sourceBinding.entry_fingerprint,
    entry_validator_version: sourceBinding.entry_validator_version,
    readiness_id: sourceBinding.readiness_id,
    readiness_fingerprint: sourceBinding.readiness_fingerprint,
    readiness_validator_version: sourceBinding.readiness_validator_version,
    trial_id: sourceBinding.trial_id,
    plan_hash: sourceBinding.plan_hash,
    preparation_eligibility_id: sourceBinding.preparation_eligibility_id,
    tenant_id: sourceBinding.tenant_id,
    execution_mode: 'NON_SIDE_EFFECT_SIMULATION_ONLY',
    simulated: true,
    executed: false,
    dry_run_execution: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    real_execution_authorized: false,
    production_effect: 'ZERO'
  };
  const material = {
    validator_version: PUBLIC_WEB_CANARY_PREFLIGHT_REQUEST_CONSUMER_VALIDATOR_VERSION,
    status,
    decision,
    next_state: nextState,
    reason_codes: reasonCodes,
    source_binding: sourceBinding,
    dry_run_request: dryRunRequest,
    authority_boundary: authority,
    simulated: true,
    executed: false,
    production_effect: 'ZERO'
  };
  const evidence = {
    preflight_request_validated: ok,
    preflight_request_identity_bound:
      ok &&
      isNonEmptyString(sourceBinding.preflight_request_id) &&
      isNonEmptyString(sourceBinding.preflight_request_fingerprint),
    entry_reference_identity_bound:
      ok &&
      isNonEmptyString(sourceBinding.entry_reference_id) &&
      isNonEmptyString(sourceBinding.entry_reference_fingerprint),
    entry_identity_bound:
      ok && isNonEmptyString(sourceBinding.entry_id) && isNonEmptyString(sourceBinding.entry_fingerprint),
    readiness_identity_bound:
      ok &&
      isNonEmptyString(sourceBinding.readiness_id) &&
      isNonEmptyString(sourceBinding.readiness_fingerprint),
    simulated: true,
    executed: false,
    dry_run_execution: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    real_execution_authorized: false,
    production_effect: 'ZERO'
  };
  const audit = {
    event_name: ok
      ? 'public_web_canary_dry_run_request_prepared_simulation'
      : 'public_web_canary_preflight_request_consumer_blocked',
    decision,
    next_state: nextState,
    reason_codes: reasonCodes,
    provider_called: false,
    external_network_used: false,
    production_effect: 'ZERO'
  };
  const dryRunRequestId =
    `public_web_canary_dry_run_request:${digest({ material, evidence })}`;

  return cloneFrozen({
    ok,
    status,
    decision,
    next_state: nextState,
    reason_codes: reasonCodes,
    dry_run_request_id: dryRunRequestId,
    dry_run_request_fingerprint: digest({ material, evidence, audit }),
    dry_run_request: dryRunRequest,
    source_binding: sourceBinding,
    authority_boundary: authority,
    evidence,
    audit,
    validator_version: PUBLIC_WEB_CANARY_PREFLIGHT_REQUEST_CONSUMER_VALIDATOR_VERSION
  });
}

function evaluatePublicWebCanaryPreflightRequestConsumerBoundary(
  consumerResult,
  referenceResult,
  entryResult
) {
  const failures = collectSourceFailures(consumerResult, referenceResult, entryResult);
  return buildResult(consumerResult, failures);
}

function validatePublicWebCanaryPreflightRequestConsumerBoundaryResult(
  result,
  consumerResult,
  referenceResult,
  entryResult
) {
  const errors = [];
  if (!isPlainObject(result)) {
    return { valid: false, errors: ['preflight_request_consumer_result_must_be_object'] };
  }
  if (!PUBLIC_WEB_CANARY_PREFLIGHT_REQUEST_CONSUMER_STATUSES.includes(result.status)) {
    errors.push('status_invalid');
  }
  if (!PUBLIC_WEB_CANARY_PREFLIGHT_REQUEST_CONSUMER_DECISIONS.includes(result.decision)) {
    errors.push('decision_invalid');
  }
  if (!PUBLIC_WEB_CANARY_PREFLIGHT_REQUEST_CONSUMER_NEXT_STATES.includes(result.next_state)) {
    errors.push('next_state_invalid');
  }
  if (!isNonEmptyString(result.dry_run_request_id)) {
    errors.push('dry_run_request_id_invalid');
  }
  if (!isNonEmptyString(result.dry_run_request_fingerprint)) {
    errors.push('dry_run_request_fingerprint_invalid');
  }
  if (result.validator_version !== PUBLIC_WEB_CANARY_PREFLIGHT_REQUEST_CONSUMER_VALIDATOR_VERSION) {
    errors.push('validator_version_invalid');
  }

  const expected = evaluatePublicWebCanaryPreflightRequestConsumerBoundary(
    consumerResult,
    referenceResult,
    entryResult
  );
  if (!valuesEqual(result, expected)) {
    errors.push('preflight_request_consumer_context_mismatch');
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

  if (isPlainObject(result.dry_run_request)) {
    if (result.dry_run_request.simulated !== true) {
      errors.push('dry_run_request_simulated_required');
    }
    if (result.dry_run_request.executed !== false) {
      errors.push('dry_run_request_executed_must_be_false');
    }
    if (result.dry_run_request.dry_run_execution !== false) {
      errors.push('dry_run_request_execution_must_be_false');
    }
    if (result.dry_run_request.real_provider_called !== false) {
      errors.push('dry_run_request_real_provider_called_must_be_false');
    }
    if (result.dry_run_request.can_trigger_real_execution !== false) {
      errors.push('dry_run_request_can_trigger_real_execution_must_be_false');
    }
    if (result.dry_run_request.real_execution_authorized !== false) {
      errors.push('dry_run_request_real_execution_authorized_must_be_false');
    }
    if (result.dry_run_request.production_effect !== 'ZERO') {
      errors.push('dry_run_request_production_effect_must_be_zero');
    }
  } else {
    errors.push('dry_run_request_must_be_object');
  }

  if (isPlainObject(result.evidence)) {
    if (result.evidence.simulated !== true) errors.push('evidence_simulated_required');
    if (result.evidence.executed !== false) errors.push('evidence_executed_must_be_false');
    if (result.evidence.dry_run_execution !== false) {
      errors.push('evidence_dry_run_execution_must_be_false');
    }
    if (result.evidence.real_provider_called !== false) {
      errors.push('evidence_real_provider_called_must_be_false');
    }
    if (result.evidence.can_trigger_real_execution !== false) {
      errors.push('evidence_can_trigger_real_execution_must_be_false');
    }
    if (result.evidence.real_execution_authorized !== false) {
      errors.push('evidence_real_execution_authorized_must_be_false');
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
  PUBLIC_WEB_CANARY_PREFLIGHT_REQUEST_CONSUMER_DECISIONS,
  PUBLIC_WEB_CANARY_PREFLIGHT_REQUEST_CONSUMER_NEXT_STATES,
  PUBLIC_WEB_CANARY_PREFLIGHT_REQUEST_CONSUMER_STATUSES,
  PUBLIC_WEB_CANARY_PREFLIGHT_REQUEST_CONSUMER_VALIDATOR_VERSION,
  evaluatePublicWebCanaryPreflightRequestConsumerBoundary,
  validatePublicWebCanaryPreflightRequestConsumerBoundaryResult
};
