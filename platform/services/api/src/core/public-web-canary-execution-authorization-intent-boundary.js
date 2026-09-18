'use strict';

const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_VALIDATOR_VERSION,
  validatePublicWebCanaryExecutionAuthorizationReviewBoundaryResult
} = require('./public-web-canary-execution-authorization-review-boundary');

const PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_VALIDATOR_VERSION =
  'public_web_canary_execution_authorization_intent_boundary_v1';

const PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_STATUSES = Object.freeze([
  'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_PREPARED_SIMULATION',
  'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_BLOCKED',
  'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_VALIDATION_FAILED'
]);

const PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_DECISIONS = Object.freeze([
  'PREPARE_PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT',
  'BLOCKED'
]);

const PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_NEXT_STATES = Object.freeze([
  'WAITING_PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANT_BOUNDARY',
  'BLOCKED_REFERENCE'
]);

const SUCCESS = Object.freeze({
  status: 'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_PREPARED_SIMULATION',
  decision: 'PREPARE_PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT',
  next_state: 'WAITING_PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANT_BOUNDARY'
});

const BLOCKED = Object.freeze({
  decision: 'BLOCKED',
  next_state: 'BLOCKED_REFERENCE'
});

const SOURCE_SUCCESS_REASON =
  'public_web_canary_execution_authorization_review_prepared_from_validated_fake_dry_run_evidence_non_side_effect_only';

const SUCCESS_REASON =
  'public_web_canary_execution_authorization_intent_prepared_for_explicit_future_grant_non_side_effect_only';

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

