'use strict';

const { computeCanonicalContentDigest } = require('./canonical-content-digest');

const VERSION = 'public_web_third_canary_controlled_single_request_adapter_v1';
const CLAIM_STATUS = 'THIRD_CANARY_DURABLE_EXECUTION_CLAIMED_NOT_STARTED_NOT_EXECUTED';
const BOUNDARY_STATUS = 'THIRD_CANARY_SIDE_EFFECT_BOUNDARY_READY_COMMAND_PREPARED_NOT_EXECUTED';
const MAX_CONFIRMATION_AGE_MS = 120000;

function blocked(reason) {
  return Object.freeze({
    ok: false,
    status: 'THIRD_CANARY_CONTROLLED_SINGLE_REQUEST_EXECUTION_BLOCKED',
    reason,
    runner_invoked: false,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    version: VERSION
  });
}

function commandDigest(command = {}) {
  return computeCanonicalContentDigest([
    command.trial_id, command.official_authorization_id, command.preparatory_authorization_id,
    command.grant_id, command.reservation_id, command.environment, command.target_origin,
    command.target_path, command.method, command.port, command.maximum_requests,
    command.rollout_percentage, command.redirects_allowed, command.production_allowed,
    command.confirmed_at, command.confirmation_maximum_age_ms, command.single_use
  ]);
}

function exactCommand(command = {}) {
  return typeof command.trial_id === 'string' && command.trial_id.length > 0
    && typeof command.reservation_id === 'string' && command.reservation_id.length > 0
    && command.environment === 'staging'
    && command.target_origin === 'https://example.com'
    && command.target_path === '/'
    && command.method === 'GET'
    && command.port === 443
    && command.maximum_requests === 1
    && command.rollout_percentage === 1
    && command.redirects_allowed === false
    && command.production_allowed === false
    && command.single_use === true
    && command.execution_started === false
    && command.external_network_called === false
    && command.confirmation_maximum_age_ms === MAX_CONFIRMATION_AGE_MS;
}

async function executePublicWebThirdCanarySingleRequest(input = {}, dependencies = {}, options = {}) {
  const boundary = input.side_effect_boundary || {};
  const claim = input.execution_claim || {};
  const command = boundary.execution_command || {};

  if (
    boundary.ok !== true || boundary.status !== BOUNDARY_STATUS ||
    boundary.side_effect_boundary_ready !== true || boundary.execution_command_prepared !== true ||
    boundary.execution_started !== false || boundary.external_network_called !== false ||
    boundary.production_allowed !== false || !exactCommand(command)
  ) return blocked('valid_side_effect_boundary_required');

  if (
    claim.ok !== true || claim.status !== CLAIM_STATUS || claim.execution_claimed !== true ||
    claim.execution_started !== false || claim.provider_invoked !== false ||
    claim.transport_invoked !== false || claim.external_network_called !== false ||
    claim.production_allowed !== false || claim.trial_id !== command.trial_id ||
    claim.reservation_id !== command.reservation_id || claim.command_fingerprint !== commandDigest(command)
  ) return blocked('durable_execution_claim_binding_required');

  if (input.production_allowed !== false) return blocked('production_must_remain_blocked');
  if (input.maximum_requests != null && input.maximum_requests !== 1) return blocked('single_request_limit_required');

  const clock = typeof options.clock === 'function' ? options.clock : null;
  if (!clock) return blocked('execution_clock_required');
  const now = Date.parse(String(clock()));
  const confirmedAt = Date.parse(String(command.confirmed_at || ''));
  if (!Number.isFinite(now) || !Number.isFinite(confirmedAt) || confirmedAt > now || now - confirmedAt > MAX_CONFIRMATION_AGE_MS) {
    return blocked('fresh_human_confirmation_expired_before_runner');
  }

  const runner = dependencies.runner;
  if (!runner || typeof runner.runCanaryRequest !== 'function') return blocked('controlled_runner_required');

  const runtime = input.runtime_binding || {};
  const required = ['canary_session_id', 'canary_execution_id', 'change_id', 'trace_id', 'request_id'];
  if (required.some((key) => typeof runtime[key] !== 'string' || runtime[key].length === 0)) {
    return blocked('runtime_identity_binding_required');
  }
  if (runtime.canary_execution_id !== command.reservation_id) return blocked('runtime_execution_reservation_binding_mismatch');

  const runnerInput = Object.freeze({
    canary_session_id: runtime.canary_session_id,
    canary_execution_id: runtime.canary_execution_id,
    change_id: runtime.change_id,
    trace_id: runtime.trace_id,
    request_id: runtime.request_id,
    target_path: '/',
    requested_at: new Date(now).toISOString()
  });

  let result;
  try {
    result = await runner.runCanaryRequest(runnerInput);
  } catch (error) {
    return Object.freeze({
      ...blocked('controlled_runner_threw'),
      runner_invoked: true,
      execution_started: true,
      error_name: error && error.name || 'Error'
    });
  }

  const telemetry = {
    provider_invoked: result && result.provider_invoked === true,
    transport_invoked: result && result.transport_invoked === true,
    external_network_called: result && result.external_network_called === true
  };
  return Object.freeze({
    ok: true,
    status: 'THIRD_CANARY_CONTROLLED_SINGLE_REQUEST_EXECUTION_ATTEMPT_COMPLETED',
    trial_id: command.trial_id,
    reservation_id: command.reservation_id,
    runner_invoked: true,
    execution_started: true,
    ...telemetry,
    production_allowed: false,
    runner_result: result,
    version: VERSION
  });
}

module.exports = {
  MAX_CONFIRMATION_AGE_MS,
  VERSION,
  executePublicWebThirdCanarySingleRequest
};
