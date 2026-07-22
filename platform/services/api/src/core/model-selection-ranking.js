'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { COST_TIERS } = require('./model-contract');
const { NO_LLM_CANDIDATE_ID } = require('./model-selection-candidate');

const MODEL_SELECTION_RANKING_VALIDATOR_VERSION = 'model_selection_ranking_validator_v1';
const SELECTION_RANKING_FIELDS = Object.freeze([
  'ranking_id', 'selection_request_id', 'eligible_candidate_ids', 'ineligible_candidate_ids', 'ordered_candidate_ids',
  'primary_candidate_id', 'fallback_candidate_ids', 'escalation_candidate_ids', 'tie_breaker_applied',
  'tie_breaker_reason', 'ranking_fingerprint', 'ranking_generated', 'selection_executed', 'validator_version'
]);
const NO_ELIGIBLE_CANDIDATE_SENTINEL = 'NONE_ELIGIBLE_SIMULATION';
const TIE_BREAKER_NOT_REQUIRED = 'tie_breaker_not_required';
const TIE_BREAKER_MODEL_ID_APPLIED = 'tie_breaker_model_id_applied';
const MAX_CANDIDATE_IDS = 200;

const COST_TIER_RANK = Object.freeze(COST_TIERS.reduce((acc, tier, index) => ({ ...acc, [tier]: index }), {}));
const QUALITY_TIER_RANK = Object.freeze({ UTILITY: 0, BASIC: 1, STANDARD: 2, ADVANCED: 3, PREMIUM: 4, SPECIALIST: 5 });
const LATENCY_TIER_RANK = Object.freeze({ VERY_LOW: 0, LOW: 1, MODERATE: 2, HIGH: 3, BATCH_REFERENCE: 4, UNKNOWN_BLOCKED: 5 });
const PRIVACY_TIER_RANK = Object.freeze({
  PUBLIC_PROCESSING_REFERENCE: 0, STANDARD_PROCESSING_REFERENCE: 1, NO_TRAINING_REFERENCE: 2,
  PRIVATE_GATEWAY_REFERENCE: 3, LOCAL_PROCESSING_REFERENCE: 4, RESTRICTED_BLOCKED: 5
});
const AVAILABILITY_STATUS_RANK = Object.freeze({ AVAILABLE_REFERENCE: 0, DEGRADED_REFERENCE: 1, UNAVAILABLE_REFERENCE: 2, UNKNOWN_BLOCKED: 3 });
const HEALTH_STATUS_RANK = Object.freeze({ HEALTHY_REFERENCE: 0, DEGRADED_REFERENCE: 1, UNHEALTHY_REFERENCE: 2, UNKNOWN_BLOCKED: 3 });

function rankOf(map, key, fallback) {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback;
}

function tieBreakKey(candidate) {
  return candidate.model_id || candidate.candidate_id;
}

function compareEligibleCandidatesWithoutTieBreak(a, b) {
  const aIsNoLlm = a.candidate_id === NO_LLM_CANDIDATE_ID;
  const bIsNoLlm = b.candidate_id === NO_LLM_CANDIDATE_ID;
  if (aIsNoLlm !== bIsNoLlm) return aIsNoLlm ? -1 : 1;

  const costTierDiff = rankOf(COST_TIER_RANK, a.cost_tier, 99) - rankOf(COST_TIER_RANK, b.cost_tier, 99);
  if (costTierDiff !== 0) return costTierDiff;

  const costDiff = a.estimated_cost_minor_units - b.estimated_cost_minor_units;
  if (costDiff !== 0) return costDiff;

  const capabilityDiff = (b.supported_capabilities ? b.supported_capabilities.length : 0) - (a.supported_capabilities ? a.supported_capabilities.length : 0);
  if (capabilityDiff !== 0) return capabilityDiff;

  const qualityDiff = rankOf(QUALITY_TIER_RANK, b.quality_tier, -1) - rankOf(QUALITY_TIER_RANK, a.quality_tier, -1);
  if (qualityDiff !== 0) return qualityDiff;

  const privacyDiff = rankOf(PRIVACY_TIER_RANK, b.privacy_tier, -1) - rankOf(PRIVACY_TIER_RANK, a.privacy_tier, -1);
  if (privacyDiff !== 0) return privacyDiff;

  const latencyDiff = rankOf(LATENCY_TIER_RANK, a.latency_tier, 99) - rankOf(LATENCY_TIER_RANK, b.latency_tier, 99);
  if (latencyDiff !== 0) return latencyDiff;

  const availabilityDiff = rankOf(AVAILABILITY_STATUS_RANK, a.availability_status, 99) - rankOf(AVAILABILITY_STATUS_RANK, b.availability_status, 99);
  if (availabilityDiff !== 0) return availabilityDiff;

  const healthDiff = rankOf(HEALTH_STATUS_RANK, a.health_status, 99) - rankOf(HEALTH_STATUS_RANK, b.health_status, 99);
  if (healthDiff !== 0) return healthDiff;

  const localDiff = (b.local_reference === true ? 1 : 0) - (a.local_reference === true ? 1 : 0);
  if (localDiff !== 0) return localDiff;

  return 0;
}