const REVIEW_BINDING_FIELDS = Object.freeze([
  'fake_dry_run_evidence_id',
  'fake_dry_run_evidence_fingerprint',
  'fake_dry_run_evidence_validator_version',
  'dry_run_request_id',
  'dry_run_request_fingerprint',
  'dry_run_request_validator_version',
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

const LEGACY_OR_AUTHORITY_FIELDS = Object.freeze([
  'ready',
  'authorized',
  'canary_authorized',
  'execution_authorized',
  'dry_run_authorized',
  'operator_confirmation_authorized',
  'trial_execution_authorized',
  'ready_for_real_execution',
  'can_trigger_real_execution',
  'real_execution_authorized',
  'authorization_granted',
  'execution_reservation_created',
  'authorization_token',
  'reservation_id'
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

function safeReviewBinding(reviewResult) {
  const safe = isPlainObject(reviewResult) ? reviewResult : {};
  const request = isPlainObject(safe.authorization_review_request)
    ? safe.authorization_review_request
    : {};
  const binding = {
    authorization_review_request_id: isNonEmptyString(safe.authorization_review_request_id)
      ? safe.authorization_review_request_id
      : null,
    authorization_review_request_fingerprint: isNonEmptyString(
      safe.authorization_review_request_fingerprint
    )
      ? safe.authorization_review_request_fingerprint
      : null,
    authorization_review_validator_version: isNonEmptyString(safe.validator_version)
      ? safe.validator_version
      : null
  };

  for (const field of REVIEW_BINDING_FIELDS) {
    binding[field] = isNonEmptyString(request[field]) ? request[field] : null;
  }

  return binding;
}

function normalizeIntent(intent) {
  if (!isPlainObject(intent)) return null;

  return {
    environment: isNonEmptyString(intent.environment)
      ? intent.environment.trim().toLowerCase()
      : null,
    authorization_scope: isNonEmptyString(intent.authorization_scope)
      ? intent.authorization_scope
      : null,
    approval_mode: isNonEmptyString(intent.approval_mode)
      ? intent.approval_mode
      : null,
    operator_id: isNonEmptyString(intent.operator_id) ? intent.operator_id : null,
    approver_id: isNonEmptyString(intent.approver_id) ? intent.approver_id : null,
    requested_execution_count: Number.isInteger(intent.requested_execution_count)
      ? intent.requested_execution_count
      : null,
    ttl_seconds: Number.isInteger(intent.ttl_seconds) ? intent.ttl_seconds : null,
    replay_key: isNonEmptyString(intent.replay_key) ? intent.replay_key : null,
    request_reference: isNonEmptyString(intent.request_reference)
      ? intent.request_reference
      : null
  };
}

function collectIntentFailures(intent) {
  const failures = [];

  if (!isPlainObject(intent)) {
    return ['execution_authorization_intent_missing'];
  }

  for (const field of LEGACY_OR_AUTHORITY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(intent, field)) {
      failures.push('execution_authorization_intent_forbidden_field::' + field);
    }
  }

  const normalized = normalizeIntent(intent);
  if (!normalized) return uniqueSorted(failures.concat(['execution_authorization_intent_invalid']));

  if (!['development', 'staging'].includes(normalized.environment)) {
    failures.push('execution_authorization_intent_environment_not_non_production');
  }
  if (
    normalized.authorization_scope !==
    'PUBLIC_WEB_CANARY_SINGLE_EXECUTION_NON_PRODUCTION'
  ) {
    failures.push('execution_authorization_intent_scope_mismatch');
  }
  if (normalized.approval_mode !== 'DUAL_CONTROL_REQUIRED') {
    failures.push('execution_authorization_intent_approval_mode_mismatch');
  }
  if (!isNonEmptyString(normalized.operator_id)) {
    failures.push('execution_authorization_intent_operator_id_invalid');
  }
  if (!isNonEmptyString(normalized.approver_id)) {
    failures.push('execution_authorization_intent_approver_id_invalid');
  }
  if (
    isNonEmptyString(normalized.operator_id) &&
    isNonEmptyString(normalized.approver_id) &&
    normalized.operator_id === normalized.approver_id
  ) {
    failures.push('execution_authorization_intent_dual_control_required');
  }
  if (normalized.requested_execution_count !== 1) {
    failures.push('execution_authorization_intent_execution_count_must_be_one');
  }
  if (
    !Number.isInteger(normalized.ttl_seconds) ||
    normalized.ttl_seconds < 1 ||
    normalized.ttl_seconds > 900
  ) {
    failures.push('execution_authorization_intent_ttl_out_of_range');
  }
  if (!isNonEmptyString(normalized.replay_key)) {
    failures.push('execution_authorization_intent_replay_key_invalid');
  }
  if (!isNonEmptyString(normalized.request_reference)) {
    failures.push('execution_authorization_intent_request_reference_invalid');
  }

  return uniqueSorted(failures);
}

function collectSourceFailures(
  reviewResult,
  fakeDryRunResult,
  dryRunResult,
  consumerResult,
  referenceResult,
  entryResult
) {
  const failures = [];

  if (!isPlainObject(reviewResult)) {
    return ['execution_authorization_intent_source_missing'];
  }

  if (reviewResult.ok !== true) failures.push('execution_authorization_intent_source_not_ok');
  if (
    reviewResult.status !==
    'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_PREPARED_SIMULATION'
  ) {
    failures.push('execution_authorization_intent_source_status_not_prepared');
  }
  if (
    reviewResult.decision !==
    'PREPARE_PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW'
  ) {
    failures.push('execution_authorization_intent_source_decision_mismatch');
  }
  if (
    reviewResult.next_state !==
    'WAITING_PUBLIC_WEB_CANARY_EXPLICIT_EXECUTION_AUTHORIZATION'
  ) {
    failures.push('execution_authorization_intent_source_next_state_mismatch');
  }
  if (
    reviewResult.validator_version !==
    PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_VALIDATOR_VERSION
  ) {
    failures.push('execution_authorization_intent_source_validator_version_mismatch');
  }
  if (!valuesEqual(reviewResult.reason_codes, [SOURCE_SUCCESS_REASON])) {
    failures.push('execution_authorization_intent_source_reason_codes_mismatch');
  }

  for (const field of LEGACY_OR_AUTHORITY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(reviewResult, field)) {
      failures.push('legacy_execution_authorization_intent_source_field_forbidden::' + field);
    }
  }

  if (
    isPlainObject(fakeDryRunResult) &&
    isPlainObject(dryRunResult) &&
    isPlainObject(consumerResult) &&
    isPlainObject(referenceResult) &&
    isPlainObject(entryResult)
  ) {
    const validation = validatePublicWebCanaryExecutionAuthorizationReviewBoundaryResult(
      reviewResult,
      fakeDryRunResult,
      dryRunResult,
      consumerResult,
      referenceResult,
      entryResult
    );
    if (!validation.valid) {
      for (const error of validation.errors) {
        failures.push('execution_authorization_intent_source_validation::' + error);
      }
    }
  } else {
    if (!isPlainObject(fakeDryRunResult)) failures.push('fake_dry_run_result_missing');
    if (!isPlainObject(dryRunResult)) failures.push('dry_run_result_missing');
    if (!isPlainObject(consumerResult)) failures.push('preflight_request_consumer_result_missing');
    if (!isPlainObject(referenceResult)) failures.push('preflight_entry_reference_result_missing');
    if (!isPlainObject(entryResult)) failures.push('preflight_entry_result_missing');
  }

  if (!isNonEmptyString(reviewResult.authorization_review_request_id)) {
    failures.push('authorization_review_request_id_invalid');
  }
  if (!isNonEmptyString(reviewResult.authorization_review_request_fingerprint)) {
    failures.push('authorization_review_request_fingerprint_invalid');
  }

  const request = isPlainObject(reviewResult.authorization_review_request)
    ? reviewResult.authorization_review_request
    : null;

  if (!request) {
    failures.push('authorization_review_request_missing');
  } else {
    if (
      request.request_type !==
      'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_REVIEW_REQUEST_SIMULATION'
    ) {
      failures.push('authorization_review_request_type_mismatch');
    }
    for (const field of REVIEW_BINDING_FIELDS) {
      if (!isNonEmptyString(request[field])) {
        failures.push('authorization_review_request_' + field + '_invalid');
      }
    }
    if (request.review_scope !== 'NON_PRODUCTION_SINGLE_EXECUTION_REVIEW_ONLY') {
      failures.push('authorization_review_request_scope_mismatch');
    }
    if (request.explicit_separate_authorization_required !== true) {
      failures.push('authorization_review_request_separate_authorization_required');
    }
    if (request.review_prepared !== true) {
      failures.push('authorization_review_request_review_prepared_required');
    }
    if (request.authorization_granted !== false) {
      failures.push('authorization_review_request_authorization_granted_must_be_false');
    }
    if (request.execution_reservation_created !== false) {
      failures.push('authorization_review_request_reservation_created_must_be_false');
    }
    if (request.can_trigger_real_execution !== false) {
      failures.push('authorization_review_request_can_trigger_real_execution_must_be_false');
    }
    if (request.real_execution_authorized !== false) {
      failures.push('authorization_review_request_real_execution_authorized_must_be_false');
    }
    if (request.simulated !== true) {
      failures.push('authorization_review_request_simulated_required');
    }
    if (request.executed !== false) {
      failures.push('authorization_review_request_executed_must_be_false');
    }
    if (request.production_effect !== 'ZERO') {
      failures.push('authorization_review_request_production_effect_must_be_zero');
    }
  }

  const authority = isPlainObject(reviewResult.authority_boundary)
    ? reviewResult.authority_boundary
    : null;

  if (!authority) {
    failures.push('execution_authorization_intent_source_authority_missing');
  } else {
    if (authority.review_only !== true) {
      failures.push('execution_authorization_intent_source_review_only_required');
    }
    if (authority.explicit_separate_authorization_required !== true) {
      failures.push('execution_authorization_intent_source_separate_authorization_required');
    }
    if (authority.authorization_granted !== false) {
      failures.push('execution_authorization_intent_source_authorization_granted_must_be_false');
    }
    if (authority.execution_reservation_created !== false) {
      failures.push('execution_authorization_intent_source_reservation_created_must_be_false');
    }
    if (authority.approver_confirmation !== false) {
      failures.push('execution_authorization_intent_source_approver_confirmation_must_be_false');
    }
    for (const field of SAFE_FALSE_AUTHORITY_FIELDS) {
      if (authority[field] !== false) {
        failures.push('execution_authorization_intent_source_authority_' + field + '_must_be_false');
      }
    }
    if (authority.production_effect !== 'ZERO') {
      failures.push('execution_authorization_intent_source_authority_production_effect_must_be_zero');
    }
  }

  return uniqueSorted(failures);
}

function authorityBoundary(ok) {
  return {
    authorization_review_seen: true,
    authorization_review_validated: ok === true,
    authorization_intent_prepared: ok === true,
    intent_only: true,
    explicit_separate_grant_required: true,
    dual_control_required: true,
    authorization_granted: false,
    execution_reservation_created: false,
    authorization_token_materialized: false,
    replay_key_consumed: false,
    approver_confirmation: false,
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

function buildResult(reviewResult, intent, failures) {
  const ok = failures.length === 0;
  const validationFailure = failures.some(
    (reason) =>
      reason.endsWith('_missing') ||
      reason.endsWith('_invalid') ||
      reason.includes('mismatch') ||
      reason.startsWith('execution_authorization_intent_source_validation::')
  );
  const status = ok
    ? SUCCESS.status
    : validationFailure
      ? 'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_VALIDATION_FAILED'
      : 'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_BLOCKED';
  const decision = ok ? SUCCESS.decision : BLOCKED.decision;
  const nextState = ok ? SUCCESS.next_state : BLOCKED.next_state;
  const reasonCodes = ok ? [SUCCESS_REASON] : uniqueSorted(failures.concat(['fail_closed']));
  const sourceBinding = safeReviewBinding(reviewResult);
  const normalizedIntent = normalizeIntent(intent) || {
    environment: null,
    authorization_scope: null,
    approval_mode: null,
    operator_id: null,
    approver_id: null,
    requested_execution_count: null,
    ttl_seconds: null,
    replay_key: null,
    request_reference: null
  };
  const authority = authorityBoundary(ok);

  const authorizationIntent = {
    intent_type: 'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_SIMULATION',
    authorization_review_request_id: sourceBinding.authorization_review_request_id,
    authorization_review_request_fingerprint:
      sourceBinding.authorization_review_request_fingerprint,
    authorization_review_validator_version:
      sourceBinding.authorization_review_validator_version,
    fake_dry_run_evidence_id: sourceBinding.fake_dry_run_evidence_id,
    dry_run_request_id: sourceBinding.dry_run_request_id,
    preflight_request_id: sourceBinding.preflight_request_id,
    entry_reference_id: sourceBinding.entry_reference_id,
    entry_id: sourceBinding.entry_id,
    readiness_id: sourceBinding.readiness_id,
    trial_id: sourceBinding.trial_id,
    plan_hash: sourceBinding.plan_hash,
    preparation_eligibility_id: sourceBinding.preparation_eligibility_id,
    tenant_id: sourceBinding.tenant_id,
    environment: normalizedIntent.environment,
    authorization_scope: normalizedIntent.authorization_scope,
    approval_mode: normalizedIntent.approval_mode,
    operator_id: normalizedIntent.operator_id,
    approver_id: normalizedIntent.approver_id,
    requested_execution_count: normalizedIntent.requested_execution_count,
    ttl_seconds: normalizedIntent.ttl_seconds,
    replay_key: normalizedIntent.replay_key,
    request_reference: normalizedIntent.request_reference,
    intent_prepared: ok,
    explicit_separate_grant_required: true,
    authorization_granted: false,
    execution_reservation_created: false,
    authorization_token_materialized: false,
    replay_key_consumed: false,
    can_trigger_real_execution: false,
    real_execution_authorized: false,
    simulated: true,
    executed: false,
    production_effect: 'ZERO'
  };

  const material = {
    validator_version: PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_VALIDATOR_VERSION,
    status,
    decision,
    next_state: nextState,
    reason_codes: reasonCodes,
    source_binding: sourceBinding,
    authorization_intent: authorizationIntent,
    authority_boundary: authority,
    simulated: true,
    executed: false,
    production_effect: 'ZERO'
  };

  const evidence = {
    authorization_review_validated: ok,
    authorization_review_identity_bound:
      ok &&
      isNonEmptyString(sourceBinding.authorization_review_request_id) &&
      isNonEmptyString(sourceBinding.authorization_review_request_fingerprint),
    authorization_intent_prepared: ok,
    non_production_environment:
      ok && ['development', 'staging'].includes(normalizedIntent.environment),
    single_execution_scope:
      ok && normalizedIntent.requested_execution_count === 1,
    dual_control_bound:
      ok &&
      isNonEmptyString(normalizedIntent.operator_id) &&
      isNonEmptyString(normalizedIntent.approver_id) &&
      normalizedIntent.operator_id !== normalizedIntent.approver_id,
    ttl_bounded:
      ok &&
      Number.isInteger(normalizedIntent.ttl_seconds) &&
      normalizedIntent.ttl_seconds >= 1 &&
      normalizedIntent.ttl_seconds <= 900,
    replay_key_bound: ok && isNonEmptyString(normalizedIntent.replay_key),
    explicit_separate_grant_required: true,
    authorization_granted: false,
    execution_reservation_created: false,
    authorization_token_materialized: false,
    replay_key_consumed: false,
    can_trigger_real_execution: false,
    real_execution_authorized: false,
    provider_called: false,
    external_network_used: false,
    secret_resolved: false,
    simulated: true,
    executed: false,
    production_effect: 'ZERO'
  };

  const audit = {
    event_name: ok
      ? 'public_web_canary_execution_authorization_intent_prepared_simulation'
      : 'public_web_canary_execution_authorization_intent_blocked',
    decision,
    next_state: nextState,
    reason_codes: reasonCodes,
    intent_only: true,
    environment: normalizedIntent.environment,
    requested_execution_count: normalizedIntent.requested_execution_count,
    ttl_seconds: normalizedIntent.ttl_seconds,
    dual_control_required: true,
    explicit_separate_grant_required: true,
    authorization_granted: false,
    execution_reservation_created: false,
    can_trigger_real_execution: false,
    provider_called: false,
    external_network_used: false,
    secret_resolved: false,
    production_effect: 'ZERO'
  };

  const authorizationIntentId =
    'public_web_canary_execution_authorization_intent:' +
    digest({ material, evidence });

  return cloneFrozen({
    ok,
    status,
    decision,
    next_state: nextState,
    reason_codes: reasonCodes,
    authorization_intent_id: authorizationIntentId,
    authorization_intent_fingerprint: digest({ material, evidence, audit }),
    authorization_intent: authorizationIntent,
    source_binding: sourceBinding,
    authority_boundary: authority,
    evidence,
    audit,
    validator_version:
      PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_VALIDATOR_VERSION
  });
}

function evaluatePublicWebCanaryExecutionAuthorizationIntentBoundary(
  reviewResult,
  fakeDryRunResult,
  dryRunResult,
  consumerResult,
  referenceResult,
  entryResult,
  intent
) {
  const failures = collectSourceFailures(
    reviewResult,
    fakeDryRunResult,
    dryRunResult,
    consumerResult,
    referenceResult,
    entryResult
  ).concat(collectIntentFailures(intent));

  return buildResult(reviewResult, intent, uniqueSorted(failures));
}

function validatePublicWebCanaryExecutionAuthorizationIntentBoundaryResult(
  result,
  reviewResult,
  fakeDryRunResult,
  dryRunResult,
  consumerResult,
  referenceResult,
  entryResult,
  intent
) {
  const errors = [];

  if (!isPlainObject(result)) {
    return {
      valid: false,
      errors: ['execution_authorization_intent_result_must_be_object']
    };
  }

  if (!PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_STATUSES.includes(result.status)) {
    errors.push('status_invalid');
  }
  if (!PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_DECISIONS.includes(result.decision)) {
    errors.push('decision_invalid');
  }
  if (!PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_NEXT_STATES.includes(result.next_state)) {
    errors.push('next_state_invalid');
  }
  if (!isNonEmptyString(result.authorization_intent_id)) {
    errors.push('authorization_intent_id_invalid');
  }
  if (!isNonEmptyString(result.authorization_intent_fingerprint)) {
    errors.push('authorization_intent_fingerprint_invalid');
  }
  if (
    result.validator_version !==
    PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_VALIDATOR_VERSION
  ) {
    errors.push('validator_version_invalid');
  }

  const expected = evaluatePublicWebCanaryExecutionAuthorizationIntentBoundary(
    reviewResult,
    fakeDryRunResult,
    dryRunResult,
    consumerResult,
    referenceResult,
    entryResult,
    intent
  );

  if (!valuesEqual(result, expected)) {
    errors.push('execution_authorization_intent_context_mismatch');
  }

  if (isPlainObject(result.authority_boundary)) {
    if (result.authority_boundary.intent_only !== true) {
      errors.push('authority_intent_only_required');
    }
    if (result.authority_boundary.explicit_separate_grant_required !== true) {
      errors.push('authority_explicit_separate_grant_required');
    }
    if (result.authority_boundary.dual_control_required !== true) {
      errors.push('authority_dual_control_required');
    }
    for (const field of [
      'authorization_granted',
      'execution_reservation_created',
      'authorization_token_materialized',
      'replay_key_consumed',
      'approver_confirmation'
    ]) {
      if (result.authority_boundary[field] !== false) {
        errors.push('authority_' + field + '_must_be_false');
      }
    }
    for (const field of SAFE_FALSE_AUTHORITY_FIELDS) {
      if (result.authority_boundary[field] !== false) {
        errors.push('authority_' + field + '_must_be_false');
      }
    }
    if (result.authority_boundary.production_effect !== 'ZERO') {
      errors.push('authority_production_effect_must_be_zero');
    }
  } else {
    errors.push('authority_boundary_must_be_object');
  }

  if (isPlainObject(result.authorization_intent)) {
    if (
      result.authorization_intent.intent_type !==
      'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_SIMULATION'
    ) {
      errors.push('authorization_intent_type_invalid');
    }
    if (result.authorization_intent.explicit_separate_grant_required !== true) {
      errors.push('authorization_intent_separate_grant_required');
    }
    for (const field of [
      'authorization_granted',
      'execution_reservation_created',
      'authorization_token_materialized',
      'replay_key_consumed',
      'can_trigger_real_execution',
      'real_execution_authorized',
      'executed'
    ]) {
      if (result.authorization_intent[field] !== false) {
        errors.push('authorization_intent_' + field + '_must_be_false');
      }
    }
    if (result.authorization_intent.simulated !== true) {
      errors.push('authorization_intent_simulated_required');
    }
    if (result.authorization_intent.production_effect !== 'ZERO') {
      errors.push('authorization_intent_production_effect_must_be_zero');
    }
  } else {
    errors.push('authorization_intent_must_be_object');
  }

  if (isPlainObject(result.evidence)) {
    if (result.evidence.explicit_separate_grant_required !== true) {
      errors.push('evidence_explicit_separate_grant_required');
    }
    for (const field of [
      'authorization_granted',
      'execution_reservation_created',
      'authorization_token_materialized',
      'replay_key_consumed',
      'can_trigger_real_execution',
      'real_execution_authorized',
      'provider_called',
      'external_network_used',
      'secret_resolved',
      'executed'
    ]) {
      if (result.evidence[field] !== false) {
        errors.push('evidence_' + field + '_must_be_false');
      }
    }
    if (result.evidence.simulated !== true) {
      errors.push('evidence_simulated_required');
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
  PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_DECISIONS,
  PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_NEXT_STATES,
  PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_STATUSES,
  PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_VALIDATOR_VERSION,
  evaluatePublicWebCanaryExecutionAuthorizationIntentBoundary,
  validatePublicWebCanaryExecutionAuthorizationIntentBoundaryResult
};
