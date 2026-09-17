'use strict';

const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  PUBLIC_WEB_CANARY_PREFLIGHT_REQUEST_CONSUMER_VALIDATOR_VERSION,
  validatePublicWebCanaryPreflightRequestConsumerBoundaryResult
} = require('./public-web-canary-preflight-request-consumer-boundary');

const PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_CONSUMER_VALIDATOR_VERSION =
  'public_web_canary_dry_run_request_consumer_boundary_v1';

const PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_CONSUMER_STATUSES = Object.freeze([
  'PUBLIC_WEB_CANARY_FAKE_DRY_RUN_EVIDENCE_PREPARED_SIMULATION',
  'PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_CONSUMER_BLOCKED',
  'PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_CONSUMER_VALIDATION_FAILED'
]);

const PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_CONSUMER_DECISIONS = Object.freeze([
  'EVALUATE_PUBLIC_WEB_CANARY_FAKE_ONLY_DRY_RUN',
  'BLOCKED'
]);

const PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_CONSUMER_NEXT_STATES = Object.freeze([
  'WAITING_PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_BOUNDARY',
  'BLOCKED_REFERENCE'
]);

const SUCCESS = Object.freeze({
  status: 'PUBLIC_WEB_CANARY_FAKE_DRY_RUN_EVIDENCE_PREPARED_SIMULATION',
  decision: 'EVALUATE_PUBLIC_WEB_CANARY_FAKE_ONLY_DRY_RUN',
  next_state: 'WAITING_PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_BOUNDARY'
});

const BLOCKED = Object.freeze({
  decision: 'BLOCKED',
  next_state: 'BLOCKED_REFERENCE'
});

const SOURCE_SUCCESS_REASON =
  'public_web_canary_dry_run_request_prepared_from_validated_preflight_request_non_side_effect_only';

const SUCCESS_REASON =
  'public_web_canary_fake_dry_run_evidence_prepared_from_validated_dry_run_request_non_side_effect_only';

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
  'preflight_request_id',
  'preflight_request_fingerprint',
  'preflight_request_validator_version',
  'entry_reference_id',
  'entry_reference_fingerprint',
  'entry_reference_validator_version',
  'entry_id',
  'entry_fingerprint',
  'entry_validator_version',
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

