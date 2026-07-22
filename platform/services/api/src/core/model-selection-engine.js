'use strict';

const { isPlainObject } = require('./read-only-adapter-contract');
const { stablePayload } = require('./agent-identity-contract');
const { validateModelSelectionRequest } = require('./model-selection-request');
const {
  NO_LLM_CANDIDATE_ID,
  buildNoLlmCandidate,
  isNoLlmEligible,
  validateModelSelectionCandidate
} = require('./model-selection-candidate');
const { computeModelSelectionScore } = require('./model-selection-score');
const {
  AVAILABILITY_STATUS_RANK,
  HEALTH_STATUS_RANK,
  LATENCY_TIER_RANK,
  NO_ELIGIBLE_CANDIDATE_SENTINEL,
  PRIVACY_TIER_RANK,
  QUALITY_TIER_RANK,
  buildModelSelectionRanking
} = require('./model-selection-ranking');
const { buildModelSelectionEscalationPlan } = require('./model-selection-escalation-plan');
const { NOT_AVAILABLE_FINGERPRINT, buildModelSelectionDecision } = require('./model-selection-decision');

function rankOf(map, key, fallback) {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback;
}

function safeFingerprint(value) {
  try {
    return stablePayload(value || {});
  } catch (error) {
    return `fingerprint_invalid::${error.message}`;
  }
}

function evaluateCandidateStatus(candidate, taskProfile, constraints, request) {
  if (candidate.candidate_id === NO_LLM_CANDIDATE_ID) return 'ELIGIBLE_SIMULATION';

  const candidateValidation = validateModelSelectionCandidate(candidate);
  if (!candidateValidation.valid) return 'INELIGIBLE';

  if (candidate.tenant_id !== taskProfile.tenant_id) return 'TENANT_BLOCKED';
  if (candidate.organization_id !== taskProfile.organization_id) return 'ORGANIZATION_BLOCKED';

  const reference = request.candidate_model_references.find((item) => item.reference_id === candidate.candidate_id);
  if (!reference) return 'INELIGIBLE';
  if (reference.reference_version !== candidate.candidate_version) return 'VERSION_BLOCKED';
  if (reference.reference_fingerprint !== candidate.model_fingerprint) return 'VERSION_BLOCKED';

  if (candidate.local_reference === true && constraints.allow_local !== true) return 'POLICY_BLOCKED';
  if (candidate.local_reference !== true && constraints.allow_remote !== true) return 'POLICY_BLOCKED';
  if (candidate.zero_cost_reference === true && constraints.allow_zero_cost !== true) return 'POLICY_BLOCKED';

  const requiredCapabilities = Array.isArray(taskProfile.required_capabilities) ? taskProfile.required_capabilities : [];
  if (!requiredCapabilities.every((capability) => candidate.supported_capabilities.includes(capability))) return 'CAPABILITY_BLOCKED';
  const requiredModalities = Array.isArray(taskProfile.required_modalities) ? taskProfile.required_modalities : [];
  if (!requiredModalities.every((modality) => candidate.supported_modalities.includes(modality))) return 'CAPABILITY_BLOCKED';
  if (rankOf(QUALITY_TIER_RANK, candidate.quality_tier, -1) < rankOf(QUALITY_TIER_RANK, taskProfile.minimum_quality_tier, 0)) return 'CAPABILITY_BLOCKED';
  if (rankOf(QUALITY_TIER_RANK, candidate.quality_tier, -1) < rankOf(QUALITY_TIER_RANK, constraints.minimum_quality_tier, 0)) return 'CAPABILITY_BLOCKED';

  if (candidate.context_window_tokens < taskProfile.estimated_total_tokens) return 'CONTEXT_BLOCKED';
  if (candidate.maximum_input_tokens < taskProfile.estimated_input_tokens) return 'CONTEXT_BLOCKED';
  if (candidate.maximum_output_tokens < taskProfile.estimated_output_tokens) return 'CONTEXT_BLOCKED';

  if (candidate.privacy_tier === 'RESTRICTED_BLOCKED') return 'PRIVACY_BLOCKED';
  if (rankOf(PRIVACY_TIER_RANK, candidate.privacy_tier, -1) < rankOf(PRIVACY_TIER_RANK, constraints.required_privacy_tier, 0)) return 'PRIVACY_BLOCKED';

  if (candidate.availability_status === 'UNKNOWN_BLOCKED') return 'AVAILABILITY_BLOCKED';
  if (rankOf(AVAILABILITY_STATUS_RANK, candidate.availability_status, 99) > rankOf(AVAILABILITY_STATUS_RANK, constraints.required_availability_status, 99)) return 'AVAILABILITY_BLOCKED';

  if (candidate.health_status === 'UNKNOWN_BLOCKED') return 'HEALTH_BLOCKED';
  if (rankOf(HEALTH_STATUS_RANK, candidate.health_status, 99) > rankOf(HEALTH_STATUS_RANK, constraints.required_health_status, 99)) return 'HEALTH_BLOCKED';

  if (candidate.cost_tier === 'UNKNOWN_BLOCKED') return 'BUDGET_BLOCKED';
  if (candidate.estimated_cost_minor_units > constraints.maximum_cost_minor_units) return 'BUDGET_BLOCKED';

  if (rankOf(LATENCY_TIER_RANK, candidate.latency_tier, 99) > rankOf(LATENCY_TIER_RANK, constraints.maximum_latency_tier, 99)) return 'INELIGIBLE';
  if (rankOf(LATENCY_TIER_RANK, candidate.latency_tier, 99) > rankOf(LATENCY_TIER_RANK, taskProfile.maximum_latency_tier, 99)) return 'INELIGIBLE';

  return 'ELIGIBLE_SIMULATION';
}

