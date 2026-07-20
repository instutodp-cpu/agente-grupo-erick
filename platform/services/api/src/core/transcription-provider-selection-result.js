'use strict';

const { deepClone, findTranscriptionForbiddenFields, sanitizeTranscriptionData } = require('./transcription-contract');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { deepFreeze } = require('./transcription-provider-adapter-interface');
const { stablePayload } = require('./transcription-provider-contract-registry');

const TRANSCRIPTION_PROVIDER_SELECTION_RESULT_VALIDATOR_VERSION = 'transcription_provider_selection_result_validator_v1';
const SELECTION_RESULT_STATUSES = Object.freeze(['SELECTED_SIMULATION', 'NO_ELIGIBLE_PROVIDER', 'VALIDATION_FAILED', 'POLICY_BLOCKED']);
const FORBIDDEN_SELECTION_RESULT_STATUSES = Object.freeze(['SELECTED_REAL', 'EXECUTED', 'CONNECTED', 'PROVIDER_CALLED']);
const SELECTION_REJECTION_CODES = Object.freeze([
  'LANGUAGE_UNSUPPORTED',
  'FORMAT_UNSUPPORTED',
  'SAMPLE_RATE_UNSUPPORTED',
  'CHANNELS_UNSUPPORTED',
  'DURATION_EXCEEDED',
  'SIZE_EXCEEDED',
  'REQUIRED_FEATURE_UNSUPPORTED',
  'ALLOWLIST_BLOCKED',
  'DENYLIST_BLOCKED',
  'INVALID_PROFILE',
  'UNSAFE_PROFILE',
  'POLICY_BLOCKED'
]);

function cloneFrozen(value) {
  return deepFreeze(sanitizeTranscriptionData(deepClone(value)));
}

function validateSelectionResult(result) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['selection_result_must_be_object'] };
  const required = [
    'selection_id',
    'selection_request_id',
    'selected_provider_slug',
    'selected_provider_version',
    'selected_capability_profile_id',
    'selected_capability_profile_version',
    'status',
    'decision',
    'decision_reason',
    'candidate_count',
    'eligible_candidate_count',
    'rejected_candidate_count',
    'ranked_candidates',
    'rejections',
    'scoring_version',
    'validator_version',
    'simulation',
    'network_used',
    'provider_called',
    'executed',
    'production_blocked',
    'rollout_percentage'
  ];
  const allowed = new Set(required);
  for (const field of required) if (!Object.prototype.hasOwnProperty.call(result, field)) errors.push(`missing_${field}`);
  for (const field of Object.keys(result)) if (!allowed.has(field)) errors.push(`unexpected_selection_result_field::${field}`);
  for (const field of ['selection_id', 'selection_request_id', 'status', 'decision', 'decision_reason', 'scoring_version', 'validator_version']) {
    if (!isNonEmptyString(result[field])) errors.push(`${field}_invalid`);
  }
  if (!SELECTION_RESULT_STATUSES.includes(result.status)) errors.push(`selection_status_not_allowed::${result.status}`);
  if (FORBIDDEN_SELECTION_RESULT_STATUSES.includes(result.status)) errors.push(`selection_status_forbidden::${result.status}`);
  for (const field of ['candidate_count', 'eligible_candidate_count', 'rejected_candidate_count', 'selected_capability_profile_version']) {
    if (!Number.isInteger(result[field]) || result[field] < 0) errors.push(`${field}_invalid`);
  }
  if (!Array.isArray(result.ranked_candidates)) errors.push('ranked_candidates_must_be_array');
  if (!Array.isArray(result.rejections)) errors.push('rejections_must_be_array');
  if (Array.isArray(result.rejections)) {
    for (const rejection of result.rejections) {
      if (!SELECTION_REJECTION_CODES.includes(rejection.reason_code)) errors.push(`rejection_reason_code_not_allowed::${rejection.reason_code}`);
    }
  }
  if (result.validator_version !== TRANSCRIPTION_PROVIDER_SELECTION_RESULT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  if (result.simulation !== true) errors.push('simulation_must_be_true');
  if (result.network_used !== false) errors.push('network_used_must_be_false');
  if (result.provider_called !== false) errors.push('provider_called_must_be_false');
  if (result.executed !== false) errors.push('executed_must_be_false');
  if (result.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (result.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  try {
    stablePayload(result);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findTranscriptionForbiddenFields(result));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildSelectionResult(payload) {
  const result = {
    selection_id: payload.selection_id || `selection_${payload.selection_request_id || 'missing'}`,
    selection_request_id: payload.selection_request_id || 'selection_request_not_available',
    selected_provider_slug: payload.selected_provider_slug || 'none',
    selected_provider_version: payload.selected_provider_version || 'none',
    selected_capability_profile_id: payload.selected_capability_profile_id || 'none',
    selected_capability_profile_version: payload.selected_capability_profile_version || 0,
    status: payload.status || 'NO_ELIGIBLE_PROVIDER',
    decision: payload.decision || 'NO_ELIGIBLE_PROVIDER',
    decision_reason: payload.decision_reason || 'no_eligible_provider',
    candidate_count: payload.candidate_count || 0,
    eligible_candidate_count: payload.eligible_candidate_count || 0,
    rejected_candidate_count: payload.rejected_candidate_count || 0,
    ranked_candidates: payload.ranked_candidates || [],
    rejections: payload.rejections || [],
    scoring_version: payload.scoring_version || 'scoring_not_available',
    validator_version: TRANSCRIPTION_PROVIDER_SELECTION_RESULT_VALIDATOR_VERSION,
    simulation: true,
    network_used: false,
    provider_called: false,
    executed: false,
    production_blocked: true,
    rollout_percentage: 0
  };
  return cloneFrozen(result);
}

module.exports = {
  FORBIDDEN_SELECTION_RESULT_STATUSES,
  SELECTION_REJECTION_CODES,
  SELECTION_RESULT_STATUSES,
  TRANSCRIPTION_PROVIDER_SELECTION_RESULT_VALIDATOR_VERSION,
  buildSelectionResult,
  validateSelectionResult
};
