'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { RUNTIME_EXECUTION_SIMULATION_STATUSES, RUNTIME_DECISIONS, RUNTIME_NEXT_STATES } = require('./runtime-execution-simulation-decision');

const RUNTIME_EXECUTION_SIMULATION_AUDIT_VALIDATOR_VERSION = 'runtime_execution_simulation_audit_validator_v1';
const NOT_AVAILABLE_FINGERPRINT = 'fingerprint_not_available';
const NOT_AVAILABLE_LABEL = 'not_available';

const RUNTIME_EXECUTION_SIMULATION_AUDIT_FIELDS = Object.freeze([
  'audit_id', 'runtime_request_id', 'runtime_decision_id', 'runtime_result_id', 'runtime_execution_package_id',
  'execution_plan_id', 'fingerprints', 'package_digest', 'tenant_binding', 'organization_binding', 'project_binding',
  'session_binding', 'agent_binding', 'actor_binding', 'stage_counts', 'dependency_counts', 'budget_estimates',
  'stop_counts', 'compensation_counts', 'artifact_counts', 'event_counts', 'status', 'decision', 'next_state',
  'blockers', 'reason_codes', 'logical_sequence', 'simulation', 'production_blocked', 'executed', 'validator_version'
]);

// Never registers a payload, StageRecords, content, prompts, memory, messages, tool parameters,
// responses, secrets, tokens, endpoints, code, or provider output -- only ids, fingerprints,
// digest, status/decision/next_state, tenant/organization/project/session/agent/actor bindings,
// and counts/estimates.
// Bare 'runtime_request'/'runtime_decision'/etc would trip the forbidden-key scanner's segment
// check (only full compound names are allowlisted, never the bare 'runtime' segment) -- these use
// the exact same field names runtime-execution-simulation-decision.js already carries (each
// ending in _fingerprint), all already allowlisted, instead of a shorter nested-object key that no
// allowlist entry matches.
const FINGERPRINT_KEYS = Object.freeze([
  'runtime_request_fingerprint', 'runtime_decision_fingerprint', 'runtime_package_fingerprint',
  'gateway_decision_fingerprint', 'gateway_result_fingerprint', 'execution_plan_fingerprint',
  'runtime_stage_manifest_fingerprint', 'runtime_dependency_manifest_fingerprint', 'runtime_budget_fingerprint',
  'runtime_artifact_plan_fingerprint', 'runtime_event_plan_fingerprint'
]);
const STAGE_COUNT_KEYS = Object.freeze(['runtime_stage_count', 'model_stage_count', 'tool_stage_count', 'workflow_stage_count']);
const DEPENDENCY_COUNT_KEYS = Object.freeze(['runtime_dependency_count', 'cycle_free_count', 'blocked_dependency_count']);
const BUDGET_ESTIMATE_KEYS = Object.freeze(['estimated_input_tokens', 'estimated_output_tokens', 'estimated_total_tokens', 'estimated_total_cost_minor_units']);
const STOP_COUNT_KEYS = Object.freeze(['runtime_stop_count']);
const COMPENSATION_COUNT_KEYS = Object.freeze(['runtime_compensation_count']);
const ARTIFACT_COUNT_KEYS = Object.freeze(['planned_artifact_count']);
const EVENT_COUNT_KEYS = Object.freeze(['planned_event_count']);

const MAX_LIST_ITEMS = 50;

function isSanitizedList(list, maxItems = MAX_LIST_ITEMS) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString);
}

