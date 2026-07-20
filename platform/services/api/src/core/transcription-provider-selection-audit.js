'use strict';

const { deepClone, sanitizeTranscriptionData } = require('./transcription-contract');
const { deepFreeze } = require('./transcription-provider-adapter-interface');

const TRANSCRIPTION_PROVIDER_SELECTION_AUDIT_VERSION = 'transcription_provider_selection_audit_v1';

function buildProviderSelectionAudit(input = {}) {
  return deepFreeze(sanitizeTranscriptionData(deepClone({
    audit_id: input.audit_id || `provider_selection_audit_${input.selection_request_id || 'missing'}`,
    selection_request_id: input.selection_request_id || 'selection_request_not_available',
    request_fingerprint: input.request_fingerprint || 'fingerprint_not_available',
    candidate_fingerprints: input.candidate_fingerprints || [],
    filters_applied: input.filters_applied || [],
    rejected_candidates: input.rejected_candidates || [],
    scoring: input.scoring || [],
    weights: input.weights || {},
    tiebreakers: [
      'total_score_desc',
      'compatibility_score_desc',
      'feature_score_desc',
      'estimated_cost_asc',
      'estimated_latency_asc',
      'capability_profile_version_desc',
      'provider_slug_asc'
    ],
    decision: input.decision || 'NO_ELIGIBLE_PROVIDER',
    sequence: Number.isInteger(input.sequence) ? input.sequence : 1,
    versions: {
      audit_version: TRANSCRIPTION_PROVIDER_SELECTION_AUDIT_VERSION,
      scoring_version: input.scoring_version || 'scoring_not_available',
      validator_version: input.validator_version || 'validator_not_available'
    },
    simulation: true,
    network: false,
    provider_execution: false,
    executed: false,
    production_blocked: true,
    rollout_percentage: 0
  })));
}

module.exports = {
  TRANSCRIPTION_PROVIDER_SELECTION_AUDIT_VERSION,
  buildProviderSelectionAudit
};