function safeSourceBinding(dryRunResult) {
  const safe = isPlainObject(dryRunResult) ? dryRunResult : {};
  const request = isPlainObject(safe.dry_run_request) ? safe.dry_run_request : {};

  return {
    dry_run_request_id: isNonEmptyString(safe.dry_run_request_id)
      ? safe.dry_run_request_id
      : null,
    dry_run_request_fingerprint: isNonEmptyString(safe.dry_run_request_fingerprint)
      ? safe.dry_run_request_fingerprint
      : null,
    dry_run_request_validator_version: isNonEmptyString(safe.validator_version)
      ? safe.validator_version
      : null,
    preflight_request_id: isNonEmptyString(request.preflight_request_id)
      ? request.preflight_request_id
      : null,
    preflight_request_fingerprint: isNonEmptyString(request.preflight_request_fingerprint)
      ? request.preflight_request_fingerprint
      : null,
    preflight_request_validator_version: isNonEmptyString(request.preflight_request_validator_version)
      ? request.preflight_request_validator_version
      : null,
    entry_reference_id: isNonEmptyString(request.entry_reference_id)
      ? request.entry_reference_id
      : null,
    entry_reference_fingerprint: isNonEmptyString(request.entry_reference_fingerprint)
      ? request.entry_reference_fingerprint
      : null,
    entry_reference_validator_version: isNonEmptyString(request.entry_reference_validator_version)
      ? request.entry_reference_validator_version
      : null,
    entry_id: isNonEmptyString(request.entry_id) ? request.entry_id : null,
    entry_fingerprint: isNonEmptyString(request.entry_fingerprint)
      ? request.entry_fingerprint
      : null,
    entry_validator_version: isNonEmptyString(request.entry_validator_version)
      ? request.entry_validator_version
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

function collectSourceFailures(
  dryRunResult,
  consumerResult,
  referenceResult,
  entryResult
) {
  const failures = [];
  if (!isPlainObject(dryRunResult)) {
    return ['dry_run_request_consumer_source_missing'];
  }

  if (dryRunResult.ok !== true) failures.push('dry_run_request_consumer_source_not_ok');
  if (dryRunResult.status !== 'PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_PREPARED_SIMULATION') {
    failures.push('dry_run_request_consumer_source_status_not_prepared');
  }
  if (
    dryRunResult.decision !==
    'PREPARE_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_DRY_RUN_REQUEST'
  ) {
    failures.push('dry_run_request_consumer_source_decision_not_prepare');
  }
  if (dryRunResult.next_state !== 'WAITING_PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_CONSUMER') {
    failures.push('dry_run_request_consumer_source_next_state_not_waiting_consumer');
  }
  if (
    dryRunResult.validator_version !==
    PUBLIC_WEB_CANARY_PREFLIGHT_REQUEST_CONSUMER_VALIDATOR_VERSION
  ) {
    failures.push('dry_run_request_consumer_source_validator_version_mismatch');
  }
  if (!valuesEqual(dryRunResult.reason_codes, [SOURCE_SUCCESS_REASON])) {
    failures.push('dry_run_request_consumer_source_reason_codes_mismatch');
  }

  for (const legacyField of [
    'ready',
    'authorized',
    'canary_authorized',
    'execution_authorized',
    'dry_run_authorized',
    'operator_confirmation_authorized',
    'trial_execution_authorized',
    'ready_for_real_execution',
    'can_trigger_real_execution'
  ]) {
    if (Object.prototype.hasOwnProperty.call(dryRunResult, legacyField)) {
      failures.push(`legacy_dry_run_request_consumer_field_forbidden::${legacyField}`);
    }
  }

  if (!isPlainObject(consumerResult)) failures.push('preflight_request_consumer_result_missing');
  if (!isPlainObject(referenceResult)) failures.push('preflight_entry_reference_result_missing');
  if (!isPlainObject(entryResult)) failures.push('preflight_entry_result_missing');

  if (
    isPlainObject(consumerResult) &&
    isPlainObject(referenceResult) &&
    isPlainObject(entryResult)
  ) {
    const validation = validatePublicWebCanaryPreflightRequestConsumerBoundaryResult(
      dryRunResult,
      consumerResult,
      referenceResult,
      entryResult
    );
    if (!validation.valid) {
      for (const error of validation.errors) {
        failures.push(`dry_run_request_source_validation::${error}`);
      }
    }
  }

  if (!isNonEmptyString(dryRunResult.dry_run_request_id)) {
    failures.push('dry_run_request_id_invalid');
  }
  if (!isNonEmptyString(dryRunResult.dry_run_request_fingerprint)) {
    failures.push('dry_run_request_fingerprint_invalid');
  }

  const request = isPlainObject(dryRunResult.dry_run_request)
    ? dryRunResult.dry_run_request
    : null;
  const sourceBinding = isPlainObject(dryRunResult.source_binding)
    ? dryRunResult.source_binding
    : null;

  if (!request) {
    failures.push('dry_run_request_missing');
  } else {
    if (
      request.request_type !==
      'PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_DRY_RUN_REQUEST_SIMULATION'
    ) {
      failures.push('dry_run_request_type_mismatch');
    }
    for (const field of REQUEST_BINDING_FIELDS) {
      if (!isNonEmptyString(request[field])) {
        failures.push(`dry_run_request_${field}_invalid`);
      }
    }
    if (request.execution_mode !== 'NON_SIDE_EFFECT_SIMULATION_ONLY') {
      failures.push('dry_run_request_execution_mode_mismatch');
    }
    if (request.simulated !== true) failures.push('dry_run_request_simulated_required');
    if (request.executed !== false) failures.push('dry_run_request_executed_must_be_false');
    if (request.dry_run_execution !== false) {
      failures.push('dry_run_request_execution_must_be_false');
    }
    if (request.real_provider_called !== false) {
      failures.push('dry_run_request_real_provider_called_must_be_false');
    }
    if (request.can_trigger_real_execution !== false) {
      failures.push('dry_run_request_can_trigger_real_execution_must_be_false');
    }
    if (request.real_execution_authorized !== false) {
      failures.push('dry_run_request_real_execution_authorized_must_be_false');
    }
    if (request.production_effect !== 'ZERO') {
      failures.push('dry_run_request_production_effect_must_be_zero');
    }
  }

  if (!sourceBinding) {
    failures.push('dry_run_request_source_binding_missing');
  } else if (request) {
    for (const field of REQUEST_BINDING_FIELDS) {
      if (request[field] !== sourceBinding[field]) {
        failures.push(`dry_run_request_source_binding_${field}_mismatch`);
      }
    }
  }

  const authority = isPlainObject(dryRunResult.authority_boundary)
    ? dryRunResult.authority_boundary
    : null;
  if (!authority) {
    failures.push('dry_run_request_consumer_source_authority_missing');
  } else {
    if (authority.preflight_request_seen !== true) {
      failures.push('dry_run_request_consumer_source_preflight_request_seen_required');
    }
    if (authority.preflight_request_validated !== true) {
      failures.push('dry_run_request_consumer_source_preflight_request_validated_required');
    }
    if (authority.dry_run_request_prepared !== true) {
      failures.push('dry_run_request_consumer_source_request_prepared_required');
    }
    if (authority.non_side_effect_only !== true) {
      failures.push('dry_run_request_consumer_source_non_side_effect_only_required');
    }
    for (const field of SAFE_FALSE_AUTHORITY_FIELDS) {
      if (authority[field] !== false) {
        failures.push(`dry_run_request_consumer_source_authority_${field}_must_be_false`);
      }
    }
    if (authority.production_effect !== 'ZERO') {
      failures.push('dry_run_request_consumer_source_authority_production_effect_must_be_zero');
    }
  }

  const evidence = isPlainObject(dryRunResult.evidence) ? dryRunResult.evidence : null;
  if (!evidence) {
    failures.push('dry_run_request_consumer_source_evidence_missing');
  } else {
    for (const field of [
      'preflight_request_validated',
      'preflight_request_identity_bound',
      'entry_reference_identity_bound',
      'entry_identity_bound',
      'readiness_identity_bound'
    ]) {
      if (evidence[field] !== true) {
        failures.push(`dry_run_request_consumer_source_evidence_${field}_required`);
      }
    }
    if (evidence.simulated !== true) {
      failures.push('dry_run_request_consumer_source_evidence_simulated_required');
    }
    if (evidence.executed !== false) {
      failures.push('dry_run_request_consumer_source_evidence_executed_must_be_false');
    }
    if (evidence.dry_run_execution !== false) {
      failures.push('dry_run_request_consumer_source_evidence_dry_run_execution_must_be_false');
    }
    if (evidence.real_provider_called !== false) {
      failures.push('dry_run_request_consumer_source_evidence_real_provider_called_must_be_false');
    }
    if (evidence.can_trigger_real_execution !== false) {
      failures.push('dry_run_request_consumer_source_evidence_can_trigger_real_execution_must_be_false');
    }
    if (evidence.real_execution_authorized !== false) {
      failures.push('dry_run_request_consumer_source_evidence_real_execution_authorized_must_be_false');
    }
    if (evidence.production_effect !== 'ZERO') {
      failures.push('dry_run_request_consumer_source_evidence_production_effect_must_be_zero');
    }
  }

  const audit = isPlainObject(dryRunResult.audit) ? dryRunResult.audit : null;
  if (!audit) {
    failures.push('dry_run_request_consumer_source_audit_missing');
  } else {
    if (audit.event_name !== 'public_web_canary_dry_run_request_prepared_simulation') {
      failures.push('dry_run_request_consumer_source_audit_event_mismatch');
    }
    if (audit.decision !== 'PREPARE_PUBLIC_WEB_CANARY_NON_SIDE_EFFECT_DRY_RUN_REQUEST') {
      failures.push('dry_run_request_consumer_source_audit_decision_mismatch');
    }
    if (audit.next_state !== 'WAITING_PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_CONSUMER') {
      failures.push('dry_run_request_consumer_source_audit_next_state_mismatch');
    }
    if (!valuesEqual(audit.reason_codes, [SOURCE_SUCCESS_REASON])) {
      failures.push('dry_run_request_consumer_source_audit_reason_codes_mismatch');
    }
    if (audit.provider_called !== false) {
      failures.push('dry_run_request_consumer_source_audit_provider_called_must_be_false');
    }
    if (audit.external_network_used !== false) {
      failures.push('dry_run_request_consumer_source_audit_external_network_used_must_be_false');
    }
    if (audit.production_effect !== 'ZERO') {
      failures.push('dry_run_request_consumer_source_audit_production_effect_must_be_zero');
    }
  }

  return uniqueSorted(failures);
}

function authorityBoundary(ok) {
  return {
    dry_run_request_seen: true,
    dry_run_request_validated: ok === true,
    fake_dry_run_evaluated: ok === true,
    fake_only: true,
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

function buildResult(dryRunResult, failures) {
  const ok = failures.length === 0;
  const validationFailure = failures.some(
    (reason) =>
      reason.endsWith('_missing') ||
      reason.endsWith('_invalid') ||
      reason.includes('mismatch') ||
      reason.startsWith('dry_run_request_source_validation::')
  );
  const status = ok
    ? SUCCESS.status
    : validationFailure
      ? 'PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_CONSUMER_VALIDATION_FAILED'
      : 'PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_CONSUMER_BLOCKED';
  const decision = ok ? SUCCESS.decision : BLOCKED.decision;
  const nextState = ok ? SUCCESS.next_state : BLOCKED.next_state;
  const reasonCodes = ok ? [SUCCESS_REASON] : uniqueSorted([...failures, 'fail_closed']);
  const sourceBinding = safeSourceBinding(dryRunResult);
  const authority = authorityBoundary(ok);
  const fakeDryRunEvidence = {
    evidence_type: 'PUBLIC_WEB_CANARY_FAKE_ONLY_DRY_RUN_EVIDENCE_SIMULATION',
    dry_run_request_id: sourceBinding.dry_run_request_id,
    dry_run_request_fingerprint: sourceBinding.dry_run_request_fingerprint,
    dry_run_request_validator_version: sourceBinding.dry_run_request_validator_version,
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
    fake_dry_run_evaluated: ok,
    evaluation_outcome: ok
      ? 'FAKE_DRY_RUN_EVALUATION_PASSED'
      : 'FAKE_DRY_RUN_EVALUATION_BLOCKED',
    simulated: true,
    executed: false,
    dry_run_execution: false,
    real_provider_called: false,
    external_network_used: false,
    secret_resolved: false,
    can_trigger_real_execution: false,
    real_execution_authorized: false,
    production_effect: 'ZERO'
  };
  const material = {
    validator_version: PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_CONSUMER_VALIDATOR_VERSION,
    status,
    decision,
    next_state: nextState,
    reason_codes: reasonCodes,
    source_binding: sourceBinding,
    fake_dry_run_evidence: fakeDryRunEvidence,
    authority_boundary: authority,
    simulated: true,
    executed: false,
    production_effect: 'ZERO'
  };
  const evidence = {
    dry_run_request_validated: ok,
    dry_run_request_identity_bound:
      ok &&
      isNonEmptyString(sourceBinding.dry_run_request_id) &&
      isNonEmptyString(sourceBinding.dry_run_request_fingerprint),
    preflight_request_identity_bound:
      ok &&
      isNonEmptyString(sourceBinding.preflight_request_id) &&
      isNonEmptyString(sourceBinding.preflight_request_fingerprint),
    entry_reference_identity_bound:
      ok &&
      isNonEmptyString(sourceBinding.entry_reference_id) &&
      isNonEmptyString(sourceBinding.entry_reference_fingerprint),
    entry_identity_bound:
      ok &&
      isNonEmptyString(sourceBinding.entry_id) &&
      isNonEmptyString(sourceBinding.entry_fingerprint),
    readiness_identity_bound:
      ok &&
      isNonEmptyString(sourceBinding.readiness_id) &&
      isNonEmptyString(sourceBinding.readiness_fingerprint),
    fake_dry_run_evaluated: ok,
    simulated: true,
    executed: false,
    dry_run_execution: false,
    real_provider_called: false,
    external_network_used: false,
    secret_resolved: false,
    can_trigger_real_execution: false,
    real_execution_authorized: false,
    production_effect: 'ZERO'
  };
  const audit = {
    event_name: ok
      ? 'public_web_canary_fake_dry_run_evidence_prepared_simulation'
      : 'public_web_canary_dry_run_request_consumer_blocked',
    decision,
    next_state: nextState,
    reason_codes: reasonCodes,
    fake_only: true,
    provider_called: false,
    external_network_used: false,
    secret_resolved: false,
    production_effect: 'ZERO'
  };
  const fakeDryRunEvidenceId =
    `public_web_canary_fake_dry_run_evidence:${digest({ material, evidence })}`;

  return cloneFrozen({
    ok,
    status,
    decision,
    next_state: nextState,
    reason_codes: reasonCodes,
    fake_dry_run_evidence_id: fakeDryRunEvidenceId,
    fake_dry_run_evidence_fingerprint: digest({ material, evidence, audit }),
    fake_dry_run_evidence: fakeDryRunEvidence,
    source_binding: sourceBinding,
    authority_boundary: authority,
    evidence,
    audit,
    validator_version: PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_CONSUMER_VALIDATOR_VERSION
  });
}

function evaluatePublicWebCanaryDryRunRequestConsumerBoundary(
  dryRunResult,
  consumerResult,
  referenceResult,
  entryResult
) {
  const failures = collectSourceFailures(
    dryRunResult,
    consumerResult,
    referenceResult,
    entryResult
  );
  return buildResult(dryRunResult, failures);
}

function validatePublicWebCanaryDryRunRequestConsumerBoundaryResult(
  result,
  dryRunResult,
  consumerResult,
  referenceResult,
  entryResult
) {
  const errors = [];
  if (!isPlainObject(result)) {
    return { valid: false, errors: ['dry_run_request_consumer_result_must_be_object'] };
  }
  if (!PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_CONSUMER_STATUSES.includes(result.status)) {
    errors.push('status_invalid');
  }
  if (!PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_CONSUMER_DECISIONS.includes(result.decision)) {
    errors.push('decision_invalid');
  }
  if (!PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_CONSUMER_NEXT_STATES.includes(result.next_state)) {
    errors.push('next_state_invalid');
  }
  if (!isNonEmptyString(result.fake_dry_run_evidence_id)) {
    errors.push('fake_dry_run_evidence_id_invalid');
  }
  if (!isNonEmptyString(result.fake_dry_run_evidence_fingerprint)) {
    errors.push('fake_dry_run_evidence_fingerprint_invalid');
  }
  if (result.validator_version !== PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_CONSUMER_VALIDATOR_VERSION) {
    errors.push('validator_version_invalid');
  }

  const expected = evaluatePublicWebCanaryDryRunRequestConsumerBoundary(
    dryRunResult,
    consumerResult,
    referenceResult,
    entryResult
  );
  if (!valuesEqual(result, expected)) {
    errors.push('dry_run_request_consumer_context_mismatch');
  }

  if (isPlainObject(result.authority_boundary)) {
    if (result.authority_boundary.fake_only !== true) {
      errors.push('authority_fake_only_required');
    }
    if (result.authority_boundary.non_side_effect_only !== true) {
      errors.push('authority_non_side_effect_only_required');
    }
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

  if (isPlainObject(result.fake_dry_run_evidence)) {
    if (result.fake_dry_run_evidence.simulated !== true) {
      errors.push('fake_dry_run_evidence_simulated_required');
    }
    if (result.fake_dry_run_evidence.executed !== false) {
      errors.push('fake_dry_run_evidence_executed_must_be_false');
    }
    if (result.fake_dry_run_evidence.dry_run_execution !== false) {
      errors.push('fake_dry_run_evidence_dry_run_execution_must_be_false');
    }
    if (result.fake_dry_run_evidence.real_provider_called !== false) {
      errors.push('fake_dry_run_evidence_real_provider_called_must_be_false');
    }
    if (result.fake_dry_run_evidence.external_network_used !== false) {
      errors.push('fake_dry_run_evidence_external_network_used_must_be_false');
    }
    if (result.fake_dry_run_evidence.secret_resolved !== false) {
      errors.push('fake_dry_run_evidence_secret_resolved_must_be_false');
    }
    if (result.fake_dry_run_evidence.can_trigger_real_execution !== false) {
      errors.push('fake_dry_run_evidence_can_trigger_real_execution_must_be_false');
    }
    if (result.fake_dry_run_evidence.real_execution_authorized !== false) {
      errors.push('fake_dry_run_evidence_real_execution_authorized_must_be_false');
    }
    if (result.fake_dry_run_evidence.production_effect !== 'ZERO') {
      errors.push('fake_dry_run_evidence_production_effect_must_be_zero');
    }
  } else {
    errors.push('fake_dry_run_evidence_must_be_object');
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
    if (result.evidence.external_network_used !== false) {
      errors.push('evidence_external_network_used_must_be_false');
    }
    if (result.evidence.secret_resolved !== false) {
      errors.push('evidence_secret_resolved_must_be_false');
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
  PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_CONSUMER_DECISIONS,
  PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_CONSUMER_NEXT_STATES,
  PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_CONSUMER_STATUSES,
  PUBLIC_WEB_CANARY_DRY_RUN_REQUEST_CONSUMER_VALIDATOR_VERSION,
  evaluatePublicWebCanaryDryRunRequestConsumerBoundary,
  validatePublicWebCanaryDryRunRequestConsumerBoundaryResult
};