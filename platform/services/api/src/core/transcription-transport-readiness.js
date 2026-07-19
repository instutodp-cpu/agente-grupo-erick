'use strict';

const { sanitizeTranscriptionData } = require('./transcription-contract');
const { uniqueSorted } = require('./read-only-adapter-contract');
const { deepFreeze, TRANSPORT_SAFE_FLAGS } = require('./transcription-transport-contract');
const { validateTranscriptionTransportBoundary } = require('./transcription-transport-validator');

const TRANSPORT_READINESS_DECISIONS = Object.freeze([
  'NOT_READY',
  'READY_FOR_TRANSPORT_REVIEW',
  'READY_FOR_PROVIDER_ADAPTER_REVIEW'
]);

function evaluateTranscriptionTransportReadiness(input = {}, context = {}) {
  const blockers = [];
  const satisfied = [];
  const validation = validateTranscriptionTransportBoundary(input.contract, context);
  if (validation.valid) satisfied.push('transport_boundary_valid');
  else blockers.push(...validation.errors);
  if (input.mock && input.mock.transport_simulated === true && input.mock.network === false && input.mock.connected === false) satisfied.push('transport_mock_safe');
  else blockers.push('transport_mock_safe_required');
  if (input.lifecycle_state === 'blocked') satisfied.push('transport_lifecycle_blocked');
  else blockers.push('transport_lifecycle_must_be_blocked');

  let readiness = 'NOT_READY';
  if (blockers.length === 0) readiness = 'READY_FOR_PROVIDER_ADAPTER_REVIEW';
  else if (satisfied.includes('transport_boundary_valid')) readiness = 'READY_FOR_TRANSPORT_REVIEW';

  return deepFreeze(sanitizeTranscriptionData({
    readiness_status: blockers.length === 0 ? 'transport_readiness_review_only' : 'transport_readiness_blocked',
    readiness_decision: readiness,
    ready_for_network: false,
    ready_for_provider: false,
    ready_for_production: false,
    satisfied_requirements: uniqueSorted(satisfied),
    blocking_requirements: uniqueSorted(blockers),
    evaluated_at: context.now || new Date(0).toISOString(),
    ...TRANSPORT_SAFE_FLAGS
  }));
}

module.exports = {
  TRANSPORT_READINESS_DECISIONS,
  evaluateTranscriptionTransportReadiness
};
