'use strict';

const VERSION = 'public_web_third_canary_final_live_entry_readiness_v1';

function blocked(reason, stage) {
  return Object.freeze({
    ok: false,
    status: 'THIRD_CANARY_FINAL_LIVE_ENTRY_READINESS_BLOCKED',
    reason,
    stage,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    version: VERSION
  });
}

function validSecretAccessContract(contract = {}) {
  return contract.environment === 'staging'
    && contract.purpose === 'public_web_canary_execution'
    && contract.production_allowed === false
    && contract.exportable === false
    && contract.single_request === true;
}

function validWiring(wiring = {}) {
  return wiring.official === true
    && wiring.production_allowed === false
    && wiring.maximum_requests === 1
    && wiring.runner_factory_id === 'public_web_canary_runner'
    && wiring.claim_verifier_id === 'durable_execution_claim_verifier'
    && wiring.feature_flag_resolver_id === 'public_web_dynamic_feature_flag'
    && wiring.kill_switch_resolver_id === 'public_web_dynamic_kill_switch'
    && validSecretAccessContract(wiring.secret_access_contract);
}

function preparePublicWebThirdCanaryFinalLiveEntry(input = {}, wiring = {}) {
  if (
    input.production_allowed !== false ||
    input.maximum_requests !== 1 ||
    input.execution_started !== false ||
    input.external_network_called !== false
  ) return blocked('non_executing_single_request_readiness_input_required', 'INPUT');

  const boundary = input.side_effect_boundary || {};
  const command = boundary.execution_command || {};
  if (
    boundary.ok !== true ||
    boundary.status !== 'THIRD_CANARY_SIDE_EFFECT_BOUNDARY_READY_COMMAND_PREPARED_NOT_EXECUTED' ||
    boundary.execution_started !== false ||
    boundary.external_network_called !== false ||
    command.environment !== 'staging' ||
    command.target_origin !== 'https://example.com' ||
    command.target_path !== '/' ||
    command.method !== 'GET' ||
    command.port !== 443 ||
    command.maximum_requests !== 1 ||
    command.rollout_percentage !== 1 ||
    command.redirects_allowed !== false ||
    command.production_allowed !== false ||
    command.single_use !== true
  ) return blocked('exact_third_canary_scope_required', 'SCOPE');

  if (!validWiring(wiring)) return blocked('official_runtime_wiring_contract_required', 'RUNTIME_WIRING');

  return Object.freeze({
    ok: true,
    status: 'THIRD_CANARY_FINAL_LIVE_ENTRY_WIRING_READY_NOT_STARTED',
    trial_id: command.trial_id,
    reservation_id: command.reservation_id,
    runtime_wiring: Object.freeze({
      runner_factory_id: wiring.runner_factory_id,
      claim_verifier_id: wiring.claim_verifier_id,
      feature_flag_resolver_id: wiring.feature_flag_resolver_id,
      kill_switch_resolver_id: wiring.kill_switch_resolver_id,
      secret_access_contract: Object.freeze({ ...wiring.secret_access_contract })
    }),
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    requires_fresh_human_authorization_at_side_effect_boundary: true,
    version: VERSION
  });
}

module.exports = {
  VERSION,
  preparePublicWebThirdCanaryFinalLiveEntry,
  validSecretAccessContract
};
