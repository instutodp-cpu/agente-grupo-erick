'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { OVERFLOW_STRATEGIES } = require('./memory-selection-budget');

const MEMORY_SELECTION_PLAN_VALIDATOR_VERSION = 'memory_selection_plan_validator_v1';

const MEMORY_SELECTION_PLAN_FIELDS = Object.freeze([
  'plan_id', 'selection_request_id', 'tenant_id', 'organization_id', 'project_id',
  'included_required_reference_ids', 'included_relevant_reference_ids', 'included_optional_reference_ids',
  'included_preference_reference_ids', 'included_continuity_reference_ids', 'excluded_superseded_reference_ids',
  'excluded_duplicate_reference_ids', 'excluded_optional_reference_ids', 'excluded_relevant_reference_ids',
  'blocked_conflict_reference_ids', 'ordered_reference_ids', 'total_estimated_tokens', 'allocated_tokens',
  'reserved_output_tokens', 'remaining_tokens', 'overflow_detected', 'overflow_strategy',
  'required_memory_preserved', 'preferences_preserved', 'project_state_preserved', 'continuity_preserved',
  'pending_tasks_preserved', 'applicable_decisions_preserved', 'plan_generated', 'selection_executed',
  'plan_fingerprint', 'validator_version'
]);

const PLAN_REFERENCE_LIST_FIELDS = Object.freeze([
  'included_required_reference_ids', 'included_relevant_reference_ids', 'included_optional_reference_ids',
  'included_preference_reference_ids', 'included_continuity_reference_ids', 'excluded_superseded_reference_ids',
  'excluded_duplicate_reference_ids', 'excluded_optional_reference_ids', 'excluded_relevant_reference_ids',
  'blocked_conflict_reference_ids', 'ordered_reference_ids'
]);

const PLAN_PRESERVATION_FLAG_FIELDS = Object.freeze([
  'required_memory_preserved', 'preferences_preserved', 'project_state_preserved', 'continuity_preserved',
  'pending_tasks_preserved', 'applicable_decisions_preserved'
]);

