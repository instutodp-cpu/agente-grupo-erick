'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const MODEL_SELECTION_SCORE_VALIDATOR_VERSION = 'model_selection_score_validator_v1';
const MODEL_SELECTION_SCORE_VERSION = 'model_selection_score_v1';
const SELECTION_SCORE_FIELDS = Object.freeze([
  'candidate_id', 'eligibility_score', 'capability_score', 'quality_score', 'cost_score', 'latency_score',
  'privacy_score', 'availability_score', 'health_score', 'context_fit_score', 'locality_score', 'zero_cost_score',
  'policy_score', 'risk_penalty', 'unknown_data_penalty', 'total_score', 'score_version', 'reason_codes',
  'validator_version'
]);
const MAX_SCORE_COMPONENT = 100;
const MAX_PENALTY = 100;
const QUALITY_TIER_RANK = Object.freeze({ UTILITY: 0, BASIC: 1, STANDARD: 2, ADVANCED: 3, PREMIUM: 4, SPECIALIST: 5 });
const LATENCY_TIER_RANK = Object.freeze({ VERY_LOW: 0, LOW: 1, MODERATE: 2, HIGH: 3, BATCH_REFERENCE: 4, UNKNOWN_BLOCKED: 5 });
const PRIVACY_TIER_RANK = Object.freeze({
  PUBLIC_PROCESSING_REFERENCE: 0, STANDARD_PROCESSING_REFERENCE: 1, NO_TRAINING_REFERENCE: 2,
  PRIVATE_GATEWAY_REFERENCE: 3, LOCAL_PROCESSING_REFERENCE: 4, RESTRICTED_BLOCKED: 5
});
const ZERO_COST_BONUS = 20;
const LOCALITY_BONUS = 10;

function clampScore(value) {
  return Math.max(0, Math.min(MAX_SCORE_COMPONENT, value));
}

