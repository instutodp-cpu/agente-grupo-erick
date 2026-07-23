'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');

const EXECUTION_PLAN_AUDIT_VALIDATOR_VERSION = 'execution_plan_audit_validator_v1';
const NOT_AVAILABLE_FINGERPRINT = 'fingerprint_not_available';
const NOT_AVAILABLE_LABEL = 'not_available';

const EXECUTION_PLAN_AUDIT_FIELDS = Object.freeze([
  'audit_id', 'execution_plan_request_id', 'execution_plan_id', 'dependency_graph_reference_id', 'fingerprints',
  'tenant_binding', 'organization_binding', 'project_binding', 'session_binding', 'agent_binding', 'task_binding',
  'counts', 'estimated_budget', 'side_effect_classifications', 'stop_condition_types', 'compensation_types',
  'dependency_graph_validated', 'status', 'decision', 'next_state', 'blockers', 'reason_codes', 'logical_sequence',
  'simulation', 'production_blocked', 'executed', 'validator_version'
]);

const FINGERPRINT_KEYS = Object.freeze([
  'request', 'authz', 'evidence_bundle', 'planning_result', 'orchestration_plan', 'task', 'dependency_graph',
  'execution_plan'
]);
const COUNT_KEYS = Object.freeze(['stage_count', 'dependency_count', 'binding_count', 'stop_condition_count', 'compensation_count']);
const BUDGET_KEYS = Object.freeze(['estimated_total_tokens', 'estimated_total_cost_minor_units']);

const MAX_LIST_ITEMS = 50;

function isSanitizedStringList(list, maxItems = MAX_LIST_ITEMS) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString);
}

function validateExecutionPlanAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['execution_plan_audit_must_be_object'] };
  exactFields(audit, EXECUTION_PLAN_AUDIT_FIELDS, 'execution_plan_audit', errors);
  for (const field of ['audit_id', 'execution_plan_request_id', 'execution_plan_id', 'dependency_graph_reference_id', 'status', 'decision', 'next_state', 'validator_version']) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  if (!isPlainObject(audit.fingerprints)) {
    errors.push('fingerprints_must_be_object');
  } else {
    for (const key of FINGERPRINT_KEYS) {
      if (!isNonEmptyString(audit.fingerprints[key])) errors.push(`fingerprints_${key}_invalid`);
    }
  }
  if (!isPlainObject(audit.tenant_binding) || !isNonEmptyString(audit.tenant_binding.tenant_id)) errors.push('tenant_binding_invalid');
  if (!isPlainObject(audit.organization_binding) || !isNonEmptyString(audit.organization_binding.organization_id)) errors.push('organization_binding_invalid');
  if (!isPlainObject(audit.project_binding) || !isNonEmptyString(audit.project_binding.project_id)) errors.push('project_binding_invalid');
  if (!isPlainObject(audit.session_binding) || !isNonEmptyString(audit.session_binding.session_reference_id)) errors.push('session_binding_invalid');
  if (!isPlainObject(audit.agent_binding) || !isNonEmptyString(audit.agent_binding.agent_id)) errors.push('agent_binding_invalid');
  if (!isPlainObject(audit.task_binding) || !isNonEmptyString(audit.task_binding.task_reference_id)) errors.push('task_binding_invalid');
  if (!isPlainObject(audit.counts)) {
    errors.push('counts_must_be_object');
  } else {
    for (const key of COUNT_KEYS) {
      if (!Number.isInteger(audit.counts[key]) || audit.counts[key] < 0) errors.push(`counts_${key}_invalid`);
    }
  }
  if (!isPlainObject(audit.estimated_budget)) {
    errors.push('estimated_budget_must_be_object');
  } else {
    for (const key of BUDGET_KEYS) {
      if (!Number.isInteger(audit.estimated_budget[key]) || audit.estimated_budget[key] < 0) errors.push(`estimated_budget_${key}_invalid`);
    }
  }
  if (!isSanitizedStringList(audit.side_effect_classifications)) errors.push('side_effect_classifications_invalid');
  if (!isSanitizedStringList(audit.stop_condition_types)) errors.push('stop_condition_types_invalid');
  if (!isSanitizedStringList(audit.compensation_types)) errors.push('compensation_types_invalid');
  if (!isSanitizedStringList(audit.blockers)) errors.push('blockers_invalid');
  if (!isSanitizedStringList(audit.reason_codes)) errors.push('reason_codes_invalid');
  if (!Number.isInteger(audit.logical_sequence) || audit.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (typeof audit.dependency_graph_validated !== 'boolean') errors.push('dependency_graph_validated_must_be_boolean');
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  if (audit.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (audit.executed !== false) errors.push('executed_must_be_false');
  if (audit.validator_version !== EXECUTION_PLAN_AUDIT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

// Records only fingerprints, ids, bindings, counts, estimated budget, and classification labels
// -- never stage content, prompts, messages, real memory, documents, tool parameters, model
// responses, secrets, endpoints, or a full payload.
function buildExecutionPlanAudit(input = {}) {
  const result = isPlainObject(input.result) ? input.result : {};
  const plan = isPlainObject(input.plan) ? input.plan : {};
  const stages = Array.isArray(input.stages) ? input.stages : [];
  const stopConditions = Array.isArray(input.stopConditions) ? input.stopConditions : [];
  const compensations = Array.isArray(input.compensations) ? input.compensations : [];

  const audit = {
    audit_id: `execution_plan_audit_${result.result_id || 'not_available'}`,
    execution_plan_request_id: result.execution_plan_request_id || NOT_AVAILABLE_LABEL,
    execution_plan_id: result.execution_plan_id || NOT_AVAILABLE_LABEL,
    dependency_graph_reference_id: input.dependencyGraphReferenceId || NOT_AVAILABLE_LABEL,
    fingerprints: {
      request: result.request_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      authz: result.authorization_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      evidence_bundle: result.evidence_bundle_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      planning_result: result.planning_result_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      orchestration_plan: result.orchestration_plan_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      task: result.task_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      dependency_graph: result.dependency_graph_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      execution_plan: result.execution_plan_fingerprint || NOT_AVAILABLE_FINGERPRINT
    },
    tenant_binding: { tenant_id: result.tenant_id || 'tenant_not_available' },
    organization_binding: { organization_id: result.organization_id || 'organization_not_available' },
    project_binding: { project_id: result.project_id || 'project_not_available' },
    session_binding: { session_reference_id: result.session_reference_id || 'session_not_available' },
    agent_binding: { agent_id: result.agent_id || 'agent_not_available' },
    task_binding: { task_reference_id: result.task_reference_id || 'task_reference_not_available' },
    counts: {
      stage_count: Number.isInteger(result.stage_count) ? result.stage_count : 0,
      dependency_count: Number.isInteger(result.dependency_count) ? result.dependency_count : 0,
      binding_count: Number.isInteger(result.binding_count) ? result.binding_count : 0,
      stop_condition_count: Number.isInteger(result.stop_condition_count) ? result.stop_condition_count : 0,
      compensation_count: Number.isInteger(result.compensation_count) ? result.compensation_count : 0
    },
    estimated_budget: {
      estimated_total_tokens: Number.isInteger(result.estimated_total_tokens) ? result.estimated_total_tokens : 0,
      estimated_total_cost_minor_units: Number.isInteger(result.estimated_total_cost_minor_units) ? result.estimated_total_cost_minor_units : 0
    },
    side_effect_classifications: uniqueSorted(stages.map((stage) => stage.side_effect_classification).filter(isNonEmptyString)),
    stop_condition_types: uniqueSorted(stopConditions.map((condition) => condition.condition_type).filter(isNonEmptyString)),
    compensation_types: uniqueSorted(compensations.map((compensation) => compensation.compensation_type).filter(isNonEmptyString)),
    status: result.status || 'VALIDATION_FAILED',
    decision: result.decision || 'BLOCKED',
    next_state: result.next_state || 'BLOCKED_REFERENCE',
    blockers: Array.isArray(result.blockers) ? uniqueSorted(result.blockers) : [],
    reason_codes: Array.isArray(input.reasonCodes) ? uniqueSorted(input.reasonCodes) : (Array.isArray(result.reason_codes) ? uniqueSorted(result.reason_codes) : []),
    logical_sequence: Number.isInteger(input.logicalSequence) ? input.logicalSequence : 0,
    dependency_graph_validated: result.dependency_graph_validated === true,
    simulation: true,
    production_blocked: true,
    executed: false,
    validator_version: EXECUTION_PLAN_AUDIT_VALIDATOR_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  BUDGET_KEYS,
  COUNT_KEYS,
  EXECUTION_PLAN_AUDIT_FIELDS,
  EXECUTION_PLAN_AUDIT_VALIDATOR_VERSION,
  FINGERPRINT_KEYS,
  MAX_LIST_ITEMS,
  NOT_AVAILABLE_FINGERPRINT,
  NOT_AVAILABLE_LABEL,
  buildExecutionPlanAudit,
  validateExecutionPlanAudit
};
