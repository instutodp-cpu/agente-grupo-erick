'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const MODEL_SELECTION_ESCALATION_PLAN_VALIDATOR_VERSION = 'model_selection_escalation_plan_validator_v1';
const SELECTION_ESCALATION_PLAN_FIELDS = Object.freeze([
  'escalation_plan_id', 'selection_request_id', 'primary_candidate_id', 'fallback_candidate_ids',
  'escalation_candidate_ids', 'maximum_fallbacks', 'maximum_escalations', 'fallback_trigger_references',
  'escalation_trigger_references', 'human_review_required', 'plan_generated', 'fallback_executed',
  'escalation_executed', 'simulation', 'production_blocked', 'validator_version'
]);
const TRIGGER_REFERENCES = Object.freeze([
  'VALIDATION_FAILURE_REFERENCE', 'QUALITY_THRESHOLD_FAILURE_REFERENCE', 'STRUCTURED_OUTPUT_FAILURE_REFERENCE',
  'CAPABILITY_FAILURE_REFERENCE', 'TIMEOUT_REFERENCE', 'PROVIDER_UNAVAILABLE_REFERENCE', 'HEALTH_DEGRADED_REFERENCE',
  'CONTEXT_LIMIT_REFERENCE', 'HUMAN_REVIEW_REFERENCE'
]);
const MAX_FALLBACKS = 20;
const MAX_ESCALATIONS = 20;
const MAX_CANDIDATE_IDS = 20;

function isOrderedUniqueStringList(list, maxItems) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function isOrderedUniqueEnumList(list, allowedValues) {
  if (!Array.isArray(list) || list.length > allowedValues.length) return false;
  if (!list.every((item) => allowedValues.includes(item))) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateModelSelectionEscalationPlan(plan) {
  const errors = [];
  if (!isPlainObject(plan)) return { valid: false, errors: ['escalation_plan_must_be_object'] };
  exactFields(plan, SELECTION_ESCALATION_PLAN_FIELDS, 'escalation_plan', errors);
  for (const field of ['escalation_plan_id', 'selection_request_id', 'primary_candidate_id', 'validator_version']) {
    if (!isNonEmptyString(plan[field])) errors.push(`${field}_invalid`);
  }
  if (!isOrderedUniqueStringList(plan.fallback_candidate_ids, MAX_CANDIDATE_IDS)) errors.push('fallback_candidate_ids_invalid');
  if (!isOrderedUniqueStringList(plan.escalation_candidate_ids, MAX_CANDIDATE_IDS)) errors.push('escalation_candidate_ids_invalid');
  if (!Number.isInteger(plan.maximum_fallbacks) || plan.maximum_fallbacks < 0 || plan.maximum_fallbacks > MAX_FALLBACKS) errors.push('maximum_fallbacks_invalid');
  if (!Number.isInteger(plan.maximum_escalations) || plan.maximum_escalations < 0 || plan.maximum_escalations > MAX_ESCALATIONS) errors.push('maximum_escalations_invalid');
  if (!isOrderedUniqueEnumList(plan.fallback_trigger_references, TRIGGER_REFERENCES)) errors.push('fallback_trigger_references_invalid');
  if (!isOrderedUniqueEnumList(plan.escalation_trigger_references, TRIGGER_REFERENCES)) errors.push('escalation_trigger_references_invalid');
  if (typeof plan.human_review_required !== 'boolean') errors.push('human_review_required_must_be_boolean');
  if (plan.plan_generated !== true) errors.push('plan_generated_must_be_true');
  if (plan.fallback_executed !== false) errors.push('fallback_executed_must_be_false');
  if (plan.escalation_executed !== false) errors.push('escalation_executed_must_be_false');
  if (plan.simulation !== true) errors.push('simulation_must_be_true');
  if (plan.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (plan.validator_version !== MODEL_SELECTION_ESCALATION_PLAN_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(plan);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(plan));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildModelSelectionEscalationPlan(planId, selectionRequestId, ranking, constraints, humanReviewRequired) {
  if (!isNonEmptyString(planId) || !isNonEmptyString(selectionRequestId) || !isPlainObject(ranking) || !isPlainObject(constraints)) {
    throw new Error('build_model_selection_escalation_plan_requires_plan_id_selection_request_id_ranking_and_constraints');
  }
  const fallbackTriggers = constraints.allow_fallback === true && ranking.fallback_candidate_ids.length > 0
    ? ['VALIDATION_FAILURE_REFERENCE', 'PROVIDER_UNAVAILABLE_REFERENCE']
    : [];
  const escalationTriggers = constraints.allow_escalation === true && ranking.escalation_candidate_ids.length > 0
    ? ['QUALITY_THRESHOLD_FAILURE_REFERENCE', 'HEALTH_DEGRADED_REFERENCE']
    : [];
  if (humanReviewRequired === true && !escalationTriggers.includes('HUMAN_REVIEW_REFERENCE') && constraints.allow_escalation === true) {
    escalationTriggers.push('HUMAN_REVIEW_REFERENCE');
  }
  const plan = {
    escalation_plan_id: planId,
    selection_request_id: selectionRequestId,
    primary_candidate_id: ranking.primary_candidate_id,
    fallback_candidate_ids: constraints.allow_fallback === true ? uniqueSorted(ranking.fallback_candidate_ids) : [],
    escalation_candidate_ids: constraints.allow_escalation === true ? uniqueSorted(ranking.escalation_candidate_ids) : [],
    maximum_fallbacks: Number.isInteger(constraints.maximum_fallbacks) ? constraints.maximum_fallbacks : 0,
    maximum_escalations: Number.isInteger(constraints.maximum_escalations) ? constraints.maximum_escalations : 0,
    fallback_trigger_references: uniqueSorted(fallbackTriggers),
    escalation_trigger_references: uniqueSorted(escalationTriggers),
    human_review_required: humanReviewRequired === true,
    plan_generated: true,
    fallback_executed: false,
    escalation_executed: false,
    simulation: true,
    production_blocked: true,
    validator_version: MODEL_SELECTION_ESCALATION_PLAN_VALIDATOR_VERSION
  };
  const validation = validateModelSelectionEscalationPlan(plan);
  if (!validation.valid) {
    throw new Error(`model_selection_escalation_plan_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(plan);
}

module.exports = {
  MAX_ESCALATIONS,
  MAX_FALLBACKS,
  MODEL_SELECTION_ESCALATION_PLAN_VALIDATOR_VERSION,
  SELECTION_ESCALATION_PLAN_FIELDS,
  TRIGGER_REFERENCES,
  buildModelSelectionEscalationPlan,
  validateModelSelectionEscalationPlan
};
