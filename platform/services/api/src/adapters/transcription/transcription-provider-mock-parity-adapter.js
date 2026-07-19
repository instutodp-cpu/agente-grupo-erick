'use strict';

const { deepClone, sanitizeTranscriptionData } = require('../../core/transcription-contract');
const { validateProviderContract } = require('../../core/transcription-provider-contract');
const { validateTranscriptionProviderConfiguration } = require('../../core/transcription-provider-configuration-boundary');
const { validateTranscriptionProviderRequest } = require('../../core/transcription-provider-request-contract');
const { normalizeProviderResponse, validateTranscriptionProviderResponse } = require('../../core/transcription-provider-response-contract');
const { classifyTranscriptionProviderError } = require('../../core/transcription-provider-error-taxonomy');

function createTranscriptionProviderMockParityAdapter({ contract, configuration } = {}) {
  let running = false;
  function metadata() {
    return Object.freeze({
      adapter_type: 'mock_parity',
      provider_slug: 'deepgram',
      runtime_enabled: false,
      transport_enabled: false,
      network_enabled: false,
      production_ready: false,
      simulated: true,
      executed: false,
      real_provider_called: false,
      external_network_called: false,
      can_trigger_real_execution: false
    });
  }
  function validateContract(candidate = contract) {
    const validation = validateProviderContract(candidate);
    if (candidate && candidate.provider_slug !== 'deepgram') validation.errors.push('mock_parity_provider_must_be_deepgram');
    validation.valid = validation.errors.length === 0;
    return validation;
  }
  function validateConfiguration(candidate = configuration) {
    return validateTranscriptionProviderConfiguration(candidate, { contract });
  }
  function validateRequest(request) {
    return validateTranscriptionProviderRequest(request, { contract, configuration });
  }
  function responseFor(request, scenario) {
    const statusMap = {
      success: ['synthetic_success', 'completed'],
      timeout: ['synthetic_timeout', 'timed_out'],
      rate_limit: ['synthetic_rate_limited', 'rate_limited'],
      rejection: ['synthetic_rejected', 'rejected'],
      capability_unavailable: ['synthetic_error', 'failed'],
      budget_blocked: ['synthetic_error', 'failed']
    };
    const [responseStatus, normalizedStatus] = statusMap[scenario] || statusMap.success;
    return {
      response_id: `response_${request.request_id}`,
      request_id: request.request_id,
      provider_slug: 'deepgram',
      provider_contract_id: request.provider_contract_id,
      configuration_id: request.configuration_id,
      response_status: responseStatus,
      normalized_status: normalizedStatus,
      synthetic_transcript_summary: `Synthetic ${scenario || 'success'} transcript summary.`,
      synthetic_segments: [{ start_ms: 0, end_ms: Math.min(request.duration_ms, 1000), text: 'Synthetic segment only.', confidence: 0.91 }],
      language: request.language,
      duration_ms: request.duration_ms,
      confidence_band: scenario === 'success' ? 'high_synthetic' : 'not_applicable_synthetic',
      provider_latency_ms_synthetic: scenario === 'timeout' ? request.timeout_ms : 12,
      provider_cost_minor_synthetic: 0,
      provider_request_id_synthetic: `synthetic_${request.request_id}`,
      warnings: [],
      errors: scenario === 'success' ? [] : [scenario],
      received_at: request.requested_at,
      simulated: true,
      executed: false,
      real_provider_called: false,
      external_network_called: false,
      can_trigger_real_execution: false,
      production_blocked: true
    };
  }
  function simulateRequest(request, options = {}) {
    const rawRequest = deepClone(request);
    const validation = validateRequest(rawRequest);
    if (!validation.valid) {
      return Object.freeze(sanitizeTranscriptionData({
        status: 'mock_parity_simulation_blocked',
        errors: validation.errors,
        simulated: true,
        executed: false,
        real_provider_called: false,
        external_network_called: false,
        can_trigger_real_execution: false
      }));
    }
    if (running) {
      return Object.freeze(sanitizeTranscriptionData({
        status: 'mock_parity_simulation_blocked',
        errors: ['mock_parity_adapter_running'],
        simulated: true,
        executed: false,
        real_provider_called: false,
        external_network_called: false,
        can_trigger_real_execution: false
      }));
    }
    running = true;
    try {
      const scenario = options.scenario || 'success';
      const response = responseFor(rawRequest, scenario);
      const responseValidation = validateTranscriptionProviderResponse(response, { request: rawRequest });
      return Object.freeze(sanitizeTranscriptionData({
        status: responseValidation.valid ? 'mock_parity_simulation_completed' : 'mock_parity_simulation_blocked',
        response: responseValidation.valid ? normalizeProviderResponse(response) : null,
        errors: responseValidation.errors,
        simulated: true,
        executed: false,
        real_provider_called: false,
        external_network_called: false,
        can_trigger_real_execution: false,
        production_blocked: true
      }));
    } finally {
      running = false;
    }
  }
  return Object.freeze({
    metadata,
    validateContract,
    validateConfiguration,
    validateRequest,
    simulateRequest,
    normalizeSyntheticResponse: normalizeProviderResponse,
    classifySyntheticError: classifyTranscriptionProviderError,
    healthCheckSynthetic() {
      return Object.freeze({ status: 'synthetic_healthy', ...metadata() });
    }
  });
}

module.exports = {
  createTranscriptionProviderMockParityAdapter
};
