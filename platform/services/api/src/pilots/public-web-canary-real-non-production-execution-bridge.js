'use strict';

const { stablePayload } = require('../core/agent-identity-contract');
const { computeCanonicalContentDigest } = require('../core/canonical-content-digest');
const {
  isNonEmptyString,
  isPlainObject,
  uniqueSorted
} = require('../core/read-only-adapter-contract');
const {
  PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANT_RESERVATION_VALIDATOR_VERSION,
  validatePublicWebCanaryExecutionAuthorizationGrantReservationBoundaryResult
} = require('../core/public-web-canary-execution-authorization-grant-reservation-boundary');
const {
  createPublicWebCanaryExecutionReservationLedger
} = require('../core/public-web-canary-execution-reservation-ledger');
const {
  createPublicWebCanaryRunner
} = require('./public-web-canary-runner');

const REQUIRED_CONFIRMATION = 'EXECUTAR CANARY PUBLIC WEB';

const PUBLIC_WEB_CANARY_REAL_NON_PRODUCTION_EXECUTION_BRIDGE_VERSION =
  'public_web_canary_real_non_production_execution_bridge_v1';

const ALLOWED_ENVIRONMENTS = Object.freeze(['development', 'staging']);

function digest(value) {
  return computeCanonicalContentDigest(value);
}

function canonicalIso(value) {
  if (!isNonEmptyString(value)) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const canonical = new Date(milliseconds).toISOString();
  return canonical === value ? canonical : null;
}

function equal(left, right) {
  try {
    return stablePayload(left) === stablePayload(right);
  } catch (_error) {
    return false;
  }
}

function fail(reasonCodes, fields = {}) {
  return Object.freeze({
    ok: false,
    status: 'PUBLIC_WEB_CANARY_REAL_NON_PRODUCTION_EXECUTION_BRIDGE_BLOCKED',
    decision: 'BLOCKED',
    reason_codes: uniqueSorted(
      Array.isArray(reasonCodes) ? reasonCodes : [reasonCodes]
    ),
    reservation_consumed: fields.reservation_consumed === true,
    replay_key_consumed: fields.replay_key_consumed === true,
    runner_invoked: fields.runner_invoked === true,
    executed: fields.executed === true,
    real_provider_called: fields.real_provider_called === true,
    production_effect: 'ZERO',
    validator_version:
      PUBLIC_WEB_CANARY_REAL_NON_PRODUCTION_EXECUTION_BRIDGE_VERSION
  });
}

