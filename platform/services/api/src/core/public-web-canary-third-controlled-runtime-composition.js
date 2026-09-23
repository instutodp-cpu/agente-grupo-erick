'use strict';

const { executePublicWebThirdCanarySingleRequest } =
  require('./public-web-canary-third-controlled-single-request-adapter');

const VERSION = 'public_web_third_canary_controlled_runtime_composition_v1';

function blocked(reason, stage, detail) {
  return Object.freeze({
    ok: false,
    status: 'THIRD_CANARY_CONTROLLED_RUNTIME_COMPOSITION_BLOCKED',
    reason,
    stage,
    detail: detail || null,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    version: VERSION
  });
}

function exactIdentity(boundary, claim, runtime) {
  const command = boundary && boundary.execution_command || {};
  return boundary && boundary.ok === true
    && boundary.status === 'THIRD_CANARY_SIDE_EFFECT_BOUNDARY_READY_COMMAND_PREPARED_NOT_EXECUTED'
    && claim && claim.ok === true
    && claim.status === 'THIRD_CANARY_DURABLE_EXECUTION_CLAIMED_NOT_STARTED_NOT_EXECUTED'
    && claim.trial_id === command.trial_id
    && claim.reservation_id === command.reservation_id
    && runtime && runtime.canary_execution_id === command.reservation_id;
}

async function executePublicWebThirdCanaryControlledRuntime(input = {}, dependencies = {}, options = {}) {
  if (
    input.production_allowed !== false ||
    input.maximum_requests !== 1 ||
    input.execute !== true
  ) return blocked('explicit_controlled_execution_input_required', 'INPUT');

  const boundary = input.side_effect_boundary;
  const claim = input.execution_claim;
  const runtime = input.runtime_binding;
  if (!exactIdentity(boundary, claim, runtime)) return blocked('runtime_chain_identity_binding_required', 'BINDING');

  const claimVerifier = dependencies.claimVerifier;
  const runner = dependencies.runner;
  if (!claimVerifier || typeof claimVerifier.verifyClaim !== 'function') {
    return blocked('durable_claim_verifier_required', 'DEPENDENCIES');
  }
  if (!runner || typeof runner.runCanaryRequest !== 'function') {
    return blocked('official_runner_required', 'DEPENDENCIES');
  }

  const result = await executePublicWebThirdCanarySingleRequest({
    side_effect_boundary: boundary,
    execution_claim: claim,
    runtime_binding: runtime,
    production_allowed: false,
    maximum_requests: 1
  }, { claimVerifier, runner }, options);

  if (!result || result.ok !== true) {
    return Object.freeze({
      ...blocked('controlled_single_request_adapter_blocked', 'CONTROLLED_ADAPTER', result),
      runner_invoked: result && result.runner_invoked === true,
      execution_started: result && result.execution_started === true,
      provider_invoked: result && result.provider_invoked === true,
      transport_invoked: result && result.transport_invoked === true,
      external_network_called: result && result.external_network_called === true
    });
  }

  return Object.freeze({
    ok: true,
    status: 'THIRD_CANARY_CONTROLLED_RUNTIME_COMPOSITION_ATTEMPT_COMPLETED',
    trial_id: result.trial_id,
    reservation_id: result.reservation_id,
    runner_invoked: result.runner_invoked === true,
    execution_started: result.execution_started === true,
    provider_invoked: result.provider_invoked === true,
    transport_invoked: result.transport_invoked === true,
    external_network_called: result.external_network_called === true,
    production_allowed: false,
    controlled_adapter_result: result,
    version: VERSION
  });
}

module.exports = { VERSION, executePublicWebThirdCanaryControlledRuntime };