function blockedResult(request, status, reasonCodes) {
  const taskProfile = isPlainObject(request) && isPlainObject(request.task_profile) ? request.task_profile : {};
  const decision = buildModelSelectionDecision({
    decision_id: isPlainObject(request) ? `decision_${request.selection_request_id || 'not_available'}` : 'decision_not_available',
    selection_request_id: isPlainObject(request) ? request.selection_request_id : undefined,
    agent_id: taskProfile.agent_id,
    tenant_id: taskProfile.tenant_id,
    organization_id: taskProfile.organization_id,
    status,
    selected_cost_tier: 'UNKNOWN_BLOCKED',
    request_fingerprint: isPlainObject(request) ? safeFingerprint(request) : NOT_AVAILABLE_FINGERPRINT,
    task_profile_fingerprint: safeFingerprint(taskProfile),
    constraints_fingerprint: isPlainObject(request) && isPlainObject(request.constraints) ? safeFingerprint(request.constraints) : NOT_AVAILABLE_FINGERPRINT,
    ranking_fingerprint: NOT_AVAILABLE_FINGERPRINT,
    selected_candidate_fingerprint: NOT_AVAILABLE_FINGERPRINT,
    registry_version: isPlainObject(request) ? request.expected_registry_version : undefined,
    blockers: reasonCodes,
    reason_codes: reasonCodes
  });
  return { decision, ranking: null, escalationPlan: null, candidates: [], scores: [] };
}