function validateGrantChain(chain) {
  const failures = [];
  if (!isPlainObject(chain)) return ['grant_chain_missing'];

  const required = [
    'grantResult',
    'intentResult',
    'reviewResult',
    'fakeDryRunResult',
    'dryRunResult',
    'consumerResult',
    'referenceResult',
    'entryResult',
    'intentInput',
    'grantInput'
  ];
  for (const field of required) {
    if (!isPlainObject(chain[field])) failures.push(field + '_missing');
  }
  if (failures.length > 0) return uniqueSorted(failures);

  const validation =
    validatePublicWebCanaryExecutionAuthorizationGrantReservationBoundaryResult(
      chain.grantResult,
      chain.intentResult,
      chain.reviewResult,
      chain.fakeDryRunResult,
      chain.dryRunResult,
      chain.consumerResult,
      chain.referenceResult,
      chain.entryResult,
      chain.intentInput,
      chain.grantInput
    );

  if (!validation.valid) {
    for (const error of validation.errors) {
      failures.push('grant_chain_validation::' + error);
    }
  }

  const grant = chain.grantResult;
  if (grant.ok !== true) failures.push('grant_result_not_ok');
  if (
    grant.status !==
    'PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANTED_RESERVED'
  ) {
    failures.push('grant_status_not_granted_reserved');
  }
  if (
    grant.next_state !==
    'WAITING_PUBLIC_WEB_CANARY_REAL_NON_PRODUCTION_EXECUTION_BRIDGE'
  ) {
    failures.push('grant_next_state_mismatch');
  }
  if (
    grant.validator_version !==
    PUBLIC_WEB_CANARY_EXECUTION_AUTHORIZATION_GRANT_RESERVATION_VALIDATOR_VERSION
  ) {
    failures.push('grant_validator_version_mismatch');
  }

  const authorization = grant.authorization_grant;
  const reservation = grant.execution_reservation;
  if (!isPlainObject(authorization)) failures.push('authorization_grant_missing');
  if (!isPlainObject(reservation)) failures.push('execution_reservation_missing');

  if (isPlainObject(authorization)) {
    if (authorization.authorization_granted !== true) {
      failures.push('authorization_not_granted');
    }
    if (authorization.execution_reservation_created !== true) {
      failures.push('authorization_reservation_not_created');
    }
    if (!ALLOWED_ENVIRONMENTS.includes(authorization.environment)) {
      failures.push('authorization_environment_blocked');
    }
    if (
      authorization.authorization_scope !==
      'PUBLIC_WEB_CANARY_SINGLE_EXECUTION_NON_PRODUCTION'
    ) {
      failures.push('authorization_scope_mismatch');
    }
    if (authorization.execution_count_limit !== 1) {
      failures.push('authorization_execution_count_not_one');
    }
    if (authorization.authorization_token_materialized !== false) {
      failures.push('authorization_token_materialized_unexpected');
    }
    if (authorization.executed !== false) {
      failures.push('authorization_already_executed');
    }
    if (authorization.real_execution_authorized !== false) {
      failures.push('authorization_real_execution_flag_preexisting');
    }
    if (authorization.production_effect !== 'ZERO') {
      failures.push('authorization_production_effect_not_zero');
    }
  }

  if (isPlainObject(reservation)) {
    if (reservation.reservation_state !== 'RESERVED_UNCONSUMED') {
      failures.push('reservation_not_unconsumed');
    }
    if (reservation.execution_reservation_created !== true) {
      failures.push('reservation_not_created');
    }
    if (reservation.single_use !== true) {
      failures.push('reservation_not_single_use');
    }
    if (reservation.reserved_execution_count !== 1) {
      failures.push('reservation_execution_count_not_one');
    }
    if (reservation.remaining_execution_count !== 1) {
      failures.push('reservation_remaining_count_not_one');
    }
    if (reservation.reservation_consumed !== false) {
      failures.push('reservation_already_consumed');
    }
    if (reservation.replay_key_reserved !== true) {
      failures.push('reservation_replay_key_not_reserved');
    }
    if (reservation.replay_key_consumed !== false) {
      failures.push('reservation_replay_key_already_consumed');
    }
    if (reservation.real_execution_authorized !== false) {
      failures.push('reservation_real_execution_flag_preexisting');
    }
    if (reservation.production_effect !== 'ZERO') {
      failures.push('reservation_production_effect_not_zero');
    }
  }

  return uniqueSorted(failures);
}

