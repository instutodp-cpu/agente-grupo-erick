'use strict';

const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { buildExecutionRegistrySnapshotReference } = require('./execution-registry-snapshot-reference');
const {
  EXECUTION_PLAN_REQUEST_VALIDATOR_VERSION,
  buildAuthorizationDecisionReference,
  validateExecutionPlanRequest
} = require('./execution-plan-request');

function fail(code) { throw new Error(`execution_plan_request_assembly_failed::${code}`); }
function same(label, values) {
  const defined = values.filter((v) => typeof v === 'string' && v.length > 0);
  if (defined.length < 2 || new Set(defined).size !== 1) fail(`${label}_identity_mismatch`);
  return defined[0];
}

function assembleExecutionPlanRequest(input = {}) {
  const auth = input.authorization_result && input.authorization_result.decision;
  if (!auth) fail('authorization_decision_missing');
  if (auth.status !== 'AUTHORIZED_SIMULATION' ||
      auth.decision !== 'AUTHORIZE_EXECUTION_REFERENCE_SIMULATION' ||
      auth.next_state !== 'EXECUTION_REFERENCE_AUTHORIZED_SIMULATION' ||
      auth.authorized_in_simulation !== true ||
      auth.execution_authorized !== false || auth.execution_started !== false ||
      auth.executed !== false || auth.simulation !== true || auth.production_blocked !== true) {
    fail('authorization_not_ready_simulation');
  }

  const planning = input.planning_result_reference || {};
  const plan = input.orchestration_plan_reference || {};
  const task = input.task_reference || {};
  same('planning_result', [auth.planning_result_id, planning.planning_result_id, plan.planning_result_id, task.planning_result_id]);
  same('plan', [auth.plan_id, planning.plan_id, plan.plan_id, task.plan_id]);
  for (const field of ['tenant_id','organization_id','project_id','session_reference_id']) {
    same(field, [auth[field], planning[field], plan[field], task[field]]);
  }

  const authorizationDecisionReference = buildAuthorizationDecisionReference({
    ...auth,
    authorization_decision_fingerprint: stablePayload(auth)
  });

  const request = {
    execution_plan_request_id: input.execution_plan_request_id,
    execution_plan_request_version: 1,
    authorization_decision_reference: authorizationDecisionReference,
    orchestrator_decision_reference: input.orchestrator_decision_reference,
    readiness_evidence_bundle_reference: input.readiness_evidence_bundle_reference,
    planning_result_reference: planning,
    orchestration_plan_reference: plan,
    task_reference: task,
    memory_selection_reference: input.memory_selection_reference,
    context_assembly_reference: input.context_assembly_reference,
    model_selection_reference: input.model_selection_reference,
    tool_decision_references: input.tool_decision_references || [],
    workflow_decision_reference: input.workflow_decision_reference,
    execution_plan_policy_reference: input.execution_plan_policy_reference,
    execution_plan_budget: input.execution_plan_budget,
    idempotency_policy_reference: input.idempotency_policy_reference,
    stop_condition_references: input.stop_condition_references || [],
    compensation_references: input.compensation_references || [],
    dependency_graph_reference: input.dependency_graph_reference,
    stage_manifest_reference: input.stage_manifest_reference,
    authorization_provenance_reference: input.authorization_provenance_reference,
    authorization_scope_reference: input.authorization_scope_reference,
    registry_snapshot_reference: input.registry_snapshot_reference,
    correlation_id: input.correlation_id,
    causation_id: input.causation_id,
    trace_id: input.trace_id,
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    expected_registry_version: input.expected_registry_version,
    simulation_context: input.simulation_context,
    validator_version: EXECUTION_PLAN_REQUEST_VALIDATOR_VERSION
  };
  if (!request.registry_snapshot_reference && input.registry_snapshot_seed) {
    const shallowIdentity = {
      execution_plan_request_id: request.execution_plan_request_id,
      execution_plan_request_version: request.execution_plan_request_version,
      correlation_id: request.correlation_id,
      causation_id: request.causation_id,
      trace_id: request.trace_id,
      logical_sequence: request.logical_sequence,
      expected_registry_version: request.expected_registry_version,
      validator_version: request.validator_version
    };
    request.registry_snapshot_reference = buildExecutionRegistrySnapshotReference({
      ...input.registry_snapshot_seed,
      execution_plan_request_id: request.execution_plan_request_id,
      execution_plan_id: plan.plan_id,
      tenant_id: planning.tenant_id,
      organization_id: planning.organization_id,
      project_id: planning.project_id,
      session_reference_id: planning.session_reference_id,
      expected_registry_version: request.expected_registry_version,
      registry_entity_fingerprints: {
        execution_plan_request: stablePayload(shallowIdentity),
        stage_manifest: request.stage_manifest_reference.manifest_fingerprint,
        dependency_graph: request.dependency_graph_reference.graph_fingerprint,
        provenance: stablePayload(request.authorization_provenance_reference),
        scope: request.authorization_scope_reference.scope_fingerprint,
        execution_plan_budget: request.execution_plan_budget.budget_fingerprint,
        idempotency_policy: request.idempotency_policy_reference.idempotency_fingerprint
      }
    });
  }
  const validation = validateExecutionPlanRequest(request);
  if (!validation.valid) fail(`request_invalid::${validation.errors.join(',')}`);
  return cloneFrozen(request);
}

module.exports = { assembleExecutionPlanRequest };