function compareEligibleCandidates(a, b) {
  const withoutTieBreak = compareEligibleCandidatesWithoutTieBreak(a, b);
  if (withoutTieBreak !== 0) return withoutTieBreak;
  const keyA = tieBreakKey(a);
  const keyB = tieBreakKey(b);
  if (keyA < keyB) return -1;
  if (keyA > keyB) return 1;
  return 0;
}

function isUniqueStringList(list, maxItems = MAX_CANDIDATE_IDS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  return new Set(list).size === list.length;
}

function isOrderedUniqueStringList(list, maxItems = MAX_CANDIDATE_IDS) {
  if (!isUniqueStringList(list, maxItems)) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateModelSelectionRanking(ranking) {
  const errors = [];
  if (!isPlainObject(ranking)) return { valid: false, errors: ['ranking_must_be_object'] };
  exactFields(ranking, SELECTION_RANKING_FIELDS, 'ranking', errors);
  for (const field of ['ranking_id', 'selection_request_id', 'primary_candidate_id', 'tie_breaker_reason', 'ranking_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(ranking[field])) errors.push(`${field}_invalid`);
  }
  if (!isOrderedUniqueStringList(ranking.ineligible_candidate_ids)) errors.push('ineligible_candidate_ids_invalid');
  for (const field of ['eligible_candidate_ids', 'ordered_candidate_ids', 'fallback_candidate_ids', 'escalation_candidate_ids']) {
    if (!isUniqueStringList(ranking[field])) errors.push(`${field}_invalid`);
  }
  if (typeof ranking.tie_breaker_applied !== 'boolean') errors.push('tie_breaker_applied_must_be_boolean');
  if (ranking.ranking_generated !== true) errors.push('ranking_generated_must_be_true');
  if (ranking.selection_executed !== false) errors.push('selection_executed_must_be_false');

  if (Array.isArray(ranking.ordered_candidate_ids) && Array.isArray(ranking.eligible_candidate_ids) && Array.isArray(ranking.ineligible_candidate_ids)) {
    if (ranking.ordered_candidate_ids.length !== ranking.eligible_candidate_ids.length + ranking.ineligible_candidate_ids.length) {
      errors.push('ordered_candidate_ids_count_mismatch');
    }
  }
  if (isNonEmptyString(ranking.primary_candidate_id) && Array.isArray(ranking.fallback_candidate_ids) && ranking.fallback_candidate_ids.includes(ranking.primary_candidate_id)) {
    errors.push('fallback_candidate_ids_must_not_include_primary_candidate_id');
  }
  if (isNonEmptyString(ranking.primary_candidate_id) && Array.isArray(ranking.escalation_candidate_ids) && ranking.escalation_candidate_ids.includes(ranking.primary_candidate_id)) {
    errors.push('escalation_candidate_ids_must_not_include_primary_candidate_id');
  }
  if (Array.isArray(ranking.fallback_candidate_ids) && Array.isArray(ranking.escalation_candidate_ids)) {
    const overlap = ranking.escalation_candidate_ids.filter((id) => ranking.fallback_candidate_ids.includes(id));
    if (overlap.length > 0) errors.push('escalation_candidate_ids_must_not_overlap_fallback_candidate_ids');
  }

  if (ranking.validator_version !== MODEL_SELECTION_RANKING_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(ranking);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(ranking));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildModelSelectionRanking(rankingId, selectionRequestId, candidates, constraints) {
  if (!isNonEmptyString(rankingId) || !isNonEmptyString(selectionRequestId) || !Array.isArray(candidates) || !isPlainObject(constraints)) {
    throw new Error('build_model_selection_ranking_requires_ranking_id_selection_request_id_candidates_and_constraints');
  }
  const seenCandidateIds = new Set();
  for (const candidate of candidates) {
    const candidateId = isPlainObject(candidate) ? candidate.candidate_id : undefined;
    if (!isNonEmptyString(candidateId)) {
      throw new Error('model_selection_ranking_candidate_id_missing');
    }
    if (seenCandidateIds.has(candidateId)) {
      throw new Error(`model_selection_ranking_duplicate_candidate_id::${candidateId}`);
    }
    seenCandidateIds.add(candidateId);
  }
  const eligible = candidates.filter((candidate) => candidate.candidate_status === 'ELIGIBLE_SIMULATION');
  const ineligible = candidates.filter((candidate) => candidate.candidate_status !== 'ELIGIBLE_SIMULATION');
  const orderedEligible = [...eligible].sort(compareEligibleCandidates);
  const orderedIneligibleIds = [...ineligible.map((candidate) => candidate.candidate_id)].sort();
  const orderedCandidateIds = [...orderedEligible.map((candidate) => candidate.candidate_id), ...orderedIneligibleIds];

  let tieBreakerApplied = false;
  for (let i = 1; i < orderedEligible.length; i += 1) {
    if (compareEligibleCandidatesWithoutTieBreak(orderedEligible[i - 1], orderedEligible[i]) === 0) {
      tieBreakerApplied = true;
    }
  }

  const primaryCandidateId = orderedEligible.length > 0 ? orderedEligible[0].candidate_id : NO_ELIGIBLE_CANDIDATE_SENTINEL;
  const maximumFallbacks = Number.isInteger(constraints.maximum_fallbacks) ? constraints.maximum_fallbacks : 0;
  const maximumEscalations = Number.isInteger(constraints.maximum_escalations) ? constraints.maximum_escalations : 0;
  const remainingAfterPrimary = orderedEligible.slice(1);
  const fallbackCandidateIds = remainingAfterPrimary.slice(0, maximumFallbacks).map((candidate) => candidate.candidate_id);
  const escalationCandidateIds = remainingAfterPrimary.slice(maximumFallbacks, maximumFallbacks + maximumEscalations).map((candidate) => candidate.candidate_id);

  const ranking = {
    ranking_id: rankingId,
    selection_request_id: selectionRequestId,
    eligible_candidate_ids: orderedEligible.map((candidate) => candidate.candidate_id),
    ineligible_candidate_ids: orderedIneligibleIds,
    ordered_candidate_ids: orderedCandidateIds,
    primary_candidate_id: primaryCandidateId,
    fallback_candidate_ids: fallbackCandidateIds,
    escalation_candidate_ids: escalationCandidateIds,
    tie_breaker_applied: tieBreakerApplied,
    tie_breaker_reason: tieBreakerApplied ? TIE_BREAKER_MODEL_ID_APPLIED : TIE_BREAKER_NOT_REQUIRED,
    ranking_generated: true,
    selection_executed: false,
    validator_version: MODEL_SELECTION_RANKING_VALIDATOR_VERSION
  };
  ranking.ranking_fingerprint = stablePayload({
    ordered_candidate_ids: ranking.ordered_candidate_ids,
    primary_candidate_id: ranking.primary_candidate_id,
    fallback_candidate_ids: ranking.fallback_candidate_ids,
    escalation_candidate_ids: ranking.escalation_candidate_ids
  });
  const validation = validateModelSelectionRanking(ranking);
  if (!validation.valid) {
    throw new Error(`model_selection_ranking_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(ranking);
}

module.exports = {
  AVAILABILITY_STATUS_RANK,
  COST_TIER_RANK,
  HEALTH_STATUS_RANK,
  LATENCY_TIER_RANK,
  MODEL_SELECTION_RANKING_VALIDATOR_VERSION,
  NO_ELIGIBLE_CANDIDATE_SENTINEL,
  PRIVACY_TIER_RANK,
  QUALITY_TIER_RANK,
  SELECTION_RANKING_FIELDS,
  TIE_BREAKER_MODEL_ID_APPLIED,
  TIE_BREAKER_NOT_REQUIRED,
  buildModelSelectionRanking,
  compareEligibleCandidates,
  compareEligibleCandidatesWithoutTieBreak,
  validateModelSelectionRanking
};
