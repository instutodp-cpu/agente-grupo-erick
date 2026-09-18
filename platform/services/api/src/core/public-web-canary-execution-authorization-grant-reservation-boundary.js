'use strict';

const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const {
  isNonEmptyString,
  isPlainObject,
  uniqueSorted
} = require('./read-only-adapter-contract');
const {
  PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_VALIDATOR_VERSION,
  validatePublicWebCanaryExecutionAuthorizationIntentBoundaryResult
} = require('./public-web-canary-execution-authorization-intent-boundary');

const PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANT_RESERVATION_VALIDATOR_VERSION =
  'public_web_canary_execution_authorization_grant_reservation_boundary_v1';

const PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANT_RESERVATION_STATUSES =
  Object.freeze([
    'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANTED_RESERVED',
    'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANT_RESERVATION_BLOCKED',
    'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANT_RESERVATION_VALIDATION_FAILED'
  ]);

const PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANT_RESERVATION_DECISIONS =
  Object.freeze([
    'GRANT_PUBLIC_WEB_CANARY_SINGLE_EXECUTION_RESERVATION',
    'BLOCKED'
  ]);

const PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANT_RESERVATION_NEXT_STATES =
  Object.freeze([
    'WAITING_PUBLIC_WEB_CANARY_REAL_NON_PRODUCTION_EXECUTION_BRIDGE',
    'BLOCKED_REFERENCE'
  ]);

const SUCCESS = Object.freeze({
  status: 'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANTED_RESERVED',
  decision: 'GRANT_PUBLIC_WEB_CANARY_SINGLE_EXECUTION_RESERVATION',
  next_state: 'WAITING_PUBLIC_WEB_CANARY_REAL_NON_PRODUCTION_EXECUTION_BRIDGE'
});

const BLOCKED = Object.freeze({
  decision: 'BLOCKED',
  next_state: 'BLOCKED_REFERENCE'
});

const SOURCE_SUCCESS_REASON =
  'public_web_canary_execution_authorization_intent_prepared_for_explicit_future_grant_non_side_effect_only';

const SUCCESS_REASON =
  'public_web_canary_single_execution_non_production_authorization_granted_and_reserved_without_execution';

const FORBIDDEN_GRANT_INPUT_FIELDS = Object.freeze([
  'ready',
  'authorized',
  'canary_authorized',
  'execution_authorized',
  'real_execution_authorized',
  'can_trigger_real_execution',
  'authorization_token',
  'authorization_token_materialized',
  'execution_started',
  'executed',
  'provider_called',
  'external_network_used',
  'secret_resolved',
  'runtime_execution',
  'worker_execution',
  'queue_mutation',
  'scheduler_mutation',
  'dispatch_execution',
  'operational_persistence'
]);