function validateBridgeInput(grantResult, bridgeInput) {
  const failures = [];
  if (!isPlainObject(bridgeInput)) return ['bridge_input_missing'];

  if (bridgeInput.activation_confirmation !== REQUIRED_CONFIRMATION) {
    failures.push('bridge_exact_confirmation_required');
  }
  if (bridgeInput.execution_count !== 1) {
    failures.push('bridge_execution_count_must_be_one');
  }
  if (bridgeInput.single_process_manual_canary !== true) {
    failures.push('bridge_single_process_manual_canary_required');
  }
  if (bridgeInput.write_allowed !== false) {
    failures.push('bridge_write_must_be_false');
  }
  if (bridgeInput.action_allowed !== false) {
    failures.push('bridge_action_must_be_false');
  }
  if (bridgeInput.send_allowed !== false) {
    failures.push('bridge_send_must_be_false');
  }
  if (bridgeInput.publish_allowed !== false) {
    failures.push('bridge_publish_must_be_false');
  }
  if (bridgeInput.delete_allowed !== false) {
    failures.push('bridge_delete_must_be_false');
  }

  const grant = grantResult.authorization_grant || {};
  const reservation = grantResult.execution_reservation || {};
  if (bridgeInput.authorization_grant_id !== grantResult.authorization_grant_id) {
    failures.push('bridge_authorization_grant_id_mismatch');
  }
  if (
    bridgeInput.execution_reservation_id !==
    grantResult.execution_reservation_id
  ) {
    failures.push('bridge_execution_reservation_id_mismatch');
  }
  if (
    bridgeInput.grant_reservation_fingerprint !==
    grantResult.grant_reservation_fingerprint
  ) {
    failures.push('bridge_grant_reservation_fingerprint_mismatch');
  }
  if (bridgeInput.replay_key !== reservation.replay_key) {
    failures.push('bridge_replay_key_mismatch');
  }
  if (bridgeInput.reservation_nonce !== reservation.reservation_nonce) {
    failures.push('bridge_reservation_nonce_mismatch');
  }
  if (bridgeInput.environment !== grant.environment) {
    failures.push('bridge_environment_mismatch');
  }
  if (!ALLOWED_ENVIRONMENTS.includes(bridgeInput.environment)) {
    failures.push('bridge_environment_blocked');
  }
  if (bridgeInput.tenant_id !== reservation.tenant_id) {
    failures.push('bridge_tenant_id_mismatch');
  }
  if (bridgeInput.trial_id !== reservation.trial_id) {
    failures.push('bridge_trial_id_mismatch');
  }
  if (bridgeInput.plan_hash !== reservation.plan_hash) {
    failures.push('bridge_plan_hash_mismatch');
  }

  const requestedAt = canonicalIso(bridgeInput.requested_at);
  if (!requestedAt) failures.push('bridge_requested_at_invalid');
  if (!isNonEmptyString(bridgeInput.execution_id)) {
    failures.push('bridge_execution_id_required');
  }

  const runnerRequest = bridgeInput.runner_request;
  if (!isPlainObject(runnerRequest)) {
    failures.push('bridge_runner_request_missing');
  } else {
    for (const field of [
      'canary_session_id',
      'canary_execution_id',
      'trace_id',
      'request_id',
      'change_id'
    ]) {
      if (!isNonEmptyString(runnerRequest[field])) {
        failures.push('bridge_runner_request_' + field + '_required');
      }
    }
    if (
      isNonEmptyString(bridgeInput.execution_id) &&
      runnerRequest.canary_execution_id !== bridgeInput.execution_id
    ) {
      failures.push('bridge_runner_execution_id_mismatch');
    }
  }

  for (const forbidden of [
    'secret',
    'token',
    'cookie',
    'authorization_header',
    'raw_credentials'
  ]) {
    if (Object.prototype.hasOwnProperty.call(bridgeInput, forbidden)) {
      failures.push('bridge_forbidden_field::' + forbidden);
    }
  }

  return uniqueSorted(failures);
}

function validateRuntime(grantResult, bridgeInput, runtime) {
  const failures = [];
  if (!isPlainObject(runtime)) return ['bridge_runtime_missing'];

  if (
    !runtime.canarySessionRegistry ||
    typeof runtime.canarySessionRegistry.getCanarySession !== 'function'
  ) {
    failures.push('bridge_canary_session_registry_missing');
    return failures;
  }

  if (runtime.requireDurableAudit !== true) {
    failures.push('bridge_durable_audit_required');
  }
  if (
    !runtime.auditSink ||
    runtime.auditSink.durable !== true ||
    typeof runtime.auditSink.appendDurably !== 'function'
  ) {
    failures.push('bridge_durable_audit_sink_required');
  }
  if (typeof runtime.clock !== 'function') {
    failures.push('bridge_clock_required');
  }

  const request = bridgeInput.runner_request || {};
  const session = runtime.canarySessionRegistry.getCanarySession(
    request.canary_session_id
  );
  if (!session) {
    failures.push('bridge_canary_session_missing');
    return uniqueSorted(failures);
  }

  const reservation = grantResult.execution_reservation || {};
  const authorization = grantResult.authorization_grant || {};

  if (session.canary_state !== 'active') {
    failures.push('bridge_canary_session_not_active');
  }
  if (session.environment !== authorization.environment) {
    failures.push('bridge_session_environment_mismatch');
  }
  if (!ALLOWED_ENVIRONMENTS.includes(session.environment)) {
    failures.push('bridge_session_environment_blocked');
  }
  if (session.tenant_id !== reservation.tenant_id) {
    failures.push('bridge_session_tenant_mismatch');
  }
  if (session.maximum_requests !== 1) {
    failures.push('bridge_session_maximum_requests_not_one');
  }
  if (session.requests_used !== 0) {
    failures.push('bridge_session_requests_already_used');
  }
  if (
    Number.isInteger(request.expected_version) &&
    request.expected_version !== session.version
  ) {
    failures.push('bridge_session_version_mismatch');
  }
  if (
    request.target_path !== undefined &&
    request.target_path !== session.target_path
  ) {
    failures.push('bridge_target_path_mismatch');
  }

  return uniqueSorted(failures);
}