const MAX_LIST_ITEMS = 2000;
const MAX_TOKEN_BOUND = 1000000000;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateSelectionPlan(plan) {
  const errors = [];
  if (!isPlainObject(plan)) return { valid: false, errors: ['selection_plan_must_be_object'] };
  exactFields(plan, MEMORY_SELECTION_PLAN_FIELDS, 'selection_plan', errors);
  for (const field of ['plan_id', 'selection_request_id', 'tenant_id', 'organization_id', 'project_id', 'plan_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(plan[field])) errors.push(`${field}_invalid`);
  }
  for (const field of PLAN_REFERENCE_LIST_FIELDS) {
    if (!isOrderedUniqueStringList(plan[field])) errors.push(`${field}_invalid`);
  }
  for (const field of ['total_estimated_tokens', 'allocated_tokens', 'reserved_output_tokens', 'remaining_tokens']) {
    if (!Number.isInteger(plan[field]) || plan[field] < 0 || plan[field] > MAX_TOKEN_BOUND) errors.push(`${field}_invalid`);
  }
  if (typeof plan.overflow_detected !== 'boolean') errors.push('overflow_detected_must_be_boolean');
  if (!OVERFLOW_STRATEGIES.includes(plan.overflow_strategy)) errors.push(`overflow_strategy_not_allowed::${plan.overflow_strategy}`);
  for (const field of PLAN_PRESERVATION_FLAG_FIELDS) {
    if (typeof plan[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (plan.plan_generated !== true) errors.push('plan_generated_must_be_true');
  if (plan.selection_executed !== false) errors.push('selection_executed_must_be_false');

  if (Array.isArray(plan.ordered_reference_ids) && PLAN_REFERENCE_LIST_FIELDS.every((field) => Array.isArray(plan[field]))) {
    const includedUnion = new Set([
      ...plan.included_required_reference_ids, ...plan.included_relevant_reference_ids,
      ...plan.included_optional_reference_ids, ...plan.included_preference_reference_ids,
      ...plan.included_continuity_reference_ids
    ]);
    const orderedSet = new Set(plan.ordered_reference_ids);
    if (includedUnion.size !== orderedSet.size || [...includedUnion].some((id) => !orderedSet.has(id))) {
      errors.push('ordered_reference_ids_does_not_match_included_union');
    }
  }

  if (plan.validator_version !== MEMORY_SELECTION_PLAN_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(plan);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(plan));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildSelectionPlan(input = {}) {
  // Identity fields are pulled directly from input (no defensive defaulting): this plan is
  // always constructed by the memory selection engine after upstream validation has already
  // passed, so a missing/malformed identity field here indicates an engine bug and should
  // fail loudly via the throw below, matching the orchestrator-plan.js precedent (PR #92).
  const includedRequired = uniqueSorted(input.includedRequiredReferenceIds || []);
  const includedRelevant = uniqueSorted(input.includedRelevantReferenceIds || []);
  const includedOptional = uniqueSorted(input.includedOptionalReferenceIds || []);
  const includedPreference = uniqueSorted(input.includedPreferenceReferenceIds || []);
  const includedContinuity = uniqueSorted(input.includedContinuityReferenceIds || []);
  const orderedReferenceIds = uniqueSorted([
    ...includedRequired, ...includedRelevant, ...includedOptional, ...includedPreference, ...includedContinuity
  ]);

  const plan = {
    plan_id: input.planId,
    selection_request_id: input.selectionRequestId,
    tenant_id: input.tenantId,
    organization_id: input.organizationId,
    project_id: input.projectId,
    included_required_reference_ids: includedRequired,
    included_relevant_reference_ids: includedRelevant,
    included_optional_reference_ids: includedOptional,
    included_preference_reference_ids: includedPreference,
    included_continuity_reference_ids: includedContinuity,
    excluded_superseded_reference_ids: uniqueSorted(input.excludedSupersededReferenceIds || []),
    excluded_duplicate_reference_ids: uniqueSorted(input.excludedDuplicateReferenceIds || []),
    excluded_optional_reference_ids: uniqueSorted(input.excludedOptionalReferenceIds || []),
    excluded_relevant_reference_ids: uniqueSorted(input.excludedRelevantReferenceIds || []),
    blocked_conflict_reference_ids: uniqueSorted(input.blockedConflictReferenceIds || []),
    ordered_reference_ids: orderedReferenceIds,
    total_estimated_tokens: Number.isInteger(input.totalEstimatedTokens) ? input.totalEstimatedTokens : 0,
    allocated_tokens: Number.isInteger(input.allocatedTokens) ? input.allocatedTokens : 0,
    reserved_output_tokens: Number.isInteger(input.reservedOutputTokens) ? input.reservedOutputTokens : 0,
    remaining_tokens: Number.isInteger(input.remainingTokens) ? Math.max(0, input.remainingTokens) : 0,
    overflow_detected: input.overflowDetected === true,
    overflow_strategy: OVERFLOW_STRATEGIES.includes(input.overflowStrategy) ? input.overflowStrategy : 'BLOCK',
    required_memory_preserved: input.requiredMemoryPreserved === true,
    preferences_preserved: input.preferencesPreserved === true,
    project_state_preserved: input.projectStatePreserved === true,
    continuity_preserved: input.continuityPreserved === true,
    pending_tasks_preserved: input.pendingTasksPreserved === true,
    applicable_decisions_preserved: input.applicableDecisionsPreserved === true,
    plan_generated: true,
    selection_executed: false,
    validator_version: MEMORY_SELECTION_PLAN_VALIDATOR_VERSION
  };
  plan.plan_fingerprint = stablePayload({
    selection_request_id: plan.selection_request_id,
    ordered_reference_ids: plan.ordered_reference_ids,
    blocked_conflict_reference_ids: plan.blocked_conflict_reference_ids,
    overflow_strategy: plan.overflow_strategy,
    total_estimated_tokens: plan.total_estimated_tokens,
    allocated_tokens: plan.allocated_tokens
  });

  const validation = validateSelectionPlan(plan);
  if (!validation.valid) {
    throw new Error(`memory_selection_plan_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(plan);
}

module.exports = {
  MAX_LIST_ITEMS,
  MAX_TOKEN_BOUND,
  MEMORY_SELECTION_PLAN_FIELDS,
  MEMORY_SELECTION_PLAN_VALIDATOR_VERSION,
  PLAN_PRESERVATION_FLAG_FIELDS,
  PLAN_REFERENCE_LIST_FIELDS,
  buildSelectionPlan,
  isOrderedUniqueStringList,
  validateSelectionPlan
};
