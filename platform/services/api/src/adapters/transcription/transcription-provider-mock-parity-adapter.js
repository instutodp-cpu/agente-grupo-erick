'use strict';

const { deepClone, sanitizeTranscriptionData } = require('../../core/transcription-contract');
const { validateProviderContract } = require('../../core/transcription-provider-contract');
const { validateTranscriptionProviderConfiguration } = require('../../core/transcription-provider-configuration-boundary');
const { validateTranscriptionProviderRequest } = require('../../core/transcription-provider-request-contract');
const { normalizeProviderResponse, validateTranscriptionProviderResponse } = require('../../core/transcription-provider-response-contract');
const { classifyTranscriptionProviderError } = require('../../core/transcription-provider-error-taxonomy');

const SAFE_FLAGS = Object.freeze({
  simulated: true,
  executed: false,
  real_provider_called: false,
  external_network_called: false,
  can_trigger_real_execution: false,
  production_blocked: true,
  provider_runtime_enabled: false,
  provider_selected_for_execution: false,
  transport_enabled: false,
  secret_resolved: false
});

function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return value;
}

function blocked(errors) {
  const blockers = unique(errors);
  return deepFreeze(sanitizeTranscriptionData({
    status: 'mock_parity_simulation_blocked',
    response: null,
    blockers,
    errors: blockers,
    ...SAFE_FLAGS
  }));
}

function requireSafeBoundary(record, prefix, errors) {
  if (!record) return;
  if (record.rollout_percentage !== 0) errors.push(`${prefix}_rollout_percentage_must_be_zero`);
  if (record.production_blocked !== true) errors.push(`${prefix}_production_blocked_must_be_true`);
  if (record.provider_runtime_enabled !== false) errors.push(`${prefix}_provider_runtime_enabled_must_be_false`);
  if (record.provider_selected_for_execution !== false) errors.push(`${prefix}_provider_selected_for_execution_must_be_false`);
  if (record.transport_enabled !== false) errors.push(`${prefix}_transport_enabled_must_be_false`);
  if (record.secret_resolved !== false) errors.push(`${prefix}_secret_resolved_must_be_false`);
  if (record.external_network_called === true) errors.push(`${prefix}_external_network_called_must_be_false`);
  if (record.real_provider_called === true) errors.push(`${prefix}_real_provider_called_must_be_false`);
  if (record.executed === true) errors.push(`${prefix}_executed_must_be_false`);
  if (record.can_trigger_real_execution === true) errors.push(`${prefix}_can_trigger_real_execution_must_be_false`);
}

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
      ...SAFE_FLAGS
    });
  }
  function validateContract(candidate = contract) {
    const validation = validateProviderContract(candidate);
    if (candidate && candidate.provider_slug !== 'deepgram') validation.errors.push('mock_parity_provider_must_be_deepgram');
    validation.valid = validation.errors.length === 0;
    return validation;
  }
  function validateConfiguration(candidate = configuration, candidateContract = contract) {
    return validateTranscriptionProviderConfiguration(candidate, { contract: candidateContract });
  }
  function validateRequest(request, candidateContract = contract, candidateConfiguration = configuration) {
    return validateTranscriptionProviderRequest(request, {
      contract: candidateContract,
      configuration: candidateConfiguration,
      tenant_id: candidateConfiguration && candidateConfiguration.tenant_id,
      workspace_type: candidateConfiguration && candidateConfiguration.workspace_type
    });
  }
  function validateSimulationStart(rawRequest, options = {}) {
    const candidateContract = options.contract || contract;
    const candidateConfiguration = options.configuration || configuration;
    const errors = [];

    if (!candidateContract) errors.push('provider_contract_missing');
    else {
      const contractValidation = validateContract(candidateContract);
      errors.push(...contractValidation.errors.map((error) => `contract::${error}`));
      requireSafeBoundary(candidateContract, 'contract', errors);
    }

    if (!candidateConfiguration) errors.push('provider_configuration_missing');
    else {
      const configurationValidation = validateConfiguration(candidateConfiguration, candidateContract);
      errors.push(...configurationValidation.errors.map((error) => `configuration::${error}`));
      requireSafeBoundary(candidateConfiguration, 'configuration', errors);
      if (candidateConfiguration.network_policy_status !== 'network_blocked') errors.push('configuration_network_policy_must_be_blocked');
    }

    if (candidateContract && candidateConfiguration) {
      if (candidateConfiguration.provider_contract_id !== candidateContract.provider_contract_id) errors.push('configuration_provider_contract_id_mismatch');
      if (candidateConfiguration.provider_slug !== candidateContract.provider_slug) errors.push('configuration_provider_slug_mismatch');
      if (candidateConfiguration.timeout_ms > candidateContract.timeout_limit_ms) errors.push('configuration_timeout_exceeds_contract_limit');
      if (candidateConfiguration.max_duration_ms > candidateContract.max_duration_ms) errors.push('configuration_duration_exceeds_contract_limit');
      if (candidateConfiguration.max_size_bytes > candidateContract.max_size_bytes) errors.push('configuration_size_exceeds_contract_limit');
    }

    const requestValidation = validateRequest(rawRequest, candidateContract, candidateConfiguration);
    errors.push(...requestValidation.errors.map((error) => `request::${error}`));

    if (rawRequest && candidateContract) {
      if (rawRequest.provider_contract_id !== candidateContract.provider_contract_id) errors.push('request_provider_contract_id_mismatch');
      if (rawRequest.provider_slug !== candidateContract.provider_slug) errors.push('request_provider_slug_mismatch');
    }
    if (rawRequest && candidateConfiguration) {
      if (rawRequest.configuration_id !== candidateConfiguration.configuration_id) errors.push('request_configuration_id_mismatch');
      if (rawRequest.tenant_id !== candidateConfiguration.tenant_id) errors.push('request_tenant_id_mismatch');
      if (rawRequest.workspace_type !== candidateConfiguration.workspace_type) errors.push('request_workspace_type_mismatch');
      if (rawRequest.timeout_ms > candidateConfiguration.timeout_ms) errors.push('request_timeout_exceeds_configuration_timeout');
      if (rawRequest.duration_ms > candidateConfiguration.max_duration_ms) errors.push('request_duration_exceeds_configuration_max');
      if (rawRequest.size_bytes > candidateConfiguration.max_size_bytes) errors.push('request_size_exceeds_configuration_max');
    }

    return {
      valid: errors.length === 0,
      errors: unique(errors),
      contract: candidateContract,
      configuration: candidateConfiguration
    };
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
    const validation = validateSimulationStart(rawRequest, options);
    if (!validation.valid) return blocked(validation.errors);
    if (running) {
      return blocked(['mock_parity_adapter_running']);
    }
    running = true;
    try {
      const scenario = options.scenario || 'success';
      const response = responseFor(rawRequest, scenario);
      const responseValidation = validateTranscriptionProviderResponse(response, { request: rawRequest });
      return deepFreeze(sanitizeTranscriptionData({
        status: responseValidation.valid ? 'mock_parity_simulation_completed' : 'mock_parity_simulation_blocked',
        response: responseValidation.valid ? normalizeProviderResponse(response) : null,
        blockers: responseValidation.errors,
        errors: responseValidation.errors,
        ...SAFE_FLAGS
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
