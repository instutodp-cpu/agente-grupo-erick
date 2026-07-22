'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { OVERFLOW_STRATEGIES } = require('./context-assembly-budget');
const { SECTION_TYPES } = require('./context-assembly-section');

const CONTEXT_ASSEMBLY_PLAN_VALIDATOR_VERSION = 'context_assembly_plan_validator_v1';
const CONTEXT_ASSEMBLY_PLAN_FIELDS = Object.freeze([
  'plan_id', 'assembly_request_id', 'tenant_id', 'organization_id', 'ordered_section_ids', 'included_section_ids',
  'trimmed_section_ids', 'excluded_section_ids', 'included_source_reference_ids', 'excluded_source_reference_ids',
  'deduplicated_source_reference_ids', 'total_estimated_tokens', 'total_allocated_tokens', 'reserved_output_tokens',
  'remaining_context_tokens', 'overflow_detected', 'overflow_strategy', 'plan_generated', 'assembly_executed',
  'plan_fingerprint', 'validator_version'
]);
const SECTION_TYPE_RANK = Object.freeze(SECTION_TYPES.reduce((acc, type, index) => ({ ...acc, [type]: index }), {}));
const MAX_TOKENS_REFERENCE = 100000000;
const MAX_ID_LIST = 500;

function isUniqueStringList(list, maxItems = MAX_ID_LIST) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  return new Set(list).size === list.length;
}

function rankOf(map, key, fallback) {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback;
}

function compareSections(a, b) {
  const requiredDiff = (b.required === true ? 1 : 0) - (a.required === true ? 1 : 0);
  if (requiredDiff !== 0) return requiredDiff;
  const priorityDiff = (b.priority || 0) - (a.priority || 0);
  if (priorityDiff !== 0) return priorityDiff;
  const typeDiff = rankOf(SECTION_TYPE_RANK, a.section_type, 99) - rankOf(SECTION_TYPE_RANK, b.section_type, 99);
  if (typeDiff !== 0) return typeDiff;
  if (a.section_id < b.section_id) return -1;
  if (a.section_id > b.section_id) return 1;
  return 0;
}

// Deduplicates a list of eligible source references by source_fingerprint. Sources sharing a
// fingerprint are collapsed to the highest-priority one (canonical source_reference_id as the
// tie-break). Two or more required=true sources that share content_reference_id but declare
// different source_fingerprint values are an irreconcilable conflict and must block the whole
// assembly rather than silently picking one.
function deduplicateSourceReferences(sources, { deduplicate = true } = {}) {
  if (!Array.isArray(sources)) {
    return { kept: [], excludedIds: [], deduplicatedIds: [], conflict: false, conflictReferenceId: null };
  }

  const requiredByContentReference = new Map();
  for (const source of sources) {
    if (!isPlainObject(source) || source.required !== true || !isNonEmptyString(source.content_reference_id)) continue;
    const existing = requiredByContentReference.get(source.content_reference_id);
    if (existing && existing.source_fingerprint !== source.source_fingerprint) {
      return {
        kept: [], excludedIds: [], deduplicatedIds: [], conflict: true, conflictReferenceId: source.content_reference_id
      };
    }
    requiredByContentReference.set(source.content_reference_id, source);
  }

  if (!deduplicate) {
    return { kept: sources, excludedIds: [], deduplicatedIds: [], conflict: false, conflictReferenceId: null };
  }

  const groups = new Map();
  for (const source of sources) {
    if (!isPlainObject(source)) continue;
    const key = source.source_fingerprint;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(source);
  }

  const kept = [];
  const excludedIds = [];
  const deduplicatedIds = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      kept.push(group[0]);
      continue;
    }
    const sorted = [...group].sort((a, b) => {
      const priorityDiff = (b.priority || 0) - (a.priority || 0);
      if (priorityDiff !== 0) return priorityDiff;
      if (a.source_reference_id < b.source_reference_id) return -1;
      if (a.source_reference_id > b.source_reference_id) return 1;
      return 0;
    });
    kept.push(sorted[0]);
    for (const dropped of sorted.slice(1)) {
      excludedIds.push(dropped.source_reference_id);
      deduplicatedIds.push(dropped.source_reference_id);
    }
  }

  return { kept, excludedIds: uniqueSorted(excludedIds), deduplicatedIds: uniqueSorted(deduplicatedIds), conflict: false, conflictReferenceId: null };
}

