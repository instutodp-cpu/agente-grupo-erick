'use strict';

const { executePublicWebThirdCanaryControlledRuntime } =
  require('./public-web-canary-third-controlled-runtime-composition');

const VERSION = 'public_web_third_canary_final_live_entry_v1';

function blocked(reason, stage) {
  return Object.freeze({
    ok: false,
    status: 'THIRD_CANARY_FINAL_LIVE_ENTRY_BLOCKED',
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

function validRuntime(runtime = {}) {
  return runtime.official === true
    && runtime.production_allowed === false
    && runtime.maximum_requests === 1
    && runtime.runner && typeof runtime.runner.runCanaryRequest === 'function'
    && runtime.claimVerifier && typeof runtime.claimVerifier.verifyClaim === 'function'
    && typeof runtime.featureFlagResolver === 'function'
    && typeof runtime.killSwitchResolver === 'function'
    && validSecretAccessContract(runtime.secretAccessContract);
}

async function executePublicWebThirdCanaryFinalLiveEntry(input = {}, runtime = {}, options = {}) {
  if (
    input.execute !== true ||
    input.production_allowed !== false ||
    input.maximum_requests !== 1
  ) return blocked('explicit_single_request_execution_input_required', 'INPUT');

  if (!validRuntime(runtime)) return blocked('official_runtime_wiring_required', 'RUNTIME_WIRING');

  const boundary = input.side_effect_boundary || {};
  const command = boundary.execution_command || {};
  if (
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

  const result = await executePublicWebThirdCanaryControlledRuntime({
    ...input,
    execute: true,
    production_allowed: false,
    maximum_requests: 1
  }, {
    claimVerifier: runtime.claimVerifier,
    runner: runtime.runner
  }, options);

  if (!result || result.ok !== true) {
    return Object.freeze({
      ...blocked('controlled_runtime_blocked', 'CONTROLLED_RUNTIME'),
      controlled_runtime_result: result || null
    });
  }

  return Object.freeze({
    ok: true,
    status: 'THIRD_CANARY_FINAL_LIVE_ENTRY_ATTEMPT_COMPLETED',
    trial_id: result.trial_id,
    reservation_id: result.reservation_id,
    runner_invoked: result.runner_invoked === true,
    execution_started: result.execution_started === true,
    provider_invoked: result.provider_invoked === true,
    transport_invoked: result.transport_invoked === true,
    external_network_called: result.external_network_called === true,
    production_allowed: false,
    controlled_runtime_result: result,
    version: VERSION
  });
}

module.exports = {
  VERSION,
  executePublicWebThirdCanaryFinalLiveEntry,
  validSecretAccessContract
};