function evaluateModelSelectionRequest(request, context = {}) {
  const requestValidation = validateModelSelectionRequest(request);
  if (!requestValidation.valid) {
    return blockedResult(request, 'VALIDATION_FAILED', requestValidation.errors);
  }

  const taskProfile = request.task_profile;
  const constraints = request.constraints;

  if (request.policy_decision_reference.policy_status === 'DENY' || request.policy_decision_reference.allowed_in_simulation !== true) {
    return blockedResult(request, 'POLICY_BLOCKED', ['policy_denies_selection']);
  }
  if (taskProfile.risk_classification === 'RESTRICTED') {
    return blockedResult(request, 'RISK_BLOCKED', ['risk_classification_restricted_always_blocked']);
  }
  if (request.budget_reference.within_budget_reference !== true) {
    return blockedResult(request, 'BUDGET_BLOCKED', ['budget_reference_not_within_budget']);
  }
  if (
    taskProfile.estimated_input_tokens > constraints.maximum_input_tokens ||
    taskProfile.estimated_output_tokens > constraints.maximum_output_tokens ||
    taskProfile.estimated_total_tokens > constraints.maximum_total_tokens
  ) {
    return blockedResult(request, 'CONTEXT_BLOCKED', ['task_estimate_exceeds_constraint_ceiling']);
  }

  const injectedCandidates = Array.isArray(context.candidates) ? context.candidates : [];
  const candidatePool = [];
  if (isNoLlmEligible(taskProfile, constraints)) {
    candidatePool.push(buildNoLlmCandidate(taskProfile.tenant_id, taskProfile.organization_id));
  }
  for (const candidate of injectedCandidates.slice(0, constraints.maximum_candidates)) {
    candidatePool.push(candidate);
  }

  const resolvedCandidates = candidatePool.map((candidate) => ({
    ...candidate,
    candidate_status: evaluateCandidateStatus(candidate, taskProfile, constraints, request)
  }));
  const scores = resolvedCandidates.map((candidate) => computeModelSelectionScore(candidate, taskProfile, constraints));

  const rankingId = context.ranking_id || `ranking_${request.selection_request_id}`;
  const ranking = buildModelSelectionRanking(rankingId, request.selection_request_id, resolvedCandidates, constraints);

  const escalationPlanId = context.escalation_plan_id || `escalation_plan_${request.selection_request_id}`;
  const escalationPlan = buildModelSelectionEscalationPlan(escalationPlanId, request.selection_request_id, ranking, constraints, taskProfile.human_review_required);

  let status;
  let selectedCandidate = null;
  if (ranking.primary_candidate_id === NO_ELIGIBLE_CANDIDATE_SENTINEL) {
    status = 'NO_ELIGIBLE_CANDIDATE';
  } else if (ranking.primary_candidate_id === NO_LLM_CANDIDATE_ID) {
    status = 'NO_LLM_SELECTED_SIMULATION';
    selectedCandidate = resolvedCandidates.find((candidate) => candidate.candidate_id === NO_LLM_CANDIDATE_ID) || null;
  } else {
    status = 'MODEL_SELECTED_SIMULATION';
    selectedCandidate = resolvedCandidates.find((candidate) => candidate.candidate_id === ranking.primary_candidate_id) || null;
  }

  const decision = buildModelSelectionDecision({
    decision_id: context.decision_id || `decision_${request.selection_request_id}`,
    selection_request_id: request.selection_request_id,
    agent_id: taskProfile.agent_id,
    tenant_id: taskProfile.tenant_id,
    organization_id: taskProfile.organization_id,
    status,
    selected_candidate_id: ranking.primary_candidate_id,
    selected_provider_id: selectedCandidate ? selectedCandidate.provider_id : null,
    selected_model_id: selectedCandidate ? selectedCandidate.model_id : null,
    selected_cost_tier: selectedCandidate ? selectedCandidate.cost_tier : 'UNKNOWN_BLOCKED',
    estimated_cost_minor_units: selectedCandidate ? selectedCandidate.estimated_cost_minor_units : 0,
    fallback_plan_present: escalationPlan.fallback_candidate_ids.length > 0,
    escalation_plan_present: escalationPlan.escalation_candidate_ids.length > 0,
    candidate_count: resolvedCandidates.length,
    eligible_candidate_count: ranking.eligible_candidate_ids.length,
    ineligible_candidate_count: ranking.ineligible_candidate_ids.length,
    request_fingerprint: safeFingerprint(request),
    task_profile_fingerprint: safeFingerprint(taskProfile),
    constraints_fingerprint: safeFingerprint(constraints),
    ranking_fingerprint: ranking.ranking_fingerprint,
    selected_candidate_fingerprint: selectedCandidate ? safeFingerprint(selectedCandidate) : NOT_AVAILABLE_FINGERPRINT,
    registry_version: request.expected_registry_version,
    blockers: status === 'NO_ELIGIBLE_CANDIDATE' ? ['no_eligible_candidate_found'] : [],
    reason_codes: [status === 'NO_ELIGIBLE_CANDIDATE' ? 'no_eligible_candidate_found' : 'model_selection_reviewed_simulation_only']
  });

  return { decision, ranking, escalationPlan, candidates: resolvedCandidates, scores };
}

module.exports = {
  evaluateCandidateStatus,
  evaluateModelSelectionRequest
};