function validateContextAssemblyPlan(plan) {
  const errors = [];
  if (!isPlainObject(plan)) return { valid: false, errors: ['plan_must_be_object'] };
  exactFields(plan, CONTEXT_ASSEMBLY_PLAN_FIELDS, 'plan', errors);
  for (const field of ['plan_id', 'assembly_request_id', 'tenant_id', 'organization_id', 'plan_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(plan[field])) errors.push(`${field}_invalid`);
  }
  for (const field of [
    'ordered_section_ids', 'included_section_ids', 'trimmed_section_ids', 'excluded_section_ids',
    'included_source_reference_ids', 'excluded_source_reference_ids', 'deduplicated_source_reference_ids'
  ]) {
    if (!isUniqueStringList(plan[field])) errors.push(`${field}_invalid`);
  }
  if (
    Array.isArray(plan.ordered_section_ids) && Array.isArray(plan.included_section_ids) &&
    Array.isArray(plan.trimmed_section_ids) && Array.isArray(plan.excluded_section_ids) &&
    plan.ordered_section_ids.length !== plan.included_section_ids.length + plan.trimmed_section_ids.length + plan.excluded_section_ids.length
  ) {
    errors.push('ordered_section_ids_count_mismatch');
  }
  for (const field of ['total_estimated_tokens', 'total_allocated_tokens', 'reserved_output_tokens']) {
    if (!Number.isInteger(plan[field]) || plan[field] < 0 || plan[field] > MAX_TOKENS_REFERENCE) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(plan.remaining_context_tokens) || plan.remaining_context_tokens < -MAX_TOKENS_REFERENCE || plan.remaining_context_tokens > MAX_TOKENS_REFERENCE) {
    errors.push('remaining_context_tokens_invalid');
  }
  if (typeof plan.overflow_detected !== 'boolean') errors.push('overflow_detected_must_be_boolean');
  if (!OVERFLOW_STRATEGIES.includes(plan.overflow_strategy)) errors.push(`overflow_strategy_not_allowed::${plan.overflow_strategy}`);
  if (plan.plan_generated !== true) errors.push('plan_generated_must_be_true');
  if (plan.assembly_executed !== false) errors.push('assembly_executed_must_be_false');
  if (plan.validator_version !== CONTEXT_ASSEMBLY_PLAN_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(plan);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(plan));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildContextAssemblyPlan(input) {
  const {
    planId, assemblyRequestId, tenantId, organizationId, sections, includedSourceIds, excludedSourceIds,
    deduplicatedSourceIds, reservedOutputTokens, overflowDetected, overflowStrategy
  } = input;
  const orderedSections = [...sections].sort(compareSections);
  const includedSectionIds = orderedSections.filter((section) => section.included).map((section) => section.section_id);
  const trimmedSectionIds = orderedSections.filter((section) => section.trimmed).map((section) => section.section_id);
  const excludedSectionIds = orderedSections.filter((section) => section.excluded).map((section) => section.section_id);
  const totalEstimatedTokens = orderedSections.reduce((sum, section) => sum + section.estimated_tokens, 0);
  const totalAllocatedTokens = orderedSections.reduce((sum, section) => sum + section.allocated_tokens, 0);

  const plan = {
    plan_id: planId,
    assembly_request_id: assemblyRequestId,
    tenant_id: tenantId,
    organization_id: organizationId,
    ordered_section_ids: orderedSections.map((section) => section.section_id),
    included_section_ids: includedSectionIds,
    trimmed_section_ids: trimmedSectionIds,
    excluded_section_ids: excludedSectionIds,
    included_source_reference_ids: uniqueSorted(includedSourceIds),
    excluded_source_reference_ids: uniqueSorted(excludedSourceIds),
    deduplicated_source_reference_ids: uniqueSorted(deduplicatedSourceIds),
    total_estimated_tokens: totalEstimatedTokens,
    total_allocated_tokens: totalAllocatedTokens,
    reserved_output_tokens: reservedOutputTokens,
    remaining_context_tokens: input.maximumTotalTokens - totalAllocatedTokens - reservedOutputTokens,
    overflow_detected: overflowDetected,
    overflow_strategy: overflowStrategy,
    plan_generated: true,
    assembly_executed: false,
    validator_version: CONTEXT_ASSEMBLY_PLAN_VALIDATOR_VERSION
  };
  plan.plan_fingerprint = stablePayload({
    ordered_section_ids: plan.ordered_section_ids,
    included_source_reference_ids: plan.included_source_reference_ids,
    excluded_source_reference_ids: plan.excluded_source_reference_ids,
    total_allocated_tokens: plan.total_allocated_tokens
  });
  const validation = validateContextAssemblyPlan(plan);
  if (!validation.valid) {
    throw new Error(`context_assembly_plan_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(plan);
}

module.exports = {
  CONTEXT_ASSEMBLY_PLAN_FIELDS,
  CONTEXT_ASSEMBLY_PLAN_VALIDATOR_VERSION,
  SECTION_TYPE_RANK,
  buildContextAssemblyPlan,
  compareSections,
  deduplicateSourceReferences,
  validateContextAssemblyPlan
};
