'use strict';

const { uniqueSorted } = require('./read-only-adapter-contract');
const { safeTransportResult } = require('./transcription-transport-contract');

const TRANSPORT_LIFECYCLE_STATES = Object.freeze(['absent', 'mocked', 'structurally_valid', 'blocked']);
const ALLOWED_TRANSPORT_TRANSITIONS = Object.freeze({
  absent: ['mocked', 'blocked'],
  mocked: ['structurally_valid', 'blocked'],
  structurally_valid: ['blocked'],
  blocked: []
});

function transitionTranscriptionTransportLifecycle(record = {}, transition = {}) {
  const errors = [];
  if (!record.transport_contract_id) errors.push('transport_contract_id_required');
  if (!transition.transition_id) errors.push('transition_id_required');
  if (!TRANSPORT_LIFECYCLE_STATES.includes(record.transport_state)) errors.push(`transport_state_not_allowed::${record.transport_state}`);
  if (!TRANSPORT_LIFECYCLE_STATES.includes(transition.to_state)) errors.push(`target_state_not_allowed::${transition.to_state}`);
  if (record.transport_version !== transition.expected_version) errors.push('transport_version_conflict');
  const allowed = ALLOWED_TRANSPORT_TRANSITIONS[record.transport_state] || [];
  if (!allowed.includes(transition.to_state)) errors.push(`transport_transition_not_allowed::${record.transport_state}->${transition.to_state}`);
  if (errors.length > 0) return safeTransportResult({ ok: false, status: 'transport_lifecycle_blocked', errors: uniqueSorted(errors) });
  return safeTransportResult({
    ok: true,
    status: 'transport_lifecycle_transitioned',
    transport_contract_id: record.transport_contract_id,
    from_state: record.transport_state,
    to_state: transition.to_state,
    transport_version: record.transport_version + 1,
    transition_id: transition.transition_id
  });
}

module.exports = {
  ALLOWED_TRANSPORT_TRANSITIONS,
  TRANSPORT_LIFECYCLE_STATES,
  transitionTranscriptionTransportLifecycle
};
