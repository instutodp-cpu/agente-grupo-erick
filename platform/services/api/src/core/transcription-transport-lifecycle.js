'use strict';

const { uniqueSorted } = require('./read-only-adapter-contract');
const {
  TRANSPORT_REVIEW_PHASES,
  TRANSCRIPTION_TRANSPORT_VALIDATOR_VERSION,
  safeTransportResult,
  validateTransportSafetyFlags
} = require('./transcription-transport-contract');

const TRANSPORT_LIFECYCLE_STATES = Object.freeze(['BLOCKED']);
const ALLOWED_REVIEW_PHASE_TRANSITIONS = Object.freeze({
  draft_review: ['mock_review'],
  mock_review: ['contract_review'],
  contract_review: ['validation_review'],
  validation_review: []
});

function transitionTranscriptionTransportLifecycle(record = {}, transition = {}) {
  const errors = [];
  if (!record.transport_contract_id) errors.push('transport_contract_id_required');
  if (!transition.transition_id) errors.push('transition_id_required');
  if (transition.provider_slug !== record.provider_slug) errors.push('provider_slug_mismatch');
  if (transition.transport_contract_id !== record.transport_contract_id) errors.push('transport_contract_id_mismatch');
  if (transition.contract_version !== record.contract_version) errors.push('contract_version_mismatch');
  if (transition.validator_version !== TRANSCRIPTION_TRANSPORT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  if (transition.current_version !== record.transport_version) errors.push('current_version_mismatch');
  if (record.transport_version !== transition.expected_version) errors.push('transport_version_conflict');
  if (record.transport_state !== 'BLOCKED') errors.push('record_transport_state_must_be_BLOCKED');
  if (transition.from_state !== 'BLOCKED') errors.push('from_state_must_be_BLOCKED');
  if (transition.to_state !== 'BLOCKED') errors.push('to_state_must_be_BLOCKED');
  if (!TRANSPORT_REVIEW_PHASES.includes(record.review_phase)) errors.push(`record_review_phase_not_allowed::${record.review_phase}`);
  if (!TRANSPORT_REVIEW_PHASES.includes(transition.review_phase)) errors.push(`review_phase_not_allowed::${transition.review_phase}`);
  const allowed = ALLOWED_REVIEW_PHASE_TRANSITIONS[record.review_phase] || [];
  if (!allowed.includes(transition.review_phase)) errors.push(`review_phase_transition_not_allowed::${record.review_phase}->${transition.review_phase}`);
  validateTransportSafetyFlags(transition.safety_flags || {}, errors, 'transition');
  if (errors.length > 0) return safeTransportResult({ ok: false, status: 'transport_lifecycle_blocked', errors: uniqueSorted(errors) });
  return safeTransportResult({
    ok: true,
    status: 'transport_lifecycle_transitioned',
    transport_contract_id: record.transport_contract_id,
    transport_state: 'BLOCKED',
    from_state: 'BLOCKED',
    to_state: 'BLOCKED',
    from_review_phase: record.review_phase,
    review_phase: transition.review_phase,
    transport_version: record.transport_version,
    transition_id: transition.transition_id
  });
}

module.exports = {
  ALLOWED_REVIEW_PHASE_TRANSITIONS,
  TRANSPORT_LIFECYCLE_STATES,
  transitionTranscriptionTransportLifecycle
};