const SAFE_FALSE_EXECUTION_FIELDS = Object.freeze([
  'preflight_execution',
  'dry_run_execution',
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
  'execution_bridge_authorized',
  'can_trigger_real_execution',
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

function canonicalIsoTimestamp(value) {
  if (!isNonEmptyString(value)) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const canonical = new Date(milliseconds).toISOString();
  return canonical === value ? canonical : null;
}

function validStringArray(value) {
  return (
    Array.isArray(value) &&
    value.every((item) => isNonEmptyString(item)) &&
    new Set(value).size === value.length
  );
}

function normalizeStringArray(value) {
  if (!validStringArray(value)) return null;
  return uniqueSorted(value);
}

function sourceBinding(intentResult) {
  const safe = isPlainObject(intentResult) ? intentResult : {};
  const intent = isPlainObject(safe.authorization_intent)
    ? safe.authorization_intent
    : {};

  return {
    authorization_intent_id: isNonEmptyString(safe.authorization_intent_id)
      ? safe.authorization_intent_id
      : null,
    authorization_intent_fingerprint: isNonEmptyString(
      safe.authorization_intent_fingerprint
    )
      ? safe.authorization_intent_fingerprint
      : null,
    authorization_intent_validator_version: isNonEmptyString(safe.validator_version)
      ? safe.validator_version
      : null,
    authorization_review_request_id: isNonEmptyString(
      intent.authorization_review_request_id
    )
      ? intent.authorization_review_request_id
      : null,
    fake_dry_run_evidence_id: isNonEmptyString(intent.fake_dry_run_evidence_id)
      ? intent.fake_dry_run_evidence_id
      : null,
    dry_run_request_id: isNonEmptyString(intent.dry_run_request_id)
      ? intent.dry_run_request_id
      : null,
    preflight_request_id: isNonEmptyString(intent.preflight_request_id)
      ? intent.preflight_request_id
      : null,
    entry_reference_id: isNonEmptyString(intent.entry_reference_id)
      ? intent.entry_reference_id
      : null,
    entry_id: isNonEmptyString(intent.entry_id) ? intent.entry_id : null,
    readiness_id: isNonEmptyString(intent.readiness_id)
      ? intent.readiness_id
      : null,
    trial_id: isNonEmptyString(intent.trial_id) ? intent.trial_id : null,
    plan_hash: isNonEmptyString(intent.plan_hash) ? intent.plan_hash : null,
    preparation_eligibility_id: isNonEmptyString(intent.preparation_eligibility_id)
      ? intent.preparation_eligibility_id
      : null,
    tenant_id: isNonEmptyString(intent.tenant_id) ? intent.tenant_id : null,
    environment: isNonEmptyString(intent.environment) ? intent.environment : null,
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

function normalizeGrantInput(grantInput) {
  if (!isPlainObject(grantInput)) return null;
  const replayGuard = isPlainObject(grantInput.replay_guard)
    ? grantInput.replay_guard
    : {};

  return {
    grant_mode: isNonEmptyString(grantInput.grant_mode)
      ? grantInput.grant_mode
      : null,
    operator_confirmation: grantInput.operator_confirmation === true,
    approver_confirmation: grantInput.approver_confirmation === true,
    operator_id: isNonEmptyString(grantInput.operator_id)
      ? grantInput.operator_id
      : null,
    approver_id: isNonEmptyString(grantInput.approver_id)
      ? grantInput.approver_id
      : null,
    issued_at: canonicalIsoTimestamp(grantInput.issued_at),
    expires_at: canonicalIsoTimestamp(grantInput.expires_at),
    ttl_seconds: Number.isInteger(grantInput.ttl_seconds)
      ? grantInput.ttl_seconds
      : null,
    replay_key: isNonEmptyString(grantInput.replay_key)
      ? grantInput.replay_key
      : null,
    grant_nonce: isNonEmptyString(grantInput.grant_nonce)
      ? grantInput.grant_nonce
      : null,
    reservation_nonce: isNonEmptyString(grantInput.reservation_nonce)
      ? grantInput.reservation_nonce
      : null,
    grant_reference: isNonEmptyString(grantInput.grant_reference)
      ? grantInput.grant_reference
      : null,
    replay_guard: {
      known_replay_keys: normalizeStringArray(replayGuard.known_replay_keys),
      known_grant_nonces: normalizeStringArray(replayGuard.known_grant_nonces),
      known_reservation_nonces: normalizeStringArray(
        replayGuard.known_reservation_nonces
      )
    }
  };
}

function collectSourceFailures(
  intentResult,
  reviewResult,
  fakeDryRunResult,
  dryRunResult,
  consumerResult,
  referenceResult,
  entryResult,
  intentInput
) {
  const failures = [];

  if (!isPlainObject(intentResult)) {
    return ['execution_authorization_grant_source_missing'];
  }

  if (intentResult.ok !== true) {
    failures.push('execution_authorization_grant_source_not_ok');
  }
  if (
    intentResult.status !==
    'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_PREPARED_SIMULATION'
  ) {
    failures.push('execution_authorization_grant_source_status_not_prepared');
  }
  if (
    intentResult.decision !==
    'PREPARE_PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT'
  ) {
    failures.push('execution_authorization_grant_source_decision_mismatch');
  }
  if (
    intentResult.next_state !==
    'WAITING_PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANT_BOUNDARY'
  ) {
    failures.push('execution_authorization_grant_source_next_state_mismatch');
  }
  if (
    intentResult.validator_version !==
    PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_VALIDATOR_VERSION
  ) {
    failures.push('execution_authorization_grant_source_validator_version_mismatch');
  }
  if (!valuesEqual(intentResult.reason_codes, [SOURCE_SUCCESS_REASON])) {
    failures.push('execution_authorization_grant_source_reason_codes_mismatch');
  }

  if (
    isPlainObject(reviewResult) &&
    isPlainObject(fakeDryRunResult) &&
    isPlainObject(dryRunResult) &&
    isPlainObject(consumerResult) &&
    isPlainObject(referenceResult) &&
    isPlainObject(entryResult) &&
    isPlainObject(intentInput)
  ) {
    const validation =
      validatePublicWebCanaryExecutionAuthorizationIntentBoundaryResult(
        intentResult,
        reviewResult,
        fakeDryRunResult,
        dryRunResult,
        consumerResult,
        referenceResult,
        entryResult,
        intentInput
      );
    if (!validation.valid) {
      for (const error of validation.errors) {
        failures.push('execution_authorization_grant_source_validation::' + error);
      }
    }
  } else {
    if (!isPlainObject(reviewResult)) failures.push('authorization_review_result_missing');
    if (!isPlainObject(fakeDryRunResult)) failures.push('fake_dry_run_result_missing');
    if (!isPlainObject(dryRunResult)) failures.push('dry_run_result_missing');
    if (!isPlainObject(consumerResult)) failures.push('preflight_request_consumer_result_missing');
    if (!isPlainObject(referenceResult)) failures.push('preflight_entry_reference_result_missing');
    if (!isPlainObject(entryResult)) failures.push('preflight_entry_result_missing');
    if (!isPlainObject(intentInput)) failures.push('authorization_intent_input_missing');
  }

  if (!isNonEmptyString(intentResult.authorization_intent_id)) {
    failures.push('authorization_intent_id_invalid');
  }
  if (!isNonEmptyString(intentResult.authorization_intent_fingerprint)) {
    failures.push('authorization_intent_fingerprint_invalid');
  }

  const intent = isPlainObject(intentResult.authorization_intent)
    ? intentResult.authorization_intent
    : null;

  if (!intent) {
    failures.push('authorization_intent_missing');
  } else {
    if (
      intent.intent_type !==
      'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_INTENT_SIMULATION'
    ) {
      failures.push('authorization_intent_type_mismatch');
    }
    if (!['development', 'staging'].includes(intent.environment)) {
      failures.push('authorization_intent_environment_not_non_production');
    }
    if (
      intent.authorization_scope !==
      'PUBLIC_WEB_CANARY_SINGLE_EXECUTION_NON_PRODUCTION'
    ) {
      failures.push('authorization_intent_scope_mismatch');
    }
    if (intent.approval_mode !== 'DUAL_CONTROL_REQUIRED') {
      failures.push('authorization_intent_approval_mode_mismatch');
    }
    if (!isNonEmptyString(intent.operator_id)) {
      failures.push('authorization_intent_operator_id_invalid');
    }
    if (!isNonEmptyString(intent.approver_id)) {
      failures.push('authorization_intent_approver_id_invalid');
    }
    if (intent.operator_id === intent.approver_id) {
      failures.push('authorization_intent_dual_control_required');
    }
    if (intent.requested_execution_count !== 1) {
      failures.push('authorization_intent_execution_count_must_be_one');
    }
    if (
      !Number.isInteger(intent.ttl_seconds) ||
      intent.ttl_seconds < 1 ||
      intent.ttl_seconds > 900
    ) {
      failures.push('authorization_intent_ttl_out_of_range');
    }
    if (!isNonEmptyString(intent.replay_key)) {
      failures.push('authorization_intent_replay_key_invalid');
    }
    if (intent.intent_prepared !== true) {
      failures.push('authorization_intent_prepared_required');
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
      if (intent[field] !== false) {
        failures.push('authorization_intent_' + field + '_must_be_false');
      }
    }
    if (intent.simulated !== true) {
      failures.push('authorization_intent_simulated_required');
    }
    if (intent.production_effect !== 'ZERO') {
      failures.push('authorization_intent_production_effect_must_be_zero');
    }
  }

  const authority = isPlainObject(intentResult.authority_boundary)
    ? intentResult.authority_boundary
    : null;
  if (!authority) {
    failures.push('authorization_intent_authority_boundary_missing');
  } else {
    if (authority.intent_only !== true) {
      failures.push('authorization_intent_authority_intent_only_required');
    }
    if (authority.explicit_separate_grant_required !== true) {
      failures.push('authorization_intent_authority_separate_grant_required');
    }
    if (authority.authorization_granted !== false) {
      failures.push('authorization_intent_authority_granted_must_be_false');
    }
    if (authority.execution_reservation_created !== false) {
      failures.push('authorization_intent_authority_reservation_must_be_false');
    }
    if (authority.real_execution_authorized !== false) {
      failures.push('authorization_intent_authority_real_execution_must_be_false');
    }
    if (authority.production_effect !== 'ZERO') {
      failures.push('authorization_intent_authority_production_effect_must_be_zero');
    }
  }

  return uniqueSorted(failures);
}

function collectGrantFailures(intentResult, grantInput) {
  const failures = [];

  if (!isPlainObject(grantInput)) {
    return ['execution_authorization_grant_input_missing'];
  }

  for (const field of FORBIDDEN_GRANT_INPUT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(grantInput, field)) {
      failures.push('execution_authorization_grant_input_forbidden_field::' + field);
    }
  }

  const normalized = normalizeGrantInput(grantInput);
  if (!normalized) {
    return uniqueSorted(
      failures.concat(['execution_authorization_grant_input_invalid'])
    );
  }

  const intent = isPlainObject(intentResult.authorization_intent)
    ? intentResult.authorization_intent
    : {};

  if (normalized.grant_mode !== 'DUAL_CONTROL_SINGLE_USE') {
    failures.push('execution_authorization_grant_mode_mismatch');
  }
  if (normalized.operator_confirmation !== true) {
    failures.push('execution_authorization_operator_confirmation_required');
  }
  if (normalized.approver_confirmation !== true) {
    failures.push('execution_authorization_approver_confirmation_required');
  }
  if (normalized.operator_id !== intent.operator_id) {
    failures.push('execution_authorization_operator_id_mismatch');
  }
  if (normalized.approver_id !== intent.approver_id) {
    failures.push('execution_authorization_approver_id_mismatch');
  }
  if (
    !isNonEmptyString(normalized.operator_id) ||
    !isNonEmptyString(normalized.approver_id) ||
    normalized.operator_id === normalized.approver_id
  ) {
    failures.push('execution_authorization_dual_control_required');
  }
  if (!normalized.issued_at) {
    failures.push('execution_authorization_issued_at_invalid');
  }
  if (!normalized.expires_at) {
    failures.push('execution_authorization_expires_at_invalid');
  }
  if (normalized.ttl_seconds !== intent.ttl_seconds) {
    failures.push('execution_authorization_ttl_mismatch');
  }
  if (
    !Number.isInteger(normalized.ttl_seconds) ||
    normalized.ttl_seconds < 1 ||
    normalized.ttl_seconds > 900
  ) {
    failures.push('execution_authorization_ttl_out_of_range');
  }

  if (normalized.issued_at && normalized.expires_at) {
    const issued = Date.parse(normalized.issued_at);
    const expires = Date.parse(normalized.expires_at);
    if (expires <= issued) {
      failures.push('execution_authorization_expiry_not_after_issue');
    }
    if (
      Number.isInteger(normalized.ttl_seconds) &&
      expires - issued !== normalized.ttl_seconds * 1000
    ) {
      failures.push('execution_authorization_expiry_ttl_mismatch');
    }
  }

  if (normalized.replay_key !== intent.replay_key) {
    failures.push('execution_authorization_replay_key_mismatch');
  }
  if (!isNonEmptyString(normalized.grant_nonce)) {
    failures.push('execution_authorization_grant_nonce_invalid');
  }
  if (!isNonEmptyString(normalized.reservation_nonce)) {
    failures.push('execution_authorization_reservation_nonce_invalid');
  }
  if (
    isNonEmptyString(normalized.grant_nonce) &&
    isNonEmptyString(normalized.reservation_nonce) &&
    normalized.grant_nonce === normalized.reservation_nonce
  ) {
    failures.push('execution_authorization_nonces_must_be_distinct');
  }
  if (!isNonEmptyString(normalized.grant_reference)) {
    failures.push('execution_authorization_grant_reference_invalid');
  }

  const guard = normalized.replay_guard;
  if (!guard.known_replay_keys) {
    failures.push('execution_authorization_known_replay_keys_invalid');
  }
  if (!guard.known_grant_nonces) {
    failures.push('execution_authorization_known_grant_nonces_invalid');
  }
  if (!guard.known_reservation_nonces) {
    failures.push('execution_authorization_known_reservation_nonces_invalid');
  }

  if (
    guard.known_replay_keys &&
    isNonEmptyString(normalized.replay_key) &&
    guard.known_replay_keys.includes(normalized.replay_key)
  ) {
    failures.push('execution_authorization_replay_key_already_seen');
  }
  if (
    guard.known_grant_nonces &&
    isNonEmptyString(normalized.grant_nonce) &&
    guard.known_grant_nonces.includes(normalized.grant_nonce)
  ) {
    failures.push('execution_authorization_grant_nonce_already_seen');
  }
  if (
    guard.known_reservation_nonces &&
    isNonEmptyString(normalized.reservation_nonce) &&
    guard.known_reservation_nonces.includes(normalized.reservation_nonce)
  ) {
    failures.push('execution_authorization_reservation_nonce_already_seen');
  }

  return uniqueSorted(failures);
}

function authorityBoundary(ok) {
  return {
    authorization_intent_seen: true,
    authorization_intent_validated: ok === true,
    dual_control_required: true,
    operator_confirmation: ok === true,
    approver_confirmation: ok === true,
    authorization_granted: ok === true,
    execution_reservation_created: ok === true,
    reservation_single_use: ok === true,
    replay_key_reserved: ok === true,
    authorization_token_materialized: false,
    replay_key_consumed: false,
    execution_bridge_authorized: false,
    can_trigger_real_execution: false,
    preflight_execution: false,
    dry_run_execution: false,
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

function buildResult(intentResult, grantInput, failures) {
  const ok = failures.length === 0;
  const validationFailure = failures.some(
    (reason) =>
      reason.endsWith('_missing') ||
      reason.endsWith('_invalid') ||
      reason.includes('mismatch') ||
      reason.startsWith('execution_authorization_grant_source_validation::')
  );
  const status = ok
    ? SUCCESS.status
    : validationFailure
      ? 'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANT_RESERVATION_VALIDATION_FAILED'
      : 'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANT_RESERVATION_BLOCKED';
  const decision = ok ? SUCCESS.decision : BLOCKED.decision;
  const nextState = ok ? SUCCESS.next_state : BLOCKED.next_state;
  const reasonCodes = ok
    ? [SUCCESS_REASON]
    : uniqueSorted(failures.concat(['fail_closed']));

  const binding = sourceBinding(intentResult);
  const normalized = normalizeGrantInput(grantInput) || {
    grant_mode: null,
    operator_confirmation: false,
    approver_confirmation: false,
    operator_id: null,
    approver_id: null,
    issued_at: null,
    expires_at: null,
    ttl_seconds: null,
    replay_key: null,
    grant_nonce: null,
    reservation_nonce: null,
    grant_reference: null,
    replay_guard: {
      known_replay_keys: null,
      known_grant_nonces: null,
      known_reservation_nonces: null
    }
  };

  const replaySnapshot = {
    known_replay_keys: normalized.replay_guard.known_replay_keys || [],
    known_grant_nonces: normalized.replay_guard.known_grant_nonces || [],
    known_reservation_nonces:
      normalized.replay_guard.known_reservation_nonces || []
  };
  const replaySnapshotDigest = digest(replaySnapshot);

  const identityMaterial = {
    validator_version:
      PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANT_RESERVATION_VALIDATOR_VERSION,
    source_binding: binding,
    grant_mode: normalized.grant_mode,
    operator_id: normalized.operator_id,
    approver_id: normalized.approver_id,
    issued_at: normalized.issued_at,
    expires_at: normalized.expires_at,
    ttl_seconds: normalized.ttl_seconds,
    replay_key: normalized.replay_key,
    grant_nonce: normalized.grant_nonce,
    reservation_nonce: normalized.reservation_nonce,
    grant_reference: normalized.grant_reference,
    replay_snapshot_digest: replaySnapshotDigest
  };

  const authorizationGrantId = ok
    ? 'public_web_canary_execution_authorization_grant:' +
      digest({ kind: 'grant', identity: identityMaterial })
    : null;
  const executionReservationId = ok
    ? 'public_web_canary_execution_reservation:' +
      digest({
        kind: 'reservation',
        authorization_grant_id: authorizationGrantId,
        identity: identityMaterial
      })
    : null;

  const authorizationGrant = {
    grant_type: 'PUBLIC_WEB_CANARY_SINGLE_EXECUTION_NON_PRODUCTION_GRANT',
    grant_state: ok ? 'GRANTED' : 'NOT_GRANTED',
    authorization_grant_id: authorizationGrantId,
    authorization_intent_id: binding.authorization_intent_id,
    authorization_intent_fingerprint: binding.authorization_intent_fingerprint,
    authorization_intent_validator_version:
      binding.authorization_intent_validator_version,
    environment: binding.environment,
    authorization_scope: binding.authorization_scope,
    approval_mode: binding.approval_mode,
    operator_id: normalized.operator_id,
    approver_id: normalized.approver_id,
    operator_confirmation: ok,
    approver_confirmation: ok,
    issued_at: normalized.issued_at,
    expires_at: normalized.expires_at,
    ttl_seconds: normalized.ttl_seconds,
    execution_count_limit: ok ? 1 : 0,
    replay_key: normalized.replay_key,
    replay_snapshot_digest: replaySnapshotDigest,
    grant_nonce: normalized.grant_nonce,
    grant_reference: normalized.grant_reference,
    authorization_granted: ok,
    execution_reservation_created: ok,
    execution_reservation_id: executionReservationId,
    authorization_token_materialized: false,
    bridge_activation_required: true,
    execution_bridge_authorized: false,
    can_trigger_real_execution: false,
    real_execution_authorized: false,
    executed: false,
    provider_called: false,
    external_network_used: false,
    secret_resolved: false,
    production_effect: 'ZERO'
  };

  const executionReservation = {
    reservation_type:
      'PUBLIC_WEB_CANARY_SINGLE_EXECUTION_NON_PRODUCTION_RESERVATION',
    reservation_state: ok ? 'RESERVED_UNCONSUMED' : 'NOT_RESERVED',
    execution_reservation_id: executionReservationId,
    authorization_grant_id: authorizationGrantId,
    authorization_intent_id: binding.authorization_intent_id,
    environment: binding.environment,
    authorization_scope: binding.authorization_scope,
    tenant_id: binding.tenant_id,
    trial_id: binding.trial_id,
    plan_hash: binding.plan_hash,
    request_reference: binding.request_reference,
    reservation_nonce: normalized.reservation_nonce,
    replay_key: normalized.replay_key,
    replay_snapshot_digest: replaySnapshotDigest,
    execution_reservation_created: ok,
    single_use: ok,
    reserved_execution_count: ok ? 1 : 0,
    remaining_execution_count: ok ? 1 : 0,
    reservation_consumed: false,
    replay_key_reserved: ok,
    replay_key_consumed: false,
    bridge_activation_required: true,
    execution_bridge_authorized: false,
    can_trigger_real_execution: false,
    real_execution_authorized: false,
    executed: false,
    provider_called: false,
    external_network_used: false,
    secret_resolved: false,
    operational_persistence: false,
    production_effect: 'ZERO'
  };

  const authority = authorityBoundary(ok);

  const evidence = {
    authorization_intent_validated: ok,
    non_production_environment:
      ok && ['development', 'staging'].includes(binding.environment),
    single_execution_scope:
      ok &&
      binding.authorization_scope ===
        'PUBLIC_WEB_CANARY_SINGLE_EXECUTION_NON_PRODUCTION',
    dual_control_confirmed:
      ok &&
      normalized.operator_confirmation === true &&
      normalized.approver_confirmation === true &&
      normalized.operator_id !== normalized.approver_id,
    bounded_expiry:
      ok &&
      Number.isInteger(normalized.ttl_seconds) &&
      normalized.ttl_seconds >= 1 &&
      normalized.ttl_seconds <= 900,
    replay_snapshot_checked: ok,
    replay_key_reserved: ok,
    replay_key_consumed: false,
    authorization_granted: ok,
    execution_reservation_created: ok,
    reservation_single_use: ok,
    authorization_token_materialized: false,
    execution_bridge_authorized: false,
    can_trigger_real_execution: false,
    real_execution_authorized: false,
    provider_called: false,
    external_network_used: false,
    secret_resolved: false,
    executed: false,
    production_effect: 'ZERO'
  };

  const audit = {
    event_name: ok
      ? 'public_web_canary_single_execution_authorization_granted_reserved'
      : 'public_web_canary_execution_authorization_grant_reservation_blocked',
    decision,
    next_state: nextState,
    reason_codes: reasonCodes,
    authorization_intent_id: binding.authorization_intent_id,
    authorization_grant_id: authorizationGrantId,
    execution_reservation_id: executionReservationId,
    environment: binding.environment,
    authorization_scope: binding.authorization_scope,
    operator_id: normalized.operator_id,
    approver_id: normalized.approver_id,
    issued_at: normalized.issued_at,
    expires_at: normalized.expires_at,
    ttl_seconds: normalized.ttl_seconds,
    grant_reference: normalized.grant_reference,
    single_use: ok,
    remaining_execution_count: ok ? 1 : 0,
    execution_bridge_authorized: false,
    can_trigger_real_execution: false,
    provider_called: false,
    external_network_used: false,
    secret_resolved: false,
    executed: false,
    production_effect: 'ZERO'
  };

  const material = {
    validator_version:
      PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANT_RESERVATION_VALIDATOR_VERSION,
    status,
    decision,
    next_state: nextState,
    reason_codes: reasonCodes,
    source_binding: binding,
    authorization_grant: authorizationGrant,
    execution_reservation: executionReservation,
    authority_boundary: authority,
    evidence,
    audit,
    production_effect: 'ZERO'
  };

  return cloneFrozen({
    ok,
    status,
    decision,
    next_state: nextState,
    reason_codes: reasonCodes,
    authorization_grant_id: authorizationGrantId,
    execution_reservation_id: executionReservationId,
    grant_reservation_fingerprint: digest(material),
    source_binding: binding,
    authorization_grant: authorizationGrant,
    execution_reservation: executionReservation,
    authority_boundary: authority,
    evidence,
    audit,
    validator_version:
      PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANT_RESERVATION_VALIDATOR_VERSION
  });
}

function evaluatePublicWebCanaryExecutionAuthorizationGrantReservationBoundary(
  intentResult,
  reviewResult,
  fakeDryRunResult,
  dryRunResult,
  consumerResult,
  referenceResult,
  entryResult,
  intentInput,
  grantInput
) {
  const failures = collectSourceFailures(
    intentResult,
    reviewResult,
    fakeDryRunResult,
    dryRunResult,
    consumerResult,
    referenceResult,
    entryResult,
    intentInput
  ).concat(collectGrantFailures(intentResult, grantInput));

  return buildResult(intentResult, grantInput, uniqueSorted(failures));
}

function validatePublicWebCanaryExecutionAuthorizationGrantReservationBoundaryResult(
  result,
  intentResult,
  reviewResult,
  fakeDryRunResult,
  dryRunResult,
  consumerResult,
  referenceResult,
  entryResult,
  intentInput,
  grantInput
) {
  const errors = [];

  if (!isPlainObject(result)) {
    return {
      valid: false,
      errors: ['execution_authorization_grant_reservation_result_must_be_object']
    };
  }

  if (
    !PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANT_RESERVATION_STATUSES.includes(
      result.status
    )
  ) {
    errors.push('status_invalid');
  }
  if (
    !PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANT_RESERVATION_DECISIONS.includes(
      result.decision
    )
  ) {
    errors.push('decision_invalid');
  }
  if (
    !PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANT_RESERVATION_NEXT_STATES.includes(
      result.next_state
    )
  ) {
    errors.push('next_state_invalid');
  }
  if (
    result.validator_version !==
    PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANT_RESERVATION_VALIDATOR_VERSION
  ) {
    errors.push('validator_version_invalid');
  }

  const expected =
    evaluatePublicWebCanaryExecutionAuthorizationGrantReservationBoundary(
      intentResult,
      reviewResult,
      fakeDryRunResult,
      dryRunResult,
      consumerResult,
      referenceResult,
      entryResult,
      intentInput,
      grantInput
    );

  if (!valuesEqual(result, expected)) {
    errors.push('execution_authorization_grant_reservation_context_mismatch');
  }

  if (!isNonEmptyString(result.grant_reservation_fingerprint)) {
    errors.push('grant_reservation_fingerprint_invalid');
  }

  if (result.ok === true) {
    if (!isNonEmptyString(result.authorization_grant_id)) {
      errors.push('authorization_grant_id_invalid');
    }
    if (!isNonEmptyString(result.execution_reservation_id)) {
      errors.push('execution_reservation_id_invalid');
    }
  } else {
    if (result.authorization_grant_id !== null) {
      errors.push('authorization_grant_id_must_be_null_when_blocked');
    }
    if (result.execution_reservation_id !== null) {
      errors.push('execution_reservation_id_must_be_null_when_blocked');
    }
  }

  if (isPlainObject(result.authority_boundary)) {
    if (result.authority_boundary.dual_control_required !== true) {
      errors.push('authority_dual_control_required');
    }
    if (
      result.authority_boundary.authorization_granted !==
      (result.ok === true)
    ) {
      errors.push('authority_authorization_granted_mismatch');
    }
    if (
      result.authority_boundary.execution_reservation_created !==
      (result.ok === true)
    ) {
      errors.push('authority_execution_reservation_created_mismatch');
    }
    if (
      result.authority_boundary.reservation_single_use !==
      (result.ok === true)
    ) {
      errors.push('authority_reservation_single_use_mismatch');
    }
    if (
      result.authority_boundary.authorization_token_materialized !== false
    ) {
      errors.push('authority_authorization_token_materialized_must_be_false');
    }
    if (result.authority_boundary.replay_key_consumed !== false) {
      errors.push('authority_replay_key_consumed_must_be_false');
    }
    for (const field of SAFE_FALSE_EXECUTION_FIELDS) {
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

  if (isPlainObject(result.authorization_grant)) {
    if (
      result.authorization_grant.grant_type !==
      'PUBLIC_WEB_CANARY_SINGLE_EXECUTION_NON_PRODUCTION_GRANT'
    ) {
      errors.push('authorization_grant_type_invalid');
    }
    if (
      result.authorization_grant.authorization_granted !==
      (result.ok === true)
    ) {
      errors.push('authorization_grant_granted_mismatch');
    }
    if (
      result.authorization_grant.execution_reservation_created !==
      (result.ok === true)
    ) {
      errors.push('authorization_grant_reservation_created_mismatch');
    }
    for (const field of [
      'authorization_token_materialized',
      'execution_bridge_authorized',
      'can_trigger_real_execution',
      'real_execution_authorized',
      'executed',
      'provider_called',
      'external_network_used',
      'secret_resolved'
    ]) {
      if (result.authorization_grant[field] !== false) {
        errors.push('authorization_grant_' + field + '_must_be_false');
      }
    }
    if (result.authorization_grant.production_effect !== 'ZERO') {
      errors.push('authorization_grant_production_effect_must_be_zero');
    }
  } else {
    errors.push('authorization_grant_must_be_object');
  }

  if (isPlainObject(result.execution_reservation)) {
    if (
      result.execution_reservation.reservation_type !==
      'PUBLIC_WEB_CANARY_SINGLE_EXECUTION_NON_PRODUCTION_RESERVATION'
    ) {
      errors.push('execution_reservation_type_invalid');
    }
    if (
      result.execution_reservation.execution_reservation_created !==
      (result.ok === true)
    ) {
      errors.push('execution_reservation_created_mismatch');
    }
    if (result.execution_reservation.reservation_consumed !== false) {
      errors.push('execution_reservation_consumed_must_be_false');
    }
    if (result.execution_reservation.replay_key_consumed !== false) {
      errors.push('execution_reservation_replay_key_consumed_must_be_false');
    }
    for (const field of [
      'execution_bridge_authorized',
      'can_trigger_real_execution',
      'real_execution_authorized',
      'executed',
      'provider_called',
      'external_network_used',
      'secret_resolved',
      'operational_persistence'
    ]) {
      if (result.execution_reservation[field] !== false) {
        errors.push('execution_reservation_' + field + '_must_be_false');
      }
    }
    if (result.execution_reservation.production_effect !== 'ZERO') {
      errors.push('execution_reservation_production_effect_must_be_zero');
    }
  } else {
    errors.push('execution_reservation_must_be_object');
  }

  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANT_RESERVATION_DECISIONS,
  PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANT_RESERVATION_NEXT_STATES,
  PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANT_RESERVATION_STATUSES,
  PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANT_RESERVATION_VALIDATOR_VERSION,
  evaluatePublicWebCanaryExecutionAuthorizationGrantReservationBoundary,
  validatePublicWebCanaryExecutionAuthorizationGrantReservationBoundaryResult
};
