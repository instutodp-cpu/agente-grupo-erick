'use strict';

const { deepClone } = require('../../core/transcription-contract');
const { validateTranscriptionTransportBoundary } = require('../../core/transcription-transport-validator');
const {
  buildTranscriptionTransportMockResult,
  validateTranscriptionTransportContract,
  safeTransportResult
} = require('../../core/transcription-transport-contract');
const { validateTranscriptionTransportPolicy } = require('../../core/transcription-transport-policy');
const { buildTranscriptionTransportMetadata } = require('../../core/transcription-transport-metadata');

function createTranscriptionTransportMock({ contract } = {}) {
  function metadata() {
    return buildTranscriptionTransportMetadata({
      adapter_type: 'transcription_transport_mock',
      provider_slug: contract && contract.provider_slug || 'provider_not_bound',
      transport_simulated: true,
      network: false,
      connected: false
    });
  }

  function validate(candidate = contract, context = {}) {
    const boundary = validateTranscriptionTransportBoundary(candidate, context);
    return Object.freeze({
      valid: boundary.valid,
      allowed: false,
      decision: boundary.decision,
      errors: boundary.errors
    });
  }

  function simulateConnect(candidate = contract, context = {}) {
    const raw = deepClone(candidate);
    const boundary = validateTranscriptionTransportBoundary(raw, context);
    if (!boundary.valid) {
      return safeTransportResult({
        status: 'transport_mock_connect_blocked',
        transport_simulated: true,
        network: false,
        connected: false,
        blockers: boundary.errors
      });
    }
    return safeTransportResult({
      status: 'transport_mock_connect_simulated',
      mock_result: buildTranscriptionTransportMockResult(raw, {
        generated_at: context.now || new Date(0).toISOString()
      }),
      transport_contract_id: raw.transport_contract_id,
      provider_slug: raw.provider_slug,
      transport_type: raw.transport_type,
      transport_simulated: true,
      network: false,
      connected: false
    });
  }

  function simulateDisconnect(candidate = contract) {
    const validation = validateTranscriptionTransportContract(candidate);
    return safeTransportResult({
      status: validation.valid ? 'transport_mock_disconnect_simulated' : 'transport_mock_disconnect_blocked',
      transport_simulated: true,
      network: false,
      connected: false,
      blockers: validation.errors
    });
  }

  function health(candidate = contract) {
    const policy = candidate && candidate.transport_policy;
    const contractValidation = validateTranscriptionTransportContract(candidate);
    const policyValidation = validateTranscriptionTransportPolicy(policy);
    return safeTransportResult({
      status: contractValidation.valid && policyValidation.valid ? 'transport_mock_healthy' : 'transport_mock_blocked',
      transport_simulated: true,
      network: false,
      connected: false,
      blockers: [...contractValidation.errors, ...policyValidation.errors].sort()
    });
  }

  return Object.freeze({
    metadata,
    validate,
    simulateConnect,
    simulateDisconnect,
    health
  });
}

module.exports = {
  createTranscriptionTransportMock
};
