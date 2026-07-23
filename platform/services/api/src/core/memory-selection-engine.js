'use strict';

const { isNonEmptyString, isPlainObject } = require('./read-only-adapter-contract');
const { stablePayload } = require('./agent-identity-contract');
const { validateMemorySelectionRequest } = require('./memory-selection-request');
const { HIGH_OMISSION_RISKS, isExplicitPreference } = require('./memory-selection-item-reference');
const { computeSelectionScore } = require('./memory-selection-score');
const { buildSelectionPlan } = require('./memory-selection-plan');
const { NOT_AVAILABLE_FINGERPRINT, buildSelectionDecision } = require('./memory-selection-decision');
const { buildSelectionAudit } = require('./memory-selection-audit');

function safeFingerprint(value) {
  try {
    return stablePayload(value === undefined ? null : value);
  } catch (error) {
    return `fingerprint_invalid::${error.message}`;
  }
}

function sortById(items) {
  return [...items].sort((a, b) => (a.item_reference_id < b.item_reference_id ? -1 : a.item_reference_id > b.item_reference_id ? 1 : 0));
}

function countByClass(items) {
  const counts = { REQUIRED: 0, RELEVANT: 0, OPTIONAL: 0 };
  for (const item of items) counts[item.item_class] = (counts[item.item_class] || 0) + 1;
  return counts;
}

function omissionRiskCounts(items) {
  const counts = { LOW: 0, MODERATE: 0, HIGH: 0, CRITICAL: 0 };
  for (const item of items) counts[item.omission_risk] = (counts[item.omission_risk] || 0) + 1;
  return counts;
}

function buildBlockedOutcome(request, status, reasonCodes, extra = {}) {
  const requestSafe = isPlainObject(request) ? request : {};
  const decision = buildSelectionDecision({
    decision_id: `memory_selection_decision_${requestSafe.selection_request_id || 'not_available'}`,
    selection_request_id: requestSafe.selection_request_id,
    agent_id: requestSafe.agent_id,
    tenant_id: requestSafe.tenant_id,
    organization_id: requestSafe.organization_id,
    project_id: requestSafe.project_id,
    status,
    request_fingerprint: isPlainObject(request) ? safeFingerprint(request) : NOT_AVAILABLE_FINGERPRINT,
    policy_fingerprint: isPlainObject(requestSafe.selection_policy) ? safeFingerprint(requestSafe.selection_policy) : NOT_AVAILABLE_FINGERPRINT,
    budget_fingerprint: isPlainObject(requestSafe.selection_budget) ? safeFingerprint(requestSafe.selection_budget) : NOT_AVAILABLE_FINGERPRINT,
    blockers: reasonCodes,
    reason_codes: reasonCodes,
    ...extra
  });
  const audit = buildSelectionAudit({ decision, logicalSequence: Number.isInteger(requestSafe.logical_sequence) ? requestSafe.logical_sequence : 0 });
  return { decision, plan: null, scores: [], audit };
}

function checkBinding(item, request) {
  if (item.tenant_id !== request.tenant_id) return 'TENANT_BLOCKED';
  if (item.organization_id !== request.organization_id) return 'ORGANIZATION_BLOCKED';
  if (item.agent_id !== request.agent_id) return 'VALIDATION_FAILED';
  if (item.project_id !== request.project_id) return 'PROJECT_BLOCKED';
  if (item.scope_type === 'SESSION_REFERENCE' && item.session_reference_id !== request.session_reference_id) return 'SESSION_BLOCKED';
  return null;
}