function isOrderedUniqueStringList(list, maxItems = 50) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateModelSelectionScore(score) {
  const errors = [];
  if (!isPlainObject(score)) return { valid: false, errors: ['score_must_be_object'] };
  exactFields(score, SELECTION_SCORE_FIELDS, 'score', errors);
  for (const field of ['candidate_id', 'score_version', 'validator_version']) {
    if (!isNonEmptyString(score[field])) errors.push(`${field}_invalid`);
  }
  for (const field of ['eligibility_score', 'capability_score', 'quality_score', 'cost_score', 'latency_score', 'privacy_score', 'availability_score', 'health_score', 'context_fit_score', 'locality_score', 'zero_cost_score', 'policy_score']) {
    if (!Number.isInteger(score[field]) || score[field] < 0 || score[field] > MAX_SCORE_COMPONENT) errors.push(`${field}_invalid`);
  }
  for (const field of ['risk_penalty', 'unknown_data_penalty']) {
    if (!Number.isInteger(score[field]) || score[field] < 0 || score[field] > MAX_PENALTY) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(score.total_score) || score.total_score < 0) errors.push('total_score_invalid');
  if (score.eligibility_score === 0 && score.total_score !== 0) errors.push('total_score_must_be_0_when_ineligible');
  if (!isOrderedUniqueStringList(score.reason_codes)) errors.push('reason_codes_invalid');
  if (score.validator_version !== MODEL_SELECTION_SCORE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(score);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(score));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function computeModelSelectionScore(candidate, taskProfile, constraints) {
  if (!isPlainObject(candidate) || !isPlainObject(taskProfile) || !isPlainObject(constraints)) {
    throw new Error('compute_model_selection_score_requires_candidate_task_profile_and_constraints');
  }
  const reasonCodes = [];
  const isEligible = candidate.candidate_status === 'ELIGIBLE_SIMULATION';
  const eligibilityScore = isEligible ? 100 : 0;
  if (!isEligible) reasonCodes.push('candidate_not_eligible');

  const requiredCapabilities = Array.isArray(taskProfile.required_capabilities) ? taskProfile.required_capabilities : [];
  const supportedCapabilities = Array.isArray(candidate.supported_capabilities) ? candidate.supported_capabilities : [];
  const hasAllCapabilities = requiredCapabilities.every((capability) => supportedCapabilities.includes(capability));
  const capabilityScore = hasAllCapabilities ? 100 : 0;
  if (!hasAllCapabilities) reasonCodes.push('capability_coverage_insufficient');

  const qualityRank = Object.prototype.hasOwnProperty.call(QUALITY_TIER_RANK, candidate.quality_tier) ? QUALITY_TIER_RANK[candidate.quality_tier] : 0;
  const qualityScore = clampScore(qualityRank * 20);

  const maximumCost = Number.isInteger(constraints.maximum_cost_minor_units) ? constraints.maximum_cost_minor_units : 0;
  let costScore;
  if (candidate.estimated_cost_minor_units === 0) {
    costScore = 100;
  } else if (maximumCost > 0) {
    costScore = clampScore(100 - Math.floor((candidate.estimated_cost_minor_units * 100) / maximumCost));
  } else {
    costScore = 0;
  }

  const latencyRank = Object.prototype.hasOwnProperty.call(LATENCY_TIER_RANK, candidate.latency_tier) ? LATENCY_TIER_RANK[candidate.latency_tier] : 5;
  const latencyScore = clampScore(100 - latencyRank * 20);

  const privacyRank = Object.prototype.hasOwnProperty.call(PRIVACY_TIER_RANK, candidate.privacy_tier) ? PRIVACY_TIER_RANK[candidate.privacy_tier] : 0;
  const privacyScore = clampScore(privacyRank * 20);
  if (privacyRank >= PRIVACY_TIER_RANK.PRIVATE_GATEWAY_REFERENCE) reasonCodes.push('strong_privacy_bonus_applied');

  const availabilityScore = candidate.availability_status === 'AVAILABLE_REFERENCE' ? 100 : candidate.availability_status === 'DEGRADED_REFERENCE' ? 50 : 0;
  const healthScore = candidate.health_status === 'HEALTHY_REFERENCE' ? 100 : candidate.health_status === 'DEGRADED_REFERENCE' ? 50 : 0;

  const estimatedTotalTokens = Number.isInteger(taskProfile.estimated_total_tokens) ? taskProfile.estimated_total_tokens : 0;
  const contextFitScore = Number.isInteger(candidate.context_window_tokens) && candidate.context_window_tokens >= estimatedTotalTokens ? 100 : 0;
  if (contextFitScore === 0) reasonCodes.push('context_fit_insufficient');

  const zeroCostScore = candidate.zero_cost_reference === true ? ZERO_COST_BONUS : 0;
  if (zeroCostScore > 0) reasonCodes.push('zero_cost_bonus_applied');

  const localityScore = candidate.local_reference === true && constraints.allow_local === true ? LOCALITY_BONUS : 0;
  if (localityScore > 0) reasonCodes.push('locality_bonus_applied');

  const policyScore = isEligible ? 100 : 0;

  const riskPenalty = taskProfile.risk_classification === 'HIGH' ? 10 : 0;
  if (riskPenalty > 0) reasonCodes.push('high_risk_penalty_applied');

  const unknownDataPenalty = candidate.cost_tier === 'UNKNOWN_BLOCKED' || candidate.availability_status === 'UNKNOWN_BLOCKED' || candidate.health_status === 'UNKNOWN_BLOCKED' ? 100 : 0;
  if (unknownDataPenalty > 0) reasonCodes.push('unknown_data_penalty_applied');

  const rawTotal = capabilityScore + qualityScore + costScore + latencyScore + privacyScore + availabilityScore +
    healthScore + contextFitScore + localityScore + zeroCostScore + policyScore - riskPenalty - unknownDataPenalty;
  const totalScore = eligibilityScore === 0 ? 0 : Math.max(0, rawTotal);
  if (eligibilityScore === 0) reasonCodes.push('total_score_forced_0_ineligible');

  const score = {
    candidate_id: candidate.candidate_id,
    eligibility_score: eligibilityScore,
    capability_score: capabilityScore,
    quality_score: qualityScore,
    cost_score: costScore,
    latency_score: latencyScore,
    privacy_score: privacyScore,
    availability_score: availabilityScore,
    health_score: healthScore,
    context_fit_score: contextFitScore,
    locality_score: localityScore,
    zero_cost_score: zeroCostScore,
    policy_score: policyScore,
    risk_penalty: riskPenalty,
    unknown_data_penalty: unknownDataPenalty,
    total_score: totalScore,
    score_version: MODEL_SELECTION_SCORE_VERSION,
    reason_codes: uniqueSorted(reasonCodes),
    validator_version: MODEL_SELECTION_SCORE_VALIDATOR_VERSION
  };
  const validation = validateModelSelectionScore(score);
  if (!validation.valid) {
    throw new Error(`model_selection_score_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(score);
}

module.exports = {
  LATENCY_TIER_RANK,
  MAX_PENALTY,
  MAX_SCORE_COMPONENT,
  MODEL_SELECTION_SCORE_VALIDATOR_VERSION,
  MODEL_SELECTION_SCORE_VERSION,
  PRIVACY_TIER_RANK,
  QUALITY_TIER_RANK,
  SELECTION_SCORE_FIELDS,
  computeModelSelectionScore,
  validateModelSelectionScore
};
