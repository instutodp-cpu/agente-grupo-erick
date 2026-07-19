'use strict';

const { uniqueSorted } = require('./read-only-adapter-contract');
const { validateTranscriptionTransportContract } = require('./transcription-transport-contract');
const { validateTranscriptionTransportPolicy } = require('./transcription-transport-policy');

function validateTranscriptionTransportBoundary(contract, context = {}) {
  const errors = [];
  const contractValidation = validateTranscriptionTransportContract(contract);
  errors.push(...contractValidation.errors.map((error) => `contract::${error}`));
  if (contract && contract.transport_policy) {
    const policyValidation = validateTranscriptionTransportPolicy(contract.transport_policy);
    errors.push(...policyValidation.errors.map((error) => `policy::${error}`));
  }
  if (context.rollout_percentage !== undefined && context.rollout_percentage !== 0) errors.push('context_rollout_percentage_must_be_zero');
  if (context.runtime_enabled !== undefined && context.runtime_enabled !== false) errors.push('context_runtime_enabled_must_be_false');
  if (context.provider_enabled !== undefined && context.provider_enabled !== false) errors.push('context_provider_enabled_must_be_false');
  if (context.transport_blocked !== undefined && context.transport_blocked !== true) errors.push('context_transport_blocked_must_be_true');
  if (context.secret_resolved !== undefined && context.secret_resolved !== false) errors.push('context_secret_resolved_must_be_false');
  if (context.production_blocked !== undefined && context.production_blocked !== true) errors.push('context_production_blocked_must_be_true');
  if (context.network_enabled !== undefined && context.network_enabled !== false) errors.push('context_network_enabled_must_be_false');
  return {
    valid: errors.length === 0,
    allowed: false,
    decision: errors.length === 0 ? 'TRANSPORT_REVIEW_ONLY' : 'BLOCK',
    errors: uniqueSorted(errors)
  };
}

module.exports = {
  validateTranscriptionTransportBoundary
};
