'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const ORCHESTRATOR_PLAN_VALIDATOR_VERSION = 'orchestrator_plan_validator_v1';
const ORCHESTRATOR_PLAN_FIELDS = Object.freeze([
  'plan_id', 'orchestrator_request_id', 'tenant_id', 'organization_id', 'agent_id', 'ordered_validation_codes',
  'ordered_decision_codes', 'ordered_reference_ids', 'ordered_blocker_codes', 'ordered_approval_codes',
  'execution_plan_reference_id', 'workflow_reference_id', 'tool_reference_ids', 'model_reference_id',
  'context_reference_id', 'plan_generated', 'plan_executed', 'plan_fingerprint', 'validator_version'
]);
const NOT_AVAILABLE_REFERENCE = 'reference_not_available';
const MAX_LIST_ITEMS = 500;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateOrchestratorPlan(plan) {
  const errors = [];
  if (!isPlainObject(plan)) return { valid: false, errors: ['plan_must_be_object'] };
  exactFields(plan, ORCHESTRATOR_PLAN_FIELDS, 'plan', errors);
  for (const field of [
    'plan_id', 'orchestrator_request_id', 'tenant_id', 'organization_id', 'agent_id', 'execution_plan_reference_id',
    'workflow_reference_id', 'context_reference_id', 'plan_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(plan[field])) errors.push(`${field}_invalid`);
  }
  if (plan.model_reference_id !== null && !isNonEmptyString(plan.model_reference_id)) {
    errors.push('model_reference_id_must_be_null_or_string');
  }
  for (const field of ['ordered_validation_codes', 'ordered_decision_codes', 'ordered_reference_ids', 'ordered_blocker_codes', 'ordered_approval_codes', 'tool_reference_ids']) {
    if (!isOrderedUniqueStringList(plan[field])) errors.push(`${field}_invalid`);
  }
  if (plan.plan_generated !== true) errors.push('plan_generated_must_be_true');
  if (plan.plan_executed !== false) errors.push('plan_executed_must_be_false');
  if (plan.validator_version !== ORCHESTRATOR_PLAN_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(plan);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(plan));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildOrchestratorPlan(input = {}) {
  // Identity fields are intentionally NOT defensively defaulted: a plan is always built after
  // its inputs have already passed upstream validation, so a missing/malformed identity field
  // here indicates a caller bug, not a legitimate blocked/simulation-only outcome. Letting
  // validateOrchestratorPlan (and the throw below) catch it matches PR #87's
  // buildContextAssemblyPlan. Reference fields below (workflow/tool/model/context) DO default
  // to an explicit "not available" sentinel, since those legitimately can be absent.
  const plan = {
    plan_id: input.planId,
    orchestrator_request_id: input.orchestratorRequestId,
    tenant_id: input.tenantId,
    organization_id: input.organizationId,
    agent_id: input.agentId,
    ordered_validation_codes: Array.isArray(input.validationCodes) ? uniqueSorted(input.validationCodes) : [],
    ordered_decision_codes: Array.isArray(input.decisionCodes) ? uniqueSorted(input.decisionCodes) : [],
    ordered_reference_ids: Array.isArray(input.referenceIds) ? uniqueSorted(input.referenceIds) : [],
    ordered_blocker_codes: Array.isArray(input.blockerCodes) ? uniqueSorted(input.blockerCodes) : [],
    ordered_approval_codes: Array.isArray(input.approvalCodes) ? uniqueSorted(input.approvalCodes) : [],
    execution_plan_reference_id: isNonEmptyString(input.executionPlanReferenceId) ? input.executionPlanReferenceId : NOT_AVAILABLE_REFERENCE,
    workflow_reference_id: isNonEmptyString(input.workflowReferenceId) ? input.workflowReferenceId : NOT_AVAILABLE_REFERENCE,
    tool_reference_ids: Array.isArray(input.toolReferenceIds) ? uniqueSorted(input.toolReferenceIds) : [],
    model_reference_id: isNonEmptyString(input.modelReferenceId) ? input.modelReferenceId : null,
    context_reference_id: isNonEmptyString(input.contextReferenceId) ? input.contextReferenceId : NOT_AVAILABLE_REFERENCE,
    plan_generated: true,
    plan_executed: false,
    validator_version: ORCHESTRATOR_PLAN_VALIDATOR_VERSION
  };
  plan.plan_fingerprint = stablePayload({
    orchestrator_request_id: plan.orchestrator_request_id,
    ordered_reference_ids: plan.ordered_reference_ids,
    ordered_decision_codes: plan.ordered_decision_codes,
    workflow_reference_id: plan.workflow_reference_id,
    tool_reference_ids: plan.tool_reference_ids,
    model_reference_id: plan.model_reference_id,
    context_reference_id: plan.context_reference_id
  });
  const validation = validateOrchestratorPlan(plan);
  if (!validation.valid) {
    throw new Error(`orchestrator_plan_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(plan);
}

module.exports = {
  MAX_LIST_ITEMS,
  NOT_AVAILABLE_REFERENCE,
  ORCHESTRATOR_PLAN_FIELDS,
  ORCHESTRATOR_PLAN_VALIDATOR_VERSION,
  buildOrchestratorPlan,
  isOrderedUniqueStringList,
  validateOrchestratorPlan
};