function evaluateMemorySelectionRequest(request, context = {}) {
  const requestValidation = validateMemorySelectionRequest(request);
  if (!requestValidation.valid) {
    return buildBlockedOutcome(request, 'VALIDATION_FAILED', requestValidation.errors);
  }

  if (isNonEmptyString(context.currentRegistryVersion) && context.currentRegistryVersion !== request.expected_registry_version) {
    return buildBlockedOutcome(request, 'VERSION_BLOCKED', ['expected_registry_version_mismatch']);
  }

  const policy = request.selection_policy;
  const budget = request.selection_budget;
  const projectState = request.project_state_reference;

  const rawItems = [
    ...request.user_preference_references.map((item) => ({ ...item, __from: 'preference' })),
    ...request.memory_item_references.map((item) => ({ ...item, __from: 'memory' }))
  ];
  for (const item of rawItems) {
    const status = checkBinding(item, request);
    if (status) return buildBlockedOutcome(request, status, [`item_binding_mismatch::${item.item_reference_id}`]);
  }
  if (projectState.tenant_id !== request.tenant_id) return buildBlockedOutcome(request, 'TENANT_BLOCKED', ['project_state_tenant_mismatch']);
  if (projectState.organization_id !== request.organization_id) return buildBlockedOutcome(request, 'ORGANIZATION_BLOCKED', ['project_state_organization_mismatch']);
  if (projectState.project_id !== request.project_id) return buildBlockedOutcome(request, 'PROJECT_BLOCKED', ['project_state_project_mismatch']);
  for (const summary of request.continuity_summary_references) {
    if (summary.tenant_id !== request.tenant_id) return buildBlockedOutcome(request, 'TENANT_BLOCKED', [`continuity_tenant_mismatch::${summary.continuity_reference_id}`]);
    if (summary.organization_id !== request.organization_id) return buildBlockedOutcome(request, 'ORGANIZATION_BLOCKED', [`continuity_organization_mismatch::${summary.continuity_reference_id}`]);
    if (summary.project_id !== request.project_id) return buildBlockedOutcome(request, 'PROJECT_BLOCKED', [`continuity_project_mismatch::${summary.continuity_reference_id}`]);
  }

  // Step 8: exclude superseded (deterministic canonical order first, so exclusion never
  // depends on the order items arrived in the request).
  const sorted = sortById(rawItems);
  const excludedSupersededReferenceIds = sorted.filter((item) => item.superseded === true).map((item) => item.item_reference_id);
  const nonSuperseded = sorted.filter((item) => item.superseded !== true);

  // UNKNOWN_BLOCKED confidence must always block (never silently treated as absent evidence).
  const unknownConfidenceItems = nonSuperseded.filter((item) => item.confidence_level === 'UNKNOWN_BLOCKED');
  if (unknownConfidenceItems.length > 0) {
    return buildBlockedOutcome(
      request, 'VALIDATION_FAILED',
      unknownConfidenceItems.map((item) => `unknown_confidence_blocked::${item.item_reference_id}`)
    );
  }

  // Step 9: block unresolved conflicts.
  const unresolvedConflicts = nonSuperseded.filter((item) => item.conflicted === true && !isNonEmptyString(item.conflict_resolution_reference_id));
  if (unresolvedConflicts.length > 0) {
    return buildBlockedOutcome(
      request, 'CONFLICT_BLOCKED',
      unresolvedConflicts.map((item) => `unresolved_conflict::${item.item_reference_id}`)
    );
  }

  // Step 10: deduplicate by fingerprint (first occurrence in canonical order wins).
  const seenFingerprints = new Set();
  const excludedDuplicateReferenceIds = [];
  const deduped = [];
  for (const item of nonSuperseded) {
    if (seenFingerprints.has(item.item_fingerprint)) {
      excludedDuplicateReferenceIds.push(item.item_reference_id);
      continue;
    }
    seenFingerprints.add(item.item_fingerprint);
    deduped.push(item);
  }

  // Step 11: classify REQUIRED / RELEVANT / OPTIONAL (item_class already carries this).
  // Steps 12-15: preservation. An item is "protected" (never subject to budget/policy dropping)
  // when it is REQUIRED-class, or when it is an explicitly declared preference with EXPLICIT/
  // CONFIRMED confidence, regardless of its item_class. Project state and continuity summaries
  // are always protected by contract (required=true is enforced at validation time).
  const protectedItems = deduped.filter((item) => item.item_class === 'REQUIRED' || isExplicitPreference(item));
  const candidateItems = deduped.filter((item) => item.item_class !== 'REQUIRED' && !isExplicitPreference(item));

  const scores = new Map();
  for (const item of deduped) {
    const semanticRelevanceReference = isPlainObject(context.semanticRelevanceReferences)
      ? context.semanticRelevanceReferences[item.item_reference_id] : undefined;
    scores.set(item.item_reference_id, computeSelectionScore(item, request, { semanticRelevanceReference }));
  }

  const preferenceProtectedTokens = protectedItems
    .filter((item) => isExplicitPreference(item))
    .reduce((sum, item) => sum + item.estimated_tokens, 0);
  const requiredMemoryProtectedTokens = protectedItems
    .filter((item) => item.item_class === 'REQUIRED' && !isExplicitPreference(item))
    .reduce((sum, item) => sum + item.estimated_tokens, 0);
  const protectedReservationSum = budget.reserved_preference_tokens + budget.reserved_project_state_tokens +
    budget.reserved_continuity_tokens + budget.reserved_required_memory_tokens;
  const protectedActualSum = preferenceProtectedTokens + requiredMemoryProtectedTokens;

  if (protectedActualSum > protectedReservationSum) {
    return buildBlockedOutcome(request, 'REQUIRED_MEMORY_BLOCKED', ['required_memory_exceeds_protected_reservation']);
  }

  const protectedCount = 1 /* project_state_reference */ + request.continuity_summary_references.length + protectedItems.length;
  if (protectedCount > policy.maximum_references) {
    return buildBlockedOutcome(request, 'POLICY_BLOCKED', ['protected_reference_count_exceeds_maximum_references']);
  }

  const availableForCandidates = budget.maximum_total_tokens - budget.reserved_output_tokens - protectedActualSum;
  const availableReferenceSlots = policy.maximum_references - protectedCount;

  const relevantCandidates = candidateItems.filter((item) => item.item_class === 'RELEVANT');
  const optionalCandidates = candidateItems.filter((item) => item.item_class === 'OPTIONAL');
  const orderedCandidates = [...sortByScoreDesc(relevantCandidates, scores), ...sortByScoreDesc(optionalCandidates, scores)];

  let tokensUsed = 0;
  let relevantIncludedCount = 0;
  let optionalIncludedCount = 0;
  let totalIncludedCount = 0;
  const includedCandidateIds = [];
  const excludedOptionalReferenceIds = [];
  const excludedRelevantReferenceIds = [];
  let overflowDetected = false;
  const overflowReasonCodes = [];

  for (const item of orderedCandidates) {
    const classCount = item.item_class === 'RELEVANT' ? relevantIncludedCount : optionalIncludedCount;
    const classMax = item.item_class === 'RELEVANT' ? policy.maximum_relevant_references : policy.maximum_optional_references;
    const fits = tokensUsed + item.estimated_tokens <= availableForCandidates &&
      classCount < classMax && totalIncludedCount < availableReferenceSlots;

    if (fits) {
      includedCandidateIds.push(item.item_reference_id);
      tokensUsed += item.estimated_tokens;
      totalIncludedCount += 1;
      if (item.item_class === 'RELEVANT') relevantIncludedCount += 1;
      else optionalIncludedCount += 1;
      continue;
    }

    overflowDetected = true;
    if (HIGH_OMISSION_RISKS.includes(item.omission_risk)) {
      return buildBlockedOutcome(request, 'BUDGET_BLOCKED', [`high_omission_risk_cannot_be_dropped::${item.item_reference_id}`]);
    }

    if (item.item_class === 'OPTIONAL') {
      if (policy.allow_optional_omission !== true) {
        return buildBlockedOutcome(request, 'BUDGET_BLOCKED', [`optional_omission_not_allowed::${item.item_reference_id}`]);
      }
      excludedOptionalReferenceIds.push(item.item_reference_id);
      overflowReasonCodes.push('optional_reference_dropped_for_budget');
      continue;
    }

    if (budget.overflow_strategy === 'BLOCK' || budget.overflow_strategy === 'DROP_OPTIONAL') {
      return buildBlockedOutcome(request, 'BUDGET_BLOCKED', [`relevant_overflow_not_resolvable::${item.item_reference_id}`]);
    }
    if (policy.allow_relevant_omission !== true) {
      return buildBlockedOutcome(request, 'BUDGET_BLOCKED', [`relevant_omission_not_allowed::${item.item_reference_id}`]);
    }
    excludedRelevantReferenceIds.push(item.item_reference_id);
    if (budget.overflow_strategy === 'REQUIRE_HIERARCHICAL_SUMMARY') overflowReasonCodes.push('hierarchical_summary_required_declarative');
    else if (budget.overflow_strategy === 'REQUIRE_REASSEMBLY') overflowReasonCodes.push('reassembly_required_declarative');
    else overflowReasonCodes.push('relevant_reference_dropped_lowest_priority');
  }

  const relevantCandidateIds = new Set(relevantCandidates.map((item) => item.item_reference_id));
  const optionalCandidateIds = new Set(optionalCandidates.map((item) => item.item_reference_id));
  const includedRelevantReferenceIds = includedCandidateIds.filter((id) => relevantCandidateIds.has(id));
  const includedOptionalReferenceIds = includedCandidateIds.filter((id) => optionalCandidateIds.has(id));

  const includedRequiredReferenceIds = protectedItems.filter((item) => item.item_class === 'REQUIRED' && !isExplicitPreference(item)).map((item) => item.item_reference_id);
  const includedPreferenceReferenceIds = protectedItems.filter((item) => isExplicitPreference(item)).map((item) => item.item_reference_id);
  const includedContinuityReferenceIds = request.continuity_summary_references.map((summary) => summary.continuity_reference_id);

  const protectedTokens = protectedActualSum;
  const totalEstimatedTokens = protectedTokens + tokensUsed;
  const allocatedTokens = totalEstimatedTokens;
  const remainingTokens = Math.max(0, budget.maximum_total_tokens - allocatedTokens - budget.reserved_output_tokens);

  const plan = buildSelectionPlan({
    planId: `memory_selection_plan_${request.selection_request_id}`,
    selectionRequestId: request.selection_request_id,
    tenantId: request.tenant_id,
    organizationId: request.organization_id,
    projectId: request.project_id,
    includedRequiredReferenceIds,
    includedRelevantReferenceIds: includedRelevantReferenceIds,
    includedOptionalReferenceIds: includedOptionalReferenceIds,
    includedPreferenceReferenceIds,
    includedContinuityReferenceIds,
    excludedSupersededReferenceIds,
    excludedDuplicateReferenceIds,
    excludedOptionalReferenceIds,
    excludedRelevantReferenceIds,
    blockedConflictReferenceIds: [],
    totalEstimatedTokens,
    allocatedTokens,
    reservedOutputTokens: budget.reserved_output_tokens,
    remainingTokens,
    overflowDetected,
    overflowStrategy: budget.overflow_strategy,
    requiredMemoryPreserved: true,
    preferencesPreserved: true,
    projectStatePreserved: true,
    continuityPreserved: true,
    pendingTasksPreserved: true,
    applicableDecisionsPreserved: true
  });

  const includedReferenceCount = includedRequiredReferenceIds.length + includedRelevantReferenceIds.length +
    includedOptionalReferenceIds.length + includedPreferenceReferenceIds.length + includedContinuityReferenceIds.length;
  const excludedReferenceCount = excludedSupersededReferenceIds.length + excludedDuplicateReferenceIds.length +
    excludedOptionalReferenceIds.length + excludedRelevantReferenceIds.length;

  const decision = buildSelectionDecision({
    decision_id: `memory_selection_decision_${request.selection_request_id}`,
    selection_request_id: request.selection_request_id,
    agent_id: request.agent_id,
    tenant_id: request.tenant_id,
    organization_id: request.organization_id,
    project_id: request.project_id,
    status: 'SELECTION_PLANNED_SIMULATION',
    plan_fingerprint: plan.plan_fingerprint,
    request_fingerprint: safeFingerprint(request),
    policy_fingerprint: safeFingerprint(policy),
    budget_fingerprint: safeFingerprint(budget),
    included_reference_count: includedReferenceCount,
    excluded_reference_count: excludedReferenceCount,
    required_reference_count: includedRequiredReferenceIds.length,
    relevant_reference_count: includedRelevantReferenceIds.length,
    optional_reference_count: includedOptionalReferenceIds.length,
    request_validated: true,
    policy_validated: true,
    budget_validated: true,
    references_validated: true,
    conflicts_resolved: true,
    reason_codes: overflowReasonCodes.length > 0 ? overflowReasonCodes : ['memory_selection_planned_simulation_only']
  });

  const audit = buildSelectionAudit({
    decision,
    itemFingerprints: deduped.map((item) => item.item_fingerprint),
    scoreFingerprints: [...scores.values()].map((score) => safeFingerprint(score)),
    logicalSequence: request.logical_sequence,
    referenceCountsByClass: countByClass(deduped),
    omissionRiskSummary: omissionRiskCounts(deduped),
    exclusionReasonCodes: overflowReasonCodes
  });

  return { decision, plan, scores: [...scores.values()], audit };
}

function sortByScoreDesc(items, scores) {
  return [...items].sort((a, b) => {
    const scoreA = scores.get(a.item_reference_id).total_score;
    const scoreB = scores.get(b.item_reference_id).total_score;
    if (scoreA !== scoreB) return scoreB - scoreA;
    return a.item_reference_id < b.item_reference_id ? -1 : a.item_reference_id > b.item_reference_id ? 1 : 0;
  });
}

module.exports = {
  evaluateMemorySelectionRequest
};