function runtimeBinding(grantResult, bridgeInput, runtime) {
  const request = bridgeInput.runner_request;
  const session = runtime.canarySessionRegistry.getCanarySession(
    request.canary_session_id
  );
  return {
    authorization_grant_id: grantResult.authorization_grant_id,
    execution_reservation_id: grantResult.execution_reservation_id,
    grant_reservation_fingerprint:
      grantResult.grant_reservation_fingerprint,
    environment: bridgeInput.environment,
    tenant_id: bridgeInput.tenant_id,
    trial_id: bridgeInput.trial_id,
    plan_hash: bridgeInput.plan_hash,
    execution_id: bridgeInput.execution_id,
    canary_session_id: request.canary_session_id,
    canary_session_version: session && session.version,
    session_environment: session && session.environment,
    session_tenant_id: session && session.tenant_id,
    target_origin: session && session.target_origin,
    target_path: session && session.target_path,
    operation: session && session.operation,
    source_type: session && session.source_type,
    runner_request: request
  };
}

function createPublicWebCanaryRealNonProductionExecutionBridge(options = {}) {
  const ledger =
    options.reservationLedger ||
    createPublicWebCanaryExecutionReservationLedger({
      clock: options.clock
    });

  async function execute(input = {}) {
    const chain = input.chain;
    const bridgeInput = input.bridgeInput;
    const runtime = input.runtime;

    const chainFailures = validateGrantChain(chain);
    if (chainFailures.length > 0) return fail(chainFailures);

    const grantResult = chain.grantResult;

    const bridgeFailures = validateBridgeInput(grantResult, bridgeInput);
    if (bridgeFailures.length > 0) return fail(bridgeFailures);

    const runtimeFailures = validateRuntime(grantResult, bridgeInput, runtime);
    if (runtimeFailures.length > 0) return fail(runtimeFailures);

    const grant = grantResult.authorization_grant;
    const reservation = grantResult.execution_reservation;
    const nowValue = runtime.clock();
    const now = canonicalIso(
      nowValue instanceof Date ? nowValue.toISOString() : String(nowValue)
    );
    if (!now) return fail('bridge_clock_invalid');

    if (Date.parse(now) < Date.parse(grant.issued_at)) {
      return fail('bridge_grant_not_yet_valid');
    }
    if (Date.parse(now) >= Date.parse(grant.expires_at)) {
      return fail('bridge_grant_expired');
    }

    const binding = runtimeBinding(grantResult, bridgeInput, runtime);
    const bindingFingerprint = digest({
      bridge_version:
        PUBLIC_WEB_CANARY_REAL_NON_PRODUCTION_EXECUTION_BRIDGE_VERSION,
      binding
    });

    const registered = ledger.registerReservation({
      execution_reservation_id: grantResult.execution_reservation_id,
      authorization_grant_id: grantResult.authorization_grant_id,
      grant_reservation_fingerprint:
        grantResult.grant_reservation_fingerprint,
      replay_key: reservation.replay_key,
      reservation_nonce: reservation.reservation_nonce,
      issued_at: grant.issued_at,
      expires_at: grant.expires_at,
      environment: grant.environment,
      tenant_id: reservation.tenant_id,
      trial_id: reservation.trial_id,
      plan_hash: reservation.plan_hash
    });

    if (!registered.ok) {
      return fail('bridge_reservation_registration::' + registered.reason);
    }

    // The atomic single-use boundary is consumed immediately before any
    // runner/network await. A blocked or failed runner does not restore it.
    const consumed = ledger.consumeAtomically({
      execution_reservation_id: grantResult.execution_reservation_id,
      authorization_grant_id: grantResult.authorization_grant_id,
      grant_reservation_fingerprint:
        grantResult.grant_reservation_fingerprint,
      replay_key: reservation.replay_key,
      reservation_nonce: reservation.reservation_nonce,
      execution_id: bridgeInput.execution_id,
      runtime_binding_fingerprint: bindingFingerprint,
      consumed_at: now
    });

    if (!consumed.ok) {
      return fail('bridge_reservation_consumption::' + consumed.reason);
    }

    let runnerInvoked = false;
    let runnerResult;
    try {
      const runner =
        input.canaryRunner ||
        options.canaryRunner ||
        runtime.canaryRunner ||
        createPublicWebCanaryRunner(runtime);

      if (!runner || typeof runner.runCanaryRequest !== 'function') {
        return fail('bridge_runner_missing', {
          reservation_consumed: true,
          replay_key_consumed: true
        });
      }

      runnerInvoked = true;
      runnerResult = await runner.runCanaryRequest(
        Object.freeze({ ...bridgeInput.runner_request })
      );
    } catch (_error) {
      return fail('bridge_runner_throw_safe', {
        reservation_consumed: true,
        replay_key_consumed: true,
        runner_invoked: runnerInvoked
      });
    }

    const executed = runnerResult && runnerResult.executed === true;
    const providerCalled =
      runnerResult && runnerResult.real_provider_called === true;

    if (executed !== providerCalled) {
      return fail('bridge_runner_execution_flags_incoherent', {
        reservation_consumed: true,
        replay_key_consumed: true,
        runner_invoked: true,
        executed,
        real_provider_called: providerCalled
      });
    }

    const result = {
      ok: runnerResult && runnerResult.status === 'public_web_candidate_success',
      status:
        runnerResult && runnerResult.status === 'public_web_candidate_success'
          ? 'PUBLIC_WEB_CANARY_REAL_NON_PRODUCTION_EXECUTION_COMPLETED'
          : 'PUBLIC_WEB_CANARY_REAL_NON_PRODUCTION_EXECUTION_FAILED_SAFE',
      decision:
        runnerResult && runnerResult.status === 'public_web_candidate_success'
          ? 'COMPLETE_SINGLE_NON_PRODUCTION_CANARY'
          : 'STOP_AFTER_SINGLE_NON_PRODUCTION_CANARY_ATTEMPT',
      reason_codes:
        runnerResult && runnerResult.status === 'public_web_candidate_success'
          ? ['single_non_production_canary_completed']
          : ['single_non_production_canary_failed_safe'],
      authorization_grant_id: grantResult.authorization_grant_id,
      execution_reservation_id: grantResult.execution_reservation_id,
      execution_id: bridgeInput.execution_id,
      runtime_binding_fingerprint: bindingFingerprint,
      authorization_granted: true,
      execution_reservation_created: true,
      reservation_consumed: true,
      replay_key_consumed: true,
      remaining_execution_count: 0,
      execution_bridge_authorized: true,
      real_execution_authorized: true,
      runner_invoked: true,
      executed,
      real_provider_called: providerCalled,
      environment: grant.environment,
      production_blocked: true,
      production_effect: 'ZERO',
      runner_result: runnerResult,
      ledger_receipt: consumed.reservation,
      validator_version:
        PUBLIC_WEB_CANARY_REAL_NON_PRODUCTION_EXECUTION_BRIDGE_VERSION
    };

    return Object.freeze(result);
  }

  return Object.freeze({
    execute,
    reservationLedger: ledger
  });
}

module.exports = {
  ALLOWED_ENVIRONMENTS,
  PUBLIC_WEB_CANARY_REAL_NON_PRODUCTION_EXECUTION_BRIDGE_VERSION,
  REQUIRED_CONFIRMATION,
  createPublicWebCanaryRealNonProductionExecutionBridge
};