function validateCountObject(value, keys, label, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${label}_must_be_object`);
    return;
  }
  for (const key of keys) {
    if (!Number.isInteger(value[key]) || value[key] < 0) errors.push(`${label}_${key}_invalid`);
  }
}

function validateRuntimeExecutionSimulationAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['runtime_execution_simulation_audit_must_be_object'] };
  exactFields(audit, RUNTIME_EXECUTION_SIMULATION_AUDIT_FIELDS, 'runtime_execution_simulation_audit', errors);
  for (const field of [
    'audit_id', 'runtime_request_id', 'runtime_decision_id', 'runtime_result_id', 'runtime_execution_package_id',
    'execution_plan_id', 'package_digest', 'status', 'decision', 'next_state', 'validator_version'
  ]) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  if (!RUNTIME_EXECUTION_SIMULATION_STATUSES.includes(audit.status)) errors.push('status_invalid');
  if (!RUNTIME_DECISIONS.includes(audit.decision)) errors.push('decision_invalid');
  if (!RUNTIME_NEXT_STATES.includes(audit.next_state)) errors.push('next_state_invalid');

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
  if (!isPlainObject(audit.actor_binding) || !isNonEmptyString(audit.actor_binding.actor_id)) errors.push('actor_binding_invalid');

  validateCountObject(audit.stage_counts, STAGE_COUNT_KEYS, 'stage_counts', errors);
  validateCountObject(audit.dependency_counts, DEPENDENCY_COUNT_KEYS, 'dependency_counts', errors);
  validateCountObject(audit.budget_estimates, BUDGET_ESTIMATE_KEYS, 'budget_estimates', errors);
  validateCountObject(audit.stop_counts, STOP_COUNT_KEYS, 'stop_counts', errors);
  validateCountObject(audit.compensation_counts, COMPENSATION_COUNT_KEYS, 'compensation_counts', errors);
  validateCountObject(audit.artifact_counts, ARTIFACT_COUNT_KEYS, 'artifact_counts', errors);
  validateCountObject(audit.event_counts, EVENT_COUNT_KEYS, 'event_counts', errors);

  if (!isSanitizedList(audit.blockers)) errors.push('blockers_invalid');
  if (!isSanitizedList(audit.reason_codes)) errors.push('reason_codes_invalid');
  if (!Number.isInteger(audit.logical_sequence) || audit.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  if (audit.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (audit.executed !== false) errors.push('executed_must_be_false');
  if (audit.validator_version !== RUNTIME_EXECUTION_SIMULATION_AUDIT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(audit));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeExecutionSimulationAudit(input = {}) {
  const decision = isPlainObject(input.decision) ? input.decision : {};
  const result = isPlainObject(input.result) ? input.result : {};

  const audit = {
    audit_id: `runtime_execution_simulation_audit_${result.runtime_result_id || decision.runtime_decision_id || NOT_AVAILABLE_LABEL}`,
    runtime_request_id: decision.runtime_request_id || NOT_AVAILABLE_LABEL,
    runtime_decision_id: decision.runtime_decision_id || NOT_AVAILABLE_LABEL,
    runtime_result_id: result.runtime_result_id || NOT_AVAILABLE_LABEL,
    runtime_execution_package_id: decision.runtime_execution_package_id || NOT_AVAILABLE_LABEL,
    execution_plan_id: decision.execution_plan_id || NOT_AVAILABLE_LABEL,
    fingerprints: {
      runtime_request_fingerprint: decision.runtime_request_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      runtime_decision_fingerprint: input.runtimeDecisionFingerprint || NOT_AVAILABLE_FINGERPRINT,
      runtime_package_fingerprint: decision.runtime_package_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      gateway_decision_fingerprint: decision.gateway_decision_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      gateway_result_fingerprint: decision.gateway_result_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      execution_plan_fingerprint: decision.execution_plan_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      runtime_stage_manifest_fingerprint: decision.runtime_stage_manifest_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      runtime_dependency_manifest_fingerprint: decision.runtime_dependency_manifest_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      runtime_budget_fingerprint: decision.runtime_budget_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      runtime_artifact_plan_fingerprint: decision.runtime_artifact_plan_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      runtime_event_plan_fingerprint: decision.runtime_event_plan_fingerprint || NOT_AVAILABLE_FINGERPRINT
    },
    package_digest: decision.runtime_package_digest || NOT_AVAILABLE_FINGERPRINT,
    tenant_binding: { tenant_id: decision.tenant_id || 'tenant_not_available' },
    organization_binding: { organization_id: decision.organization_id || 'organization_not_available' },
    project_binding: { project_id: decision.project_id || 'project_not_available' },
    session_binding: { session_reference_id: decision.session_reference_id || 'session_not_available' },
    agent_binding: { agent_id: decision.agent_id || 'agent_not_available' },
    actor_binding: { actor_id: decision.actor_id || 'actor_not_available' },
    stage_counts: {
      runtime_stage_count: Number.isInteger(input.runtimeStageCount) ? input.runtimeStageCount : 0,
      model_stage_count: Number.isInteger(input.modelStageCount) ? input.modelStageCount : 0,
      tool_stage_count: Number.isInteger(input.toolStageCount) ? input.toolStageCount : 0,
      workflow_stage_count: Number.isInteger(input.workflowStageCount) ? input.workflowStageCount : 0
    },
    dependency_counts: {
      runtime_dependency_count: Number.isInteger(input.runtimeDependencyCount) ? input.runtimeDependencyCount : 0,
      cycle_free_count: Number.isInteger(input.cycleFreeCount) ? input.cycleFreeCount : 0,
      blocked_dependency_count: Number.isInteger(input.blockedDependencyCount) ? input.blockedDependencyCount : 0
    },
    budget_estimates: {
      estimated_input_tokens: Number.isInteger(input.estimatedInputTokens) ? input.estimatedInputTokens : 0,
      estimated_output_tokens: Number.isInteger(input.estimatedOutputTokens) ? input.estimatedOutputTokens : 0,
      estimated_total_tokens: Number.isInteger(input.estimatedTotalTokens) ? input.estimatedTotalTokens : 0,
      estimated_total_cost_minor_units: Number.isInteger(input.estimatedTotalCostMinorUnits) ? input.estimatedTotalCostMinorUnits : 0
    },
    stop_counts: { runtime_stop_count: Number.isInteger(input.runtimeStopCount) ? input.runtimeStopCount : 0 },
    compensation_counts: { runtime_compensation_count: Number.isInteger(input.runtimeCompensationCount) ? input.runtimeCompensationCount : 0 },
    artifact_counts: { planned_artifact_count: Number.isInteger(input.plannedArtifactCount) ? input.plannedArtifactCount : 0 },
    event_counts: { planned_event_count: Number.isInteger(input.plannedEventCount) ? input.plannedEventCount : 0 },
    status: decision.status || 'RUNTIME_VALIDATION_FAILED',
    decision: decision.decision || 'BLOCKED',
    next_state: decision.next_state || 'BLOCKED_REFERENCE',
    blockers: Array.isArray(decision.blockers) ? uniqueSorted(decision.blockers) : [],
    reason_codes: Array.isArray(decision.reason_codes) ? uniqueSorted(decision.reason_codes) : [],
    logical_sequence: Number.isInteger(input.logicalSequence) ? input.logicalSequence : 0,
    simulation: true,
    production_blocked: true,
    executed: false,
    validator_version: RUNTIME_EXECUTION_SIMULATION_AUDIT_VALIDATOR_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  ARTIFACT_COUNT_KEYS,
  BUDGET_ESTIMATE_KEYS,
  COMPENSATION_COUNT_KEYS,
  DEPENDENCY_COUNT_KEYS,
  EVENT_COUNT_KEYS,
  FINGERPRINT_KEYS,
  MAX_LIST_ITEMS,
  NOT_AVAILABLE_FINGERPRINT,
  NOT_AVAILABLE_LABEL,
  RUNTIME_EXECUTION_SIMULATION_AUDIT_FIELDS,
  RUNTIME_EXECUTION_SIMULATION_AUDIT_VALIDATOR_VERSION,
  STAGE_COUNT_KEYS,
  STOP_COUNT_KEYS,
  buildRuntimeExecutionSimulationAudit,
  validateRuntimeExecutionSimulationAudit
};
