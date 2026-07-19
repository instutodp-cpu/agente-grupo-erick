'use strict';

const { deepClone } = require('../../core/transcription-contract');
const {
  PROVIDER_ADAPTER_ALLOWED_FEATURES,
  TRANSCRIPTION_PROVIDER_ADAPTER_CONTRACT_VERSION,
  TRANSCRIPTION_PROVIDER_ADAPTER_VALIDATOR_VERSION,
  buildProviderAdapterMethodResult,
  cloneFrozen,
  validateProviderAdapterMetadata,
  validateProviderAdapterMethodInput
} = require('../../core/transcription-provider-adapter-interface');
const { TRANSCRIPTION_PROVIDER_CONTRACT_VERSION } = require('../../core/transcription-provider-contract');
const { TRANSCRIPTION_TRANSPORT_CONTRACT_VERSION } = require('../../core/transcription-transport-contract');

function createTranscriptionProviderAdapterMock(overrides = {}) {
  const adapterMetadata = cloneFrozen({
    adapter_id: 'transcription_provider_adapter_mock_deepgram_v1',
    adapter_version: 1,
    provider_slug: 'deepgram',
    provider_version: 'documentary_provider_v1',
    contract_version: TRANSCRIPTION_PROVIDER_ADAPTER_CONTRACT_VERSION,
    validator_version: TRANSCRIPTION_PROVIDER_ADAPTER_VALIDATOR_VERSION,
    supported_features: [...PROVIDER_ADAPTER_ALLOWED_FEATURES].sort(),
    supported_languages: ['pt-BR', 'pt-PT'].sort(),
    supported_formats: ['audio_placeholder_none', 'synthetic_metadata_only'].sort(),
    cost_model: {
      model: 'synthetic_zero_cost',
      currency: 'BRL',
      unit: 'synthetic_minute',
      minor_units: 0
    },
    latency_profile: {
      model: 'synthetic_constant',
      p50_ms: 0,
      p95_ms: 0
    },
    transport_contract_version: TRANSCRIPTION_TRANSPORT_CONTRACT_VERSION,
    provider_contract_version: TRANSCRIPTION_PROVIDER_CONTRACT_VERSION,
    simulated: true,
    executed: false,
    runtime_enabled: false,
    provider_enabled: false,
    network_enabled: false,
    production_blocked: true,
    rollout_percentage: 0,
    ...overrides
  });

  function guarded(method, input, payload) {
    const rawInput = deepClone(input || {
      adapter_id: adapterMetadata.adapter_id,
      provider_slug: adapterMetadata.provider_slug,
      operation: method,
      request_id: `synthetic_${method}_request`,
      simulated: true
    });
    const metadataValidation = validateProviderAdapterMetadata(adapterMetadata);
    const inputValidation = validateProviderAdapterMethodInput(method, rawInput, adapterMetadata);
    if (!metadataValidation.valid || !inputValidation.valid) {
      return buildProviderAdapterMethodResult(method, adapterMetadata, {
        status: `${method}_blocked`,
        result: { allowed: false },
        errors: [...metadataValidation.errors, ...inputValidation.errors].sort()
      });
    }
    return buildProviderAdapterMethodResult(method, adapterMetadata, payload);
  }

  return Object.freeze({
    metadata() {
      return cloneFrozen(adapterMetadata);
    },
    validate(input) {
      return guarded('validate', input, { status: 'validate_simulated', result: { valid: true } });
    },
    health(input) {
      return guarded('health', input, { status: 'health_simulated', result: { healthy: true, connected: false } });
    },
    transcribe(input) {
      return guarded('transcribe', input, { status: 'transcribe_blocked', result: { transcribed: false, provider_called: false } });
    },
    cancel(input) {
      return guarded('cancel', input, { status: 'cancel_blocked', result: { cancelled_real_work: false } });
    },
    capabilities(input) {
      return guarded('capabilities', input, { status: 'capabilities_simulated', result: { supported_features: adapterMetadata.supported_features } });
    },
    supportedFormats(input) {
      return guarded('supportedFormats', input, { status: 'supportedFormats_simulated', result: { supported_formats: adapterMetadata.supported_formats } });
    },
    supportedLanguages(input) {
      return guarded('supportedLanguages', input, { status: 'supportedLanguages_simulated', result: { supported_languages: adapterMetadata.supported_languages } });
    },
    estimateCost(input) {
      return guarded('estimateCost', input, { status: 'estimateCost_simulated', result: { estimated_cost_minor: 0, currency: 'BRL' } });
    },
    estimateLatency(input) {
      return guarded('estimateLatency', input, { status: 'estimateLatency_simulated', result: { estimated_latency_ms: 0 } });
    }
  });
}

module.exports = {
  createTranscriptionProviderAdapterMock
};
