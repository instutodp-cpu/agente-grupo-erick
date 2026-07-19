'use strict';

const { sanitizeTranscriptionData } = require('./transcription-contract');
const { uniqueSorted } = require('./read-only-adapter-contract');
const { validateProviderContract } = require('./transcription-provider-contract');
const { validateProviderCapabilitiesSet } = require('./transcription-provider-capabilities');
const { validateTranscriptionProviderSecretReference } = require('./transcription-provider-secret-boundary');
const { validateTranscriptionProviderConfiguration } = require('./transcription-provider-configuration-boundary');

const PROVIDER_CONTRACT_READINESS_DECISIONS = Object.freeze([
  'NOT_READY',
  'INCOMPLETE',
  'READY_FOR_MOCK_PARITY_REVIEW',
  'READY_FOR_SECRET_REFERENCE_REVIEW',
  'READY_FOR_TRANSPORT_CONTRACT_REVIEW'
]);

function evaluateTranscriptionProviderContractReadiness(input = {}, context = {}) {
  const satisfied = [];
  const blockers = [];
  function push(name, validation) {
    if (validation.valid) satisfied.push(name);
    else blockers.push(...validation.errors.map((error) => `${name}::${error}`));
  }
  push('provider_contract_valid', validateProviderContract(input.contract));
  push('capabilities_documented', validateProviderCapabilitiesSet(input.capabilities, { provider_slug: input.contract && input.contract.provider_slug }));
  push('secret_reference_structural_only', validateTranscriptionProviderSecretReference(input.secretReference, context));
  push('configuration_valid', validateTranscriptionProviderConfiguration(input.configuration, { contract: input.contract }));
  if (input.mockParityTestsPassing !== true) blockers.push('mock_parity_tests_not_passing');
  if (input.transport_enabled !== false) blockers.push('transport_enabled');
  if (input.network_blocked !== true) blockers.push('network_not_blocked');
  if (input.runtime_enabled !== false) blockers.push('runtime_enabled');
  if (input.rollout_percentage !== 0) blockers.push('rollout_percentage_must_be_zero');
  if (input.production_blocked !== true) blockers.push('production_not_blocked');
  if (input.endpoint_configured === true) blockers.push('endpoint_configured');
  if (input.secret_present === true) blockers.push('secret_present');
  if (input.raw_audio_present === true) blockers.push('raw_audio_present');

  let decision = 'NOT_READY';
  if (blockers.length === 0) decision = 'READY_FOR_TRANSPORT_CONTRACT_REVIEW';
  else if (satisfied.includes('provider_contract_valid') && satisfied.includes('capabilities_documented') && blockers.every((blocker) => !blocker.startsWith('provider_contract_valid'))) decision = 'READY_FOR_MOCK_PARITY_REVIEW';
  else if (satisfied.includes('provider_contract_valid')) decision = 'INCOMPLETE';

  return Object.freeze(sanitizeTranscriptionData({
    readiness_status: blockers.length === 0 ? 'ready_for_transport_contract_review' : 'contract_readiness_blocked',
    readiness_decision: decision,
    max_decision_allowed: 'READY_FOR_TRANSPORT_CONTRACT_REVIEW',
    ready_for_network: false,
    ready_for_real_provider: false,
    ready_for_execution: false,
    ready_for_production: false,
    satisfied_requirements: uniqueSorted(satisfied),
    blocking_requirements: uniqueSorted(blockers),
    evaluated_at: context.now || new Date(0).toISOString(),
    audit_event_candidate: {
      event_name: blockers.length === 0 ? 'transport_review_recommended' : 'readiness_evaluated',
      provider_slug: input.contract && input.contract.provider_slug || 'provider_not_available',
      decision,
      blockers: uniqueSorted(blockers),
      occurred_at: context.now || new Date(0).toISOString(),
      simulated: true,
      executed: false,
      real_provider_called: false,
      external_network_called: false
    },
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false,
    rollout_percentage: 0,
    production_blocked: true,
    provider_runtime_enabled: false,
    provider_selected_for_execution: false,
    transport_enabled: false,
    secret_resolved: false
  }));
}

module.exports = {
  PROVIDER_CONTRACT_READINESS_DECISIONS,
  evaluateTranscriptionProviderContractReadiness
};
