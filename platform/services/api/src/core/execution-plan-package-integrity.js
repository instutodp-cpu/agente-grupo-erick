'use strict';

const { isPlainObject } = require('./read-only-adapter-contract');
const { stablePayload } = require('./agent-identity-contract');

const NOT_AVAILABLE_FINGERPRINT = 'fingerprint_not_available';
const NOT_AVAILABLE_LABEL = 'not_available';

const EXECUTION_PLAN_PACKAGE_FIELDS = Object.freeze([
  'execution_plan_id', 'execution_plan_version', 'authorization_decision_fingerprint',
  'orchestrator_decision_fingerprint', 'readiness_bundle_fingerprint', 'planning_result_fingerprint',
  'orchestration_plan_fingerprint', 'task_fingerprint', 'stage_manifest_reference_id', 'stage_manifest_fingerprint',
  'dependency_graph_fingerprint', 'budget_fingerprint', 'idempotency_fingerprint', 'memory_fingerprint',
  'context_fingerprint', 'model_fingerprint', 'tool_fingerprints', 'workflow_fingerprint', 'ordered_stage_ids',
  'stage_fingerprints', 'dependency_ids', 'dependency_fingerprints', 'binding_ids', 'binding_fingerprints',
  'stop_condition_ids', 'stop_condition_fingerprints', 'compensation_reference_ids', 'compensation_fingerprints',
  'estimated_input_tokens', 'estimated_output_tokens', 'estimated_total_tokens', 'estimated_total_cost_minor_units',
  'logical_sequence', 'simulation', 'production_blocked'
]);

// Semantically-unordered id/fingerprint pairs (dependency, binding, stop condition, compensation) are
// canonicalized by sorting on their id, so caller insertion order never changes the resulting
// package fingerprint -- but the pairing between an id and its own fingerprint is preserved by
// sorting them together, never independently. ordered_stage_ids/stage_fingerprints are NEVER
// canonicalized this way: stage order is the Planner's own semantic order (stage_sequence), and a
// change in that order must change the fingerprint.
function sortIdFingerprintPairs(ids, fingerprints) {
  const pairs = ids.map((id, index) => [id, fingerprints[index]]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { ids: pairs.map((pair) => pair[0]), fingerprints: pairs.map((pair) => pair[1]) };
}

function buildExecutionPlanPackage(input = {}) {
  const dependencyPairs = sortIdFingerprintPairs(
    Array.isArray(input.dependency_ids) ? input.dependency_ids : [],
    Array.isArray(input.dependency_fingerprints) ? input.dependency_fingerprints : []
  );
  const bindingPairs = sortIdFingerprintPairs(
    Array.isArray(input.binding_ids) ? input.binding_ids : [],
    Array.isArray(input.binding_fingerprints) ? input.binding_fingerprints : []
  );
  const stopConditionPairs = sortIdFingerprintPairs(
    Array.isArray(input.stop_condition_ids) ? input.stop_condition_ids : [],
    Array.isArray(input.stop_condition_fingerprints) ? input.stop_condition_fingerprints : []
  );
  const compensationPairs = sortIdFingerprintPairs(
    Array.isArray(input.compensation_reference_ids) ? input.compensation_reference_ids : [],
    Array.isArray(input.compensation_fingerprints) ? input.compensation_fingerprints : []
  );

  return {
    execution_plan_id: input.execution_plan_id || NOT_AVAILABLE_LABEL,
    execution_plan_version: Number.isInteger(input.execution_plan_version) ? input.execution_plan_version : 1,
    authorization_decision_fingerprint: input.authorization_decision_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    orchestrator_decision_fingerprint: input.orchestrator_decision_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    readiness_bundle_fingerprint: input.readiness_bundle_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    planning_result_fingerprint: input.planning_result_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    orchestration_plan_fingerprint: input.orchestration_plan_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    task_fingerprint: input.task_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    stage_manifest_reference_id: input.stage_manifest_reference_id || NOT_AVAILABLE_LABEL,
    stage_manifest_fingerprint: input.stage_manifest_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    dependency_graph_fingerprint: input.dependency_graph_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    budget_fingerprint: input.budget_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    idempotency_fingerprint: input.idempotency_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    memory_fingerprint: input.memory_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    context_fingerprint: input.context_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    model_fingerprint: input.model_fingerprint === undefined ? null : input.model_fingerprint,
    tool_fingerprints: Array.isArray(input.tool_fingerprints) ? [...input.tool_fingerprints].sort() : [],
    workflow_fingerprint: input.workflow_fingerprint === undefined ? null : input.workflow_fingerprint,
    ordered_stage_ids: Array.isArray(input.ordered_stage_ids) ? input.ordered_stage_ids : [],
    stage_fingerprints: Array.isArray(input.stage_fingerprints) ? input.stage_fingerprints : [],
    dependency_ids: dependencyPairs.ids,
    dependency_fingerprints: dependencyPairs.fingerprints,
    binding_ids: bindingPairs.ids,
    binding_fingerprints: bindingPairs.fingerprints,
    stop_condition_ids: stopConditionPairs.ids,
    stop_condition_fingerprints: stopConditionPairs.fingerprints,
    compensation_reference_ids: compensationPairs.ids,
    compensation_fingerprints: compensationPairs.fingerprints,
    estimated_input_tokens: Number.isInteger(input.estimated_input_tokens) ? input.estimated_input_tokens : 0,
    estimated_output_tokens: Number.isInteger(input.estimated_output_tokens) ? input.estimated_output_tokens : 0,
    estimated_total_tokens: Number.isInteger(input.estimated_total_tokens) ? input.estimated_total_tokens : 0,
    estimated_total_cost_minor_units: Number.isInteger(input.estimated_total_cost_minor_units) ? input.estimated_total_cost_minor_units : 0,
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    simulation: true,
    production_blocked: true
  };
}

// `stablePayload` provides deterministic canonical serialization (key-sorted JSON). It is not a
// signature, MAC, or cryptographic authenticity guarantee, and provides no protection against a
// malicious caller who can simply recompute the same payload. See docs "Canonical fingerprint
// versus autenticidade".
function computeExecutionPlanPackageFingerprint(pkg) {
  if (!isPlainObject(pkg)) throw new Error('execution_plan_package_must_be_object');
  return stablePayload(pkg);
}

module.exports = {
  EXECUTION_PLAN_PACKAGE_FIELDS,
  NOT_AVAILABLE_FINGERPRINT,
  NOT_AVAILABLE_LABEL,
  buildExecutionPlanPackage,
  computeExecutionPlanPackageFingerprint,
  sortIdFingerprintPairs
};
