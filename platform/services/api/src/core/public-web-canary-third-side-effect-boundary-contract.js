'use strict';

const VERSION = 'public_web_third_canary_side_effect_boundary_contract_v1';
const REQUIRED_CONFIRMATION = 'EXECUTAR CANARY PUBLIC WEB';
const MAX_CONFIRMATION_AGE_MS = 120000;

function fail(reason) {
  return Object.freeze({
    ok: false,
    status: 'THIRD_CANARY_SIDE_EFFECT_BOUNDARY_BLOCKED',
    reason,
    side_effect_boundary_ready: false,
    execution_command_prepared: false,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    version: VERSION
  });
}

function exactScope(scope = {}) {
  return scope.environment === 'staging'
    && scope.target_origin === 'https://example.com'
    && scope.target_path === '/'
    && scope.method === 'GET'
    && scope.port === 443
    && scope.maximum_requests === 1
    && scope.rollout_percentage === 1;
}

function preparePublicWebThirdCanarySideEffectBoundary(input = {}, options = {}) {
  const prior = input.pre_execution_orchestration || {};
  if (
    prior.ok !== true ||
    prior.status !== 'THIRD_CANARY_PRE_EXECUTION_ORCHESTRATION_READY_NOT_STARTED' ||
    prior.durable_resources_materialized !== true ||
    prior.resources_consumed !== true ||
    prior.execution_reserved !== true ||
    prior.execution_entry_ready !== true ||
    prior.execution_started !== false ||
    prior.provider_invoked !== false ||
    prior.transport_invoked !== false ||
    prior.external_network_called !== false ||
    prior.production_allowed !== false ||
    prior.requires_fresh_explicit_human_execution_authorization_at_side_effect_boundary !== true ||
    prior.required_confirmation !== REQUIRED_CONFIRMATION
  ) return fail('pre_execution_orchestration_required');

  const keys = ['trial_id', 'official_authorization_id', 'preparatory_authorization_id', 'grant_id', 'reservation_id'];
  if (keys.some((key) => typeof input[key] !== 'string' || input[key].length === 0 || prior[key] !== input[key])) {
    return fail('pre_execution_identity_mismatch');
  }

  if (!exactScope(input.execution_scope)) return fail('approved_execution_scope_required');
  const finalEntry = prior.final_execution_entry || {};
  if (
    finalEntry.ok !== true ||
    finalEntry.status !== 'THIRD_CANARY_FINAL_EXECUTION_ENTRY_READY_NOT_STARTED' ||
    !exactScope(finalEntry.execution_scope) ||
    finalEntry.trial_id !== input.trial_id ||
    finalEntry.official_authorization_id !== input.official_authorization_id ||
    finalEntry.grant_id !== input.grant_id ||
    finalEntry.reservation_id !== input.reservation_id ||
    finalEntry.execution_started !== false ||
    finalEntry.external_network_called !== false ||
    finalEntry.required_confirmation !== REQUIRED_CONFIRMATION
  ) return fail('final_execution_entry_binding_required');

  if (input.production_allowed !== false) return fail('production_must_remain_blocked');
  if (
    input.execute === true ||
    input.start_execution === true ||
    input.provider_invoked === true ||
    input.transport_invoked === true ||
    input.external_network_called === true ||
    input.runner != null ||
    input.transport != null ||
    input.http_client != null ||
    input.network_client != null
  ) return fail('side_effect_dependency_or_action_forbidden');

  if (input.operator_confirmation !== REQUIRED_CONFIRMATION) return fail('fresh_exact_human_confirmation_required');
  const clock = typeof options.clock === 'function' ? options.clock : () => new Date(0).toISOString();
  const now = Date.parse(String(clock()));
  const confirmedAt = Date.parse(String(input.confirmed_at || ''));
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(confirmedAt) ||
    confirmedAt > now ||
    now - confirmedAt > MAX_CONFIRMATION_AGE_MS
  ) return fail('fresh_human_confirmation_required');

  const executionCommand = Object.freeze({
    trial_id: input.trial_id,
    official_authorization_id: input.official_authorization_id,
    preparatory_authorization_id: input.preparatory_authorization_id,
    grant_id: input.grant_id,
    reservation_id: input.reservation_id,
    environment: 'staging',
    target_origin: 'https://example.com',
    target_path: '/',
    method: 'GET',
    port: 443,
    maximum_requests: 1,
    rollout_percentage: 1,
    redirects_allowed: false,
    production_allowed: false,
    confirmed_at: new Date(confirmedAt).toISOString(),
    confirmation_maximum_age_ms: MAX_CONFIRMATION_AGE_MS,
    single_use: true,
    execution_started: false,
    external_network_called: false,
    contract_version: VERSION
  });

  return Object.freeze({
    ok: true,
    status: 'THIRD_CANARY_SIDE_EFFECT_BOUNDARY_READY_COMMAND_PREPARED_NOT_EXECUTED',
    trial_id: input.trial_id,
    execution_command: executionCommand,
    side_effect_boundary_ready: true,
    execution_command_prepared: true,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    next_gate: 'CONTROLLED_SINGLE_REQUEST_EXECUTION_ADAPTER',
    version: VERSION
  });
}

module.exports = {
  MAX_CONFIRMATION_AGE_MS,
  REQUIRED_CONFIRMATION,
  VERSION,
  preparePublicWebThirdCanarySideEffectBoundary
};
