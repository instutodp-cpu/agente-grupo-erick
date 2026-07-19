'use strict';

const { uniqueSorted } = require('./read-only-adapter-contract');
const {
  PROVIDER_ADAPTER_SAFE_FLAGS,
  cloneFrozen,
  validateProviderAdapterImplementation,
  validateProviderAdapterMetadata,
  validateProviderAdapterMethodResult
} = require('./transcription-provider-adapter-interface');

const PROVIDER_ADAPTER_READINESS_DECISIONS = Object.freeze([
  'NOT_READY',
  'READY_FOR_PROVIDER_REVIEW'
]);

function evaluateProviderAdapterReadiness(input = {}, context = {}) {
  const blockers = [];
  const satisfied = [];
  const metadataValidation = validateProviderAdapterMetadata(input.metadata);
  if (metadataValidation.valid) satisfied.push('metadata_valid');
  else blockers.push(...metadataValidation.errors.map((error) => `metadata::${error}`));
  const implementationValidation = validateProviderAdapterImplementation(input.adapter);
  if (implementationValidation.valid) satisfied.push('adapter_interface_complete');
  else blockers.push(...implementationValidation.errors.map((error) => `implementation::${error}`));
  if (input.healthResult) {
    const healthValidation = validateProviderAdapterMethodResult('health', input.healthResult, input.metadata || {});
    if (healthValidation.valid) satisfied.push('health_result_valid');
    else blockers.push(...healthValidation.errors.map((error) => `health::${error}`));
  } else {
    blockers.push('health_result_required');
  }
  if (context.transport_ready !== true) blockers.push('transport_review_required');
  if (context.provider_contract_ready !== true) blockers.push('provider_contract_review_required');

  return cloneFrozen({
    readiness_decision: blockers.length === 0 ? 'READY_FOR_PROVIDER_REVIEW' : 'NOT_READY',
    ready_for_production: false,
    ready_for_network: false,
    ready_for_runtime: false,
    ready_for_provider_execution: false,
    satisfied_requirements: uniqueSorted(satisfied),
    blocking_requirements: uniqueSorted(blockers),
    evaluated_at: context.now || new Date(0).toISOString(),
    ...PROVIDER_ADAPTER_SAFE_FLAGS
  });
}

module.exports = {
  PROVIDER_ADAPTER_READINESS_DECISIONS,
  evaluateProviderAdapterReadiness
};
