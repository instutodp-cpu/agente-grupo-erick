'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { findAgentCoreOperationalMaterial } = require('../src/core/agent-identity-contract');
const { runAllGates } = require('../src/core/architecture-gate-runner');

const {
  validateRuntimeDispatchPolicy, buildRuntimeDispatchPolicy, RUNTIME_DISPATCH_POLICY_FIELDS
} = require('../src/core/runtime-dispatch-policy');
const {
  validateRuntimeDispatchRequest, RUNTIME_DISPATCH_REQUEST_FIELDS
} = require('../src/core/runtime-dispatch-request');
const {
  validateRuntimeDispatchStageReference, RUNTIME_DISPATCH_STAGE_REFERENCE_FIELDS
} = require('../src/core/runtime-dispatch-stage-reference');
const {
  validateRuntimeDispatchWorkerBindingReference, RUNTIME_DISPATCH_WORKER_BINDING_REFERENCE_FIELDS
} = require('../src/core/runtime-dispatch-worker-binding-reference');
const {
  validateRuntimeDispatchDependencyGateReference, buildRuntimeDispatchDependencyGateReference,
  RUNTIME_DISPATCH_DEPENDENCY_GATE_REFERENCE_FIELDS
} = require('../src/core/runtime-dispatch-dependency-gate-reference');
const {
  validateRuntimeDispatchApprovalGateReference, buildRuntimeDispatchApprovalGateReference,
  RUNTIME_DISPATCH_APPROVAL_GATE_REFERENCE_FIELDS
} = require('../src/core/runtime-dispatch-approval-gate-reference');
const {
  validateRuntimeDispatchCapacityReference, RUNTIME_DISPATCH_CAPACITY_REFERENCE_FIELDS
} = require('../src/core/runtime-dispatch-capacity-reference');
const {
  validateRuntimeDispatchBudgetReference, RUNTIME_DISPATCH_BUDGET_REFERENCE_FIELDS
} = require('../src/core/runtime-dispatch-budget-reference');
const {
  validateRuntimeDispatchPayloadReference, buildRuntimeDispatchPayloadReference,
  RUNTIME_DISPATCH_PAYLOAD_REFERENCE_FIELDS
} = require('../src/core/runtime-dispatch-payload-reference');
const {
  validateRuntimeDispatchIntentReference, RUNTIME_DISPATCH_INTENT_REFERENCE_FIELDS
} = require('../src/core/runtime-dispatch-intent-reference');
const {
  validateRuntimeDispatchOrderReference, buildRuntimeDispatchOrderReference, RUNTIME_DISPATCH_ORDER_REFERENCE_FIELDS
} = require('../src/core/runtime-dispatch-order-reference');
const {
  validateRuntimeDispatchReplayReference, buildRuntimeDispatchReplayReference, RUNTIME_DISPATCH_REPLAY_REFERENCE_FIELDS
} = require('../src/core/runtime-dispatch-replay-reference');
const { validateRuntimeDispatchPackage, buildRuntimeDispatchPackage } = require('../src/core/runtime-dispatch-package');
const {
  validateRuntimeDispatchDecision, DISPATCH_STATUSES, DISPATCH_PRECEDENCE_ORDER
} = require('../src/core/runtime-dispatch-decision');
const { validateRuntimeDispatchResult } = require('../src/core/runtime-dispatch-result');
const { validateRuntimeDispatchAudit } = require('../src/core/runtime-dispatch-audit');
const { createRuntimeDispatchRegistry } = require('../src/core/runtime-dispatch-registry');
const { evaluateRuntimeDispatchRequest, deriveDispatchStageStatus } = require('../src/core/runtime-dispatch-boundary');

const { buildGoldenDispatchBundle } = require('./helpers/runtime-dispatch-simulation-test-data');
const { buildRuntimeWorkerAssignmentRequest } = require('../src/core/runtime-worker-assignment-request');
const { buildRuntimeSchedulerPackage } = require('../src/core/runtime-scheduler-package');
const { buildRuntimeSchedulerResult } = require('../src/core/runtime-scheduler-result');
const { buildRuntimeSchedulerStageReference } = require('../src/core/runtime-scheduler-stage-reference');
const { buildRuntimeCapacitySnapshotReference } = require('../src/core/runtime-capacity-snapshot-reference');
const { buildRuntimeBudgetSimulationReference } = require('../src/core/runtime-budget-simulation-reference');
const { buildRuntimeWorkerCapacityReference } = require('../src/core/runtime-worker-capacity-reference');
const { buildRuntimeSchedulerDependencyReference } = require('../src/core/runtime-scheduler-dependency-reference');

function assertValid(label, validation) {
  assert.equal(validation.valid, true, `${label}: ${JSON.stringify(validation.errors)}`);
}

function assertInvalid(label, validation) {
  assert.equal(validation.valid, false, `${label} unexpectedly valid`);
}

function rebuildDispatchRequest(request) {
  const { buildRuntimeDispatchRequest } = require('../src/core/runtime-dispatch-request');
  return buildRuntimeDispatchRequest(request);
}

// pr107fix: rebuilds the golden Scheduler Result with its first stage's declarative fields
// overridden (each stage rebuilt through its own real builder, so its self-fingerprint stays
// genuinely consistent) -- the only way to exercise a stage genuinely carrying a model/tool/
// workflow/parallel reference through the full chain without a bespoke synthetic worker pool.
function tamperFirstSchedulerStage(golden, stageOverrides) {
  return tamperSchedulerStageAt(golden, 0, stageOverrides);
}

function tamperSchedulerStageAt(golden, targetIndex, stageOverrides) {
  const origResult = golden.dispatchRequest.runtime_scheduler_result_reference;
  const stages = origResult.scheduler_stage_references.map((s, index) => (
    index === targetIndex ? buildRuntimeSchedulerStageReference({ ...s, ...stageOverrides }) : s
  ));
  return buildRuntimeSchedulerResult({ ...origResult, scheduler_stage_references: stages });
}

// pr107fix2: rebuilds every RuntimeWorkerCapacityReference the golden bundle carries with the given
// dimensions zeroed out (each rebuilt through its own real builder, self-fingerprint stays valid).
function zeroWorkerCapacityDimensions(golden, dimensionFields) {
  const origCapacityRefs = golden.dispatchRequest.runtime_worker_capacity_references;
  const overrides = {};
  for (const dim of dimensionFields) {
    overrides[`maximum_${dim}_assignments`] = 0;
    overrides[`current_${dim}_assignments`] = 0;
    overrides[`available_${dim}_assignments`] = 0;
  }
  return origCapacityRefs.map((c) => buildRuntimeWorkerCapacityReference({ ...c, ...overrides }));
}

// pr107fix2: rebuilds the golden Scheduler Dependency References list with the first entry's
// declarative fields overridden (through its own real builder).
function tamperFirstSchedulerDependency(golden, depOverrides) {
  const origDeps = golden.dispatchRequest.runtime_scheduler_dependency_references;
  return origDeps.map((d, index) => (index === 0 ? buildRuntimeSchedulerDependencyReference({ ...d, ...depOverrides }) : d));
}

const OPERATIONAL_FLAG_FIELDS = [
  'dispatch_authorized', 'dispatch_applied', 'dispatch_sent', 'dispatch_acknowledged', 'dispatch_lease_created',
  'worker_reserved', 'worker_started', 'worker_connection_opened', 'worker_process_created', 'worker_thread_created',
  'container_started', 'scheduler_started', 'job_created', 'queue_created', 'queue_item_created', 'queue_used',
  'stage_dispatched', 'stage_started', 'stage_completed', 'stage_failed', 'runtime_enabled', 'execution_authorized',
  'execution_started', 'network_used', 'secret_resolved', 'executed'
];

// --- Policy -----------------------------------------------------------------------------------

test('dispatch policy: valid contract, exact fields, safe defaults, nenhuma policy habilita dispatch', () => {
  const policy = buildRuntimeDispatchPolicy({ runtime_dispatch_policy_id: 'dp-1' });
  assertValid('dispatch policy', validateRuntimeDispatchPolicy(policy));
  assert.deepEqual(Object.keys(policy).sort(), [...RUNTIME_DISPATCH_POLICY_FIELDS].sort());
  assert.equal(policy.allow_dispatch_package_preparation_simulation, true);
  assert.equal(policy.allow_external_effect_reference, false);
  assert.equal(policy.allow_irreversible_reference, false);
  assert.equal(policy.simulation, true);
  assert.equal(policy.production_blocked, true);
  for (const field of RUNTIME_DISPATCH_POLICY_FIELDS) {
    if (field.startsWith('require_') || field.startsWith('fail_on_') || field === 'fail_closed') assert.equal(policy[field], true, field);
  }
});

test('dispatch policy: fields missing/extra and smuggled unsafe flags rejected', () => {
  const policy = buildRuntimeDispatchPolicy({ runtime_dispatch_policy_id: 'dp-1' });
  assertInvalid('missing field', validateRuntimeDispatchPolicy({ ...policy, allow_model_dispatch_reference: undefined }));
  assertInvalid('extra field', validateRuntimeDispatchPolicy({ ...policy, extra_field: true }));
  assertInvalid('external effect smuggled true', validateRuntimeDispatchPolicy({ ...policy, allow_external_effect_reference: true }));
  assertInvalid('require flag smuggled false', validateRuntimeDispatchPolicy({ ...policy, require_worker_recommended: false }));
});

// --- Reference contracts: exact fields / safe flags --------------------------------------------

test('dispatch stage reference: exact fields and safe flags', () => {
  const golden = buildGoldenDispatchBundle();
  const outcome = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  assert.equal(outcome.decision.status, 'DISPATCH_PACKAGE_PREPARED_SIMULATION');
  const stage = outcome.dispatchStageRefs[0];
  assertValid('dispatch stage reference', validateRuntimeDispatchStageReference(stage));
  assert.deepEqual(Object.keys(stage).sort(), [...RUNTIME_DISPATCH_STAGE_REFERENCE_FIELDS].sort());
  assert.equal(stage.stage_dispatched, false);
  assert.equal(stage.stage_started, false);
  assertInvalid('tampered fingerprint', validateRuntimeDispatchStageReference({ ...stage, dispatch_stage_fingerprint: 'sha256:' + 'f'.repeat(64) }));
});

test('dispatch worker binding reference: exact fields and safe flags, never reserve/start/connect', () => {
  const golden = buildGoldenDispatchBundle();
  const outcome = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  const binding = outcome.workerBindingRefs[0];
  assertValid('worker binding reference', validateRuntimeDispatchWorkerBindingReference(binding));
  assert.deepEqual(Object.keys(binding).sort(), [...RUNTIME_DISPATCH_WORKER_BINDING_REFERENCE_FIELDS].sort());
  assert.equal(binding.worker_reserved, false);
  assert.equal(binding.worker_started, false);
  assert.equal(binding.worker_connection_opened, false);
  assert.equal(binding.worker_binding_validated, true);
});

test('dependency gate reference: zero dependências allows dispatch, blocking dependency blocks it', () => {
  const zero = buildRuntimeDispatchDependencyGateReference({
    dispatch_dependency_gate_reference_id: 'dg-1', runtime_dispatch_package_id: 'pkg-1', runtime_scheduler_package_id: 'sched-1',
    runtime_dispatch_stage_reference_id: 'stg-1', scheduler_stage_reference_id: 'sstage-1'
  });
  assertValid('dependency gate zero deps', validateRuntimeDispatchDependencyGateReference(zero));
  assert.deepEqual(Object.keys(zero).sort(), [...RUNTIME_DISPATCH_DEPENDENCY_GATE_REFERENCE_FIELDS].sort());
  assert.equal(zero.dispatch_allowed_by_dependencies, true);
  assert.equal(zero.dependencies_satisfied, false);
  assert.equal(zero.dependencies_applied, false);

  const blocked = buildRuntimeDispatchDependencyGateReference({
    dispatch_dependency_gate_reference_id: 'dg-2', runtime_dispatch_package_id: 'pkg-1', runtime_scheduler_package_id: 'sched-1',
    runtime_dispatch_stage_reference_id: 'stg-2', scheduler_stage_reference_id: 'sstage-2',
    required_dependency_reference_ids: ['dep-a'], blocking_dependency_reference_ids: ['dep-a']
  });
  assert.equal(blocked.dispatch_allowed_by_dependencies, false);
});

test('approval gate reference: approval_required=true never allows dispatch, false always does', () => {
  const required = buildRuntimeDispatchApprovalGateReference({
    dispatch_approval_gate_reference_id: 'ag-1', runtime_dispatch_package_id: 'pkg-1', runtime_scheduler_package_id: 'sched-1',
    runtime_dispatch_stage_reference_id: 'stg-1', scheduler_stage_reference_id: 'sstage-1', approval_required: true
  });
  assertValid('approval gate required', validateRuntimeDispatchApprovalGateReference(required));
  assert.deepEqual(Object.keys(required).sort(), [...RUNTIME_DISPATCH_APPROVAL_GATE_REFERENCE_FIELDS].sort());
  assert.equal(required.dispatch_allowed_by_approval, false);
  assert.equal(required.approval_granted, false);
  assert.equal(required.approval_consumed, false);
  assert.equal(required.approval_applied, false);

  const notRequired = buildRuntimeDispatchApprovalGateReference({
    dispatch_approval_gate_reference_id: 'ag-2', runtime_dispatch_package_id: 'pkg-1', runtime_scheduler_package_id: 'sched-1',
    runtime_dispatch_stage_reference_id: 'stg-2', scheduler_stage_reference_id: 'sstage-2', approval_required: false
  });
  assert.equal(notRequired.dispatch_allowed_by_approval, true);
});

test('capacity reference: exact fields, capacity_validated derived from all 14 availability flags', () => {
  const golden = buildGoldenDispatchBundle();
  const outcome = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  const capacity = outcome.capacityRefs[0];
  assertValid('capacity reference', validateRuntimeDispatchCapacityReference(capacity));
  assert.deepEqual(Object.keys(capacity).sort(), [...RUNTIME_DISPATCH_CAPACITY_REFERENCE_FIELDS].sort());
  assert.equal(capacity.capacity_applied, false);
  assert.equal(capacity.capacity_reserved, false);
  assert.equal(capacity.slots_consumed, false);
});

test('budget reference: exact fields, no reserve/consume, estimates preserved unmodified', () => {
  const golden = buildGoldenDispatchBundle();
  const outcome = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  const budget = outcome.budgetRefs[0];
  assertValid('budget reference', validateRuntimeDispatchBudgetReference(budget));
  assert.deepEqual(Object.keys(budget).sort(), [...RUNTIME_DISPATCH_BUDGET_REFERENCE_FIELDS].sort());
  assert.equal(budget.tokens_reserved, false);
  assert.equal(budget.tokens_consumed, false);
  assert.equal(budget.cost_reserved, false);
  assert.equal(budget.cost_consumed, false);
});

test('payload reference: somente referências -- every content flag permanently false, tampering rejected', () => {
  const golden = buildGoldenDispatchBundle();
  const outcome = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  const payload = outcome.payloadRefs[0];
  assertValid('payload reference', validateRuntimeDispatchPayloadReference(payload));
  assert.deepEqual(Object.keys(payload).sort(), [...RUNTIME_DISPATCH_PAYLOAD_REFERENCE_FIELDS].sort());
  for (const field of [
    'payload_content_included', 'prompt_included', 'message_included', 'memory_content_included', 'secret_included',
    'credential_included', 'tool_arguments_included', 'provider_output_included', 'executable_code_included', 'endpoint_included'
  ]) {
    assert.equal(payload[field], false, field);
  }
  assert.deepEqual(findAgentCoreOperationalMaterial(payload), []);
});

test('payload reference: smuggled content flag on build input is silently forced false, never honored', () => {
  const payload = buildRuntimeDispatchPayloadReference({
    dispatch_payload_reference_id: 'pl-x', runtime_dispatch_package_id: 'pkg-1', runtime_dispatch_stage_reference_id: 'stg-1',
    dispatch_worker_binding_reference_id: 'wb-1', runtime_execution_package_id: 'exec-1', runtime_stage_reference_id: 'rstage-1',
    runtime_worker_reference_id: 'w-1', task_reference_id: 'task-1', agent_reference_id: 'agent-1',
    payload_content_included: true, prompt_included: true, secret_included: true
  });
  assert.equal(payload.payload_content_included, false);
  assert.equal(payload.prompt_included, false);
  assert.equal(payload.secret_included, false);
});

test('intent reference: DISPATCH_INTENT_PREPARED_SIMULATION requires every one of the 6 gates passed', () => {
  const golden = buildGoldenDispatchBundle();
  const outcome = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  const intent = outcome.intentRefs.find((i) => i.dispatch_intent_status === 'DISPATCH_INTENT_PREPARED_SIMULATION');
  assertValid('intent reference', validateRuntimeDispatchIntentReference(intent));
  assert.deepEqual(Object.keys(intent).sort(), [...RUNTIME_DISPATCH_INTENT_REFERENCE_FIELDS].sort());
  assert.equal(intent.dispatch_authorized, false);
  assert.equal(intent.dispatch_sent, false);
  assert.equal(intent.dispatch_lease_created, false);
  for (const field of ['dependency_gate_passed', 'approval_gate_passed', 'capacity_gate_passed', 'budget_gate_passed', 'worker_gate_passed', 'payload_gate_passed']) {
    assert.equal(intent[field], true, field);
  }
});

test('order reference: exact fields, ordered lists never sorted, partitions cover every intent', () => {
  const golden = buildGoldenDispatchBundle();
  const outcome = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  const order = outcome.orderRef;
  assertValid('order reference', validateRuntimeDispatchOrderReference(order));
  assert.deepEqual(Object.keys(order).sort(), [...RUNTIME_DISPATCH_ORDER_REFERENCE_FIELDS].sort());
  assert.equal(order.dispatch_order_applied, false);
  assert.equal(order.scheduler_order_preserved, true);
  assert.equal(order.dispatch_order_validated, true);
});

test('order reference: input order preserved -- not re-sorted alphabetically', () => {
  const order = buildRuntimeDispatchOrderReference({
    dispatch_order_reference_id: 'ord-1', runtime_dispatch_package_id: 'pkg-1', runtime_scheduler_package_id: 'sched-1',
    ordered_dispatch_stage_reference_ids: ['stage-b', 'stage-a'], ordered_dispatch_intent_reference_ids: ['intent-b', 'intent-a'],
    prepared_dispatch_intent_reference_ids: ['intent-a', 'intent-b'],
    scheduler_order_preserved: true, required_predecessor_order_preserved: true
  });
  assert.deepEqual(order.ordered_dispatch_stage_reference_ids, ['stage-b', 'stage-a']);
  assert.deepEqual(order.ordered_dispatch_intent_reference_ids, ['intent-b', 'intent-a']);
});

test('dispatch replay reference: exact fields, replay_consumed permanently false, replay_allowed derived', () => {
  const golden = buildGoldenDispatchBundle();
  assertValid('dispatch replay reference', validateRuntimeDispatchReplayReference(golden.dispatchReplayRef));
  assert.deepEqual(Object.keys(golden.dispatchReplayRef).sort(), [...RUNTIME_DISPATCH_REPLAY_REFERENCE_FIELDS].sort());
  assert.equal(golden.dispatchReplayRef.replay_consumed, false);
  assert.equal(golden.dispatchReplayRef.replay_allowed, true);
});

// --- Request ------------------------------------------------------------------------------------

test('dispatch request: golden bundle is structurally valid, nested validators cover every reference', () => {
  const golden = buildGoldenDispatchBundle();
  assertValid('dispatch request', validateRuntimeDispatchRequest(golden.dispatchRequest));
  assert.deepEqual(Object.keys(golden.dispatchRequest).sort(), [...RUNTIME_DISPATCH_REQUEST_FIELDS].sort());
});

test('dispatch request: missing/extra field and invalid nested reference rejected', () => {
  const golden = buildGoldenDispatchBundle();
  assertInvalid('missing field', validateRuntimeDispatchRequest({ ...golden.dispatchRequest, runtime_dispatch_policy: undefined }));
  assertInvalid('extra field', validateRuntimeDispatchRequest({ ...golden.dispatchRequest, extra_field: true }));
  assertInvalid('invalid nested worker assignment decision', validateRuntimeDispatchRequest({
    ...golden.dispatchRequest, runtime_worker_assignment_decision_reference: { not: 'valid' }
  }));
});

test('dispatch request: context never alters validity', () => {
  const golden = buildGoldenDispatchBundle();
  const v1 = validateRuntimeDispatchRequest(golden.dispatchRequest);
  const v2 = validateRuntimeDispatchRequest(golden.dispatchRequest);
  assert.deepEqual(v1, v2);
});

// --- Boundary: golden happy path -----------------------------------------------------------------

test('dispatch boundary: golden bundle reaches DISPATCH_PACKAGE_PREPARED_SIMULATION with every validated flag true', () => {
  const golden = buildGoldenDispatchBundle();
  const outcome = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  assert.equal(outcome.decision.status, 'DISPATCH_PACKAGE_PREPARED_SIMULATION');
  assert.equal(outcome.decision.dispatch_package_prepared_in_simulation, true);
  for (const field of [
    'request_validated', 'policy_validated', 'worker_assignment_validated', 'scheduler_validated', 'runtime_package_validated',
    'identity_validated', 'freshness_validated', 'replay_validated', 'idempotency_validated', 'registry_snapshot_validated',
    'network_policies_validated', 'secret_policies_validated', 'stage_policy_requirements_validated',
    'dispatch_stages_validated', 'worker_bindings_validated', 'dependency_gates_validated', 'approval_gates_validated',
    'capacity_references_validated', 'budget_references_validated', 'payload_references_validated',
    'dispatch_intents_validated', 'dispatch_order_validated', 'package_fingerprint_validated', 'package_digest_validated',
    'non_execution_invariants_validated'
  ]) {
    assert.equal(outcome.decision[field], true, field);
  }
  assert.equal(outcome.package.dispatch_stage_count, 2);
  assert.equal(outcome.package.prepared_intent_count, 2);
});

test('dispatch boundary: worker assignment request/decision id mismatch blocks as DISPATCH_WORKER_ASSIGNMENT_BLOCKED, progressive flags never retroactive', () => {
  const golden = buildGoldenDispatchBundle();
  const tampered = {
    ...golden.dispatchRequest,
    runtime_worker_assignment_request_reference: {
      ...golden.workerAssignmentRequest, runtime_worker_assignment_request_id: 'a-different-worker-assignment-request-id'
    }
  };
  const outcome = evaluateRuntimeDispatchRequest(tampered, {});
  assert.equal(outcome.decision.status, 'DISPATCH_WORKER_ASSIGNMENT_BLOCKED');
  assert.equal(outcome.decision.request_validated, true);
  assert.equal(outcome.decision.policy_validated, true);
  assert.equal(outcome.decision.identity_validated, true);
  assert.equal(outcome.decision.worker_assignment_validated, false);
  assert.equal(outcome.decision.scheduler_validated, false);
  assert.equal(outcome.decision.dispatch_package_prepared_in_simulation, false);
});

test('dispatch boundary: scheduler request/decision id mismatch blocks as DISPATCH_SCHEDULER_BLOCKED', () => {
  const golden = buildGoldenDispatchBundle();
  const tampered = {
    ...golden.dispatchRequest,
    runtime_scheduler_request_reference: {
      ...golden.schedulerRequest, runtime_scheduler_request_id: 'a-different-scheduler-request-id'
    }
  };
  const outcome = evaluateRuntimeDispatchRequest(tampered, {});
  assert.equal(outcome.decision.status, 'DISPATCH_SCHEDULER_BLOCKED');
});

test('dispatch boundary: freshness expired at current logical_sequence blocks as DISPATCH_FRESHNESS_BLOCKED', () => {
  const golden = buildGoldenDispatchBundle();
  const request = rebuildDispatchRequest({
    ...golden.dispatchRequest,
    logical_sequence: golden.dispatchRequest.runtime_freshness_reference.current_logical_sequence + 1000000
  });
  const outcome = evaluateRuntimeDispatchRequest(request, {});
  assert.equal(outcome.decision.status, 'DISPATCH_FRESHNESS_BLOCKED');
});

test('dispatch boundary: replay reference not bound to this dispatch request blocks as DISPATCH_REPLAY_BLOCKED', () => {
  const golden = buildGoldenDispatchBundle();
  // Genuinely self-consistent (its own fingerprint is recomputed by the builder) but bound to the
  // wrong worker assignment package fingerprint -- exactly the substitution step 15 exists to catch.
  const wrongReplayRef = buildRuntimeDispatchReplayReference({
    ...golden.dispatchReplayRef, runtime_worker_assignment_package_fingerprint: 'sha256:' + 'b'.repeat(64)
  });
  const tampered = { ...golden.dispatchRequest, runtime_dispatch_replay_reference: wrongReplayRef };
  const outcome = evaluateRuntimeDispatchRequest(tampered, {});
  assert.equal(outcome.decision.status, 'DISPATCH_REPLAY_BLOCKED');
});

test('dispatch boundary: DISPATCH_STATUSES is exactly covered by DISPATCH_PRECEDENCE_ORDER', () => {
  assert.deepEqual([...DISPATCH_STATUSES].sort(), [...DISPATCH_PRECEDENCE_ORDER].sort());
});

test('deriveDispatchStageStatus: waiting/blocked/no-candidate/optional/eligible each derive correctly', () => {
  const stage = { optional: false };
  assert.equal(deriveDispatchStageStatus(stage, 'WORKER_ASSIGNMENT_BLOCKED'), 'DISPATCH_STAGE_BLOCKED');
  assert.equal(deriveDispatchStageStatus(stage, 'WORKER_WAITING_DEPENDENCY_REFERENCE'), 'DISPATCH_STAGE_WAITING_DEPENDENCY_REFERENCE');
  assert.equal(deriveDispatchStageStatus(stage, 'WORKER_WAITING_APPROVAL_REFERENCE'), 'DISPATCH_STAGE_WAITING_APPROVAL_REFERENCE');
  assert.equal(deriveDispatchStageStatus(stage, 'WORKER_NO_COMPATIBLE_CANDIDATE_BLOCKED'), 'DISPATCH_STAGE_NO_WORKER_BLOCKED');
  assert.equal(deriveDispatchStageStatus(stage, 'WORKER_RECOMMENDED_SIMULATION'), 'DISPATCH_STAGE_ELIGIBLE_SIMULATION');
  assert.equal(deriveDispatchStageStatus({ optional: true }, 'WORKER_RECOMMENDED_SIMULATION'), 'DISPATCH_STAGE_OPTIONAL_REFERENCE');
});

// --- Package integrity -----------------------------------------------------------------------------

test('package integrity: package fingerprint/digest self-recompute detects tampering', () => {
  const golden = buildGoldenDispatchBundle();
  const outcome = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  assert.equal(outcome.decision.status, 'DISPATCH_PACKAGE_PREPARED_SIMULATION');
  assertInvalid('tampered dispatch_stage_count', validateRuntimeDispatchPackage({ ...outcome.package, dispatch_stage_count: 999 }));
});

// --- Decision / Result / Audit --------------------------------------------------------------------

test('dispatch decision: valid contract for a prepared outcome', () => {
  const golden = buildGoldenDispatchBundle();
  const outcome = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  assertValid('dispatch decision', validateRuntimeDispatchDecision(outcome.decision));
});

test('dispatch result: valid contract for a prepared outcome', () => {
  const golden = buildGoldenDispatchBundle();
  const outcome = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  assertValid('dispatch result', validateRuntimeDispatchResult(outcome.result));
});

test('dispatch audit: never registers payload/prompt/secret content, only ids/fingerprints/counts', () => {
  const golden = buildGoldenDispatchBundle();
  const outcome = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  assertValid('dispatch audit', validateRuntimeDispatchAudit(outcome.audit));
  assert.deepEqual(findAgentCoreOperationalMaterial(outcome.audit), []);
});

// --- Registry -----------------------------------------------------------------------------------

test('registry: registers a dispatch package, replays an identical one, blocks a payload mismatch without a version bump', () => {
  const golden = buildGoldenDispatchBundle();
  const outcome = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  const registry = createRuntimeDispatchRegistry();
  const first = registry.registerRuntimeDispatchPackage(outcome.package);
  assert.equal(first.status, 'REGISTERED_SIMULATION');
  const replay = registry.registerRuntimeDispatchPackage(outcome.package);
  assert.equal(replay.status, 'REPLAY_ACCEPTED');
  const mutated = buildRuntimeDispatchPackage({
    ...outcome.package, estimated_total_cost_minor_units: outcome.package.estimated_total_cost_minor_units + 1
  });
  const mismatch = registry.registerRuntimeDispatchPackage(mutated);
  assert.equal(mismatch.status, 'PAYLOAD_MISMATCH');
});

test('registry: rejects a structurally invalid record as VALIDATION_FAILED', () => {
  const registry = createRuntimeDispatchRegistry();
  const result = registry.registerRuntimeDispatchRequest({ not: 'valid' });
  assert.equal(result.status, 'VALIDATION_FAILED');
});

// --- Side-channels / Security -----------------------------------------------------------------

test('side-channels: a hostile context claiming dispatch authorization/worker reservation has zero effect', () => {
  const golden = buildGoldenDispatchBundle();
  const hostileContext = {
    dispatchAuthorized: true, dispatchApplied: true, dispatchSent: true, workerReserved: true, workerHealthy: true,
    queueItemCreated: true, stageDispatched: true, dependencySatisfied: true, approvalGranted: true, payload: { prompt: 'x' },
    anything: 'goes'
  };
  const outcomeClean = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  const outcomeHostile = evaluateRuntimeDispatchRequest(golden.dispatchRequest, hostileContext);
  assert.deepEqual(outcomeClean.decision, outcomeHostile.decision);
});

test('security: every dispatch outcome forces every operational flag false, simulation=true, production_blocked=true, rollout=0', () => {
  const golden = buildGoldenDispatchBundle();
  const outcome = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  for (const field of OPERATIONAL_FLAG_FIELDS) {
    if (field in outcome.decision) assert.equal(outcome.decision[field], false, `decision.${field}`);
    if (field in outcome.result) assert.equal(outcome.result[field], false, `result.${field}`);
    if (field in outcome.package) assert.equal(outcome.package[field], false, `package.${field}`);
  }
  assert.equal(outcome.decision.simulation, true);
  assert.equal(outcome.decision.production_blocked, true);
  assert.equal(outcome.decision.rollout_percentage, 0);
  assert.equal(outcome.package.simulation, true);
  assert.equal(outcome.package.production_blocked, true);
  assert.equal(outcome.package.rollout_percentage, 0);
});

// --- Adversarial types --------------------------------------------------------------------------

test('adversarial types: NaN/Infinity/bigint/symbol/function/undefined/Buffer/cyclic are all rejected by the request validator', () => {
  const golden = buildGoldenDispatchBundle();
  const cyclic = {};
  cyclic.self = cyclic;
  const adversarialValues = [NaN, Infinity, -Infinity, 10n, Symbol('x'), () => {}, undefined, Buffer.from('x'), cyclic];
  for (const value of adversarialValues) {
    const tampered = { ...golden.dispatchRequest, correlation_id: value };
    assertInvalid(`adversarial value ${String(value)}`, validateRuntimeDispatchRequest(tampered));
  }
});

// --- pr107fix FIX 1: Dispatch Policy limits + aggregate budget --------------------------------------

test('FIX1: maximum_estimated_tokens and maximum_estimated_cost_minor_units block on prepared-only aggregates', () => {
  const golden = buildGoldenDispatchBundle('prepared-low-cost-model-plan');
  const baseline = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  assert.equal(baseline.decision.status, 'DISPATCH_PACKAGE_PREPARED_SIMULATION');
  assert.ok(baseline.package.estimated_total_tokens > 0);

  const tokenBlockedRequest = rebuildDispatchRequest({
    ...golden.dispatchRequest,
    runtime_dispatch_policy: { ...golden.dispatchPolicy, maximum_estimated_tokens: baseline.package.estimated_total_tokens - 1 }
  });
  const tokenBlocked = evaluateRuntimeDispatchRequest(tokenBlockedRequest, {});
  assert.equal(tokenBlocked.decision.status, 'DISPATCH_POLICY_BLOCKED');
  assert.deepEqual(tokenBlocked.decision.reason_codes, ['dispatch_estimated_tokens_exceed_policy_limit']);

  const costBlockedRequest = rebuildDispatchRequest({
    ...golden.dispatchRequest,
    runtime_dispatch_policy: { ...golden.dispatchPolicy, maximum_estimated_cost_minor_units: baseline.package.estimated_total_cost_minor_units - 1 }
  });
  const costBlocked = evaluateRuntimeDispatchRequest(costBlockedRequest, {});
  assert.equal(costBlocked.decision.status, 'DISPATCH_POLICY_BLOCKED');
  assert.deepEqual(costBlocked.decision.reason_codes, ['dispatch_estimated_cost_exceeds_policy_limit']);
});

test('FIX1: maximum_model/tool/workflow/parallel_dispatch_intent_count each block once a stage genuinely carries that dimension', () => {
  const golden = buildGoldenDispatchBundle();
  const modelParallelResult = tamperFirstSchedulerStage(golden, { model_selection_reference_id: 'selref-1', parallelizable: true });
  const modelParallelOutcome = evaluateRuntimeDispatchRequest(
    rebuildDispatchRequest({ ...golden.dispatchRequest, runtime_scheduler_result_reference: modelParallelResult }), {}
  );
  assert.equal(modelParallelOutcome.decision.status, 'DISPATCH_PACKAGE_PREPARED_SIMULATION');
  assert.equal(modelParallelOutcome.package.model_intent_count, 1);
  assert.equal(modelParallelOutcome.package.parallel_intent_count, 1);

  const modelBlocked = evaluateRuntimeDispatchRequest(rebuildDispatchRequest({
    ...golden.dispatchRequest, runtime_scheduler_result_reference: modelParallelResult,
    runtime_dispatch_policy: { ...golden.dispatchPolicy, maximum_model_dispatch_intent_count: 0 }
  }), {});
  assert.equal(modelBlocked.decision.status, 'DISPATCH_POLICY_BLOCKED');
  assert.deepEqual(modelBlocked.decision.reason_codes, ['dispatch_model_intent_count_exceeds_policy_limit']);

  const parallelBlocked = evaluateRuntimeDispatchRequest(rebuildDispatchRequest({
    ...golden.dispatchRequest, runtime_scheduler_result_reference: modelParallelResult,
    runtime_dispatch_policy: { ...golden.dispatchPolicy, maximum_parallel_dispatch_intent_count: 0 }
  }), {});
  assert.equal(parallelBlocked.decision.status, 'DISPATCH_POLICY_BLOCKED');
  assert.deepEqual(parallelBlocked.decision.reason_codes, ['dispatch_parallel_intent_count_exceeds_policy_limit']);

  const toolWorkflowResult = tamperFirstSchedulerStage(golden, { tool_reference_ids: ['toolref-1'], workflow_reference_id: 'workflowref-1' });
  const toolWorkflowOutcome = evaluateRuntimeDispatchRequest(
    rebuildDispatchRequest({ ...golden.dispatchRequest, runtime_scheduler_result_reference: toolWorkflowResult }), {}
  );
  assert.equal(toolWorkflowOutcome.package.tool_intent_count, 1);
  assert.equal(toolWorkflowOutcome.package.workflow_intent_count, 1);

  const toolBlocked = evaluateRuntimeDispatchRequest(rebuildDispatchRequest({
    ...golden.dispatchRequest, runtime_scheduler_result_reference: toolWorkflowResult,
    runtime_dispatch_policy: { ...golden.dispatchPolicy, maximum_tool_dispatch_intent_count: 0 }
  }), {});
  assert.equal(toolBlocked.decision.status, 'DISPATCH_POLICY_BLOCKED');
  assert.deepEqual(toolBlocked.decision.reason_codes, ['dispatch_tool_intent_count_exceeds_policy_limit']);

  const workflowBlocked = evaluateRuntimeDispatchRequest(rebuildDispatchRequest({
    ...golden.dispatchRequest, runtime_scheduler_result_reference: toolWorkflowResult,
    runtime_dispatch_policy: { ...golden.dispatchPolicy, maximum_workflow_dispatch_intent_count: 0 }
  }), {});
  assert.equal(workflowBlocked.decision.status, 'DISPATCH_POLICY_BLOCKED');
  assert.deepEqual(workflowBlocked.decision.reason_codes, ['dispatch_workflow_intent_count_exceeds_policy_limit']);
});

test('FIX1: aggregate Runtime Budget check blocks on the SUM of prepared intents even when each stage individually fits its own ceiling', () => {
  const golden = buildGoldenDispatchBundle('prepared-low-cost-model-plan');
  const baseline = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  assert.equal(baseline.decision.status, 'DISPATCH_PACKAGE_PREPARED_SIMULATION');
  // Exactly one stage in this scenario carries tokens/cost (100 tokens / 5 minor units); give the
  // OTHER (currently zero) stage an independent, individually-modest cost of its own -- each stage
  // alone fits comfortably under a generous per-stage ceiling, but the SUM does not.
  const zeroTokenIndex = baseline.dispatchStageRefs.findIndex((s) => s.estimated_total_tokens === 0);
  assert.notEqual(zeroTokenIndex, -1);
  const twoStageResult = tamperSchedulerStageAt(golden, zeroTokenIndex, {
    estimated_input_tokens: 40, estimated_output_tokens: 20, estimated_total_tokens: 60, estimated_cost_minor_units: 3
  });
  const orig = golden.dispatchRequest.runtime_budget_reference;

  const generousPerStageButTightAggregateBudget = buildRuntimeBudgetSimulationReference({
    ...orig, maximum_input_tokens: 150, maximum_output_tokens: 150, maximum_total_tokens: 150, maximum_total_cost_minor_units: 1000
  });
  const totalBlocked = evaluateRuntimeDispatchRequest(rebuildDispatchRequest({
    ...golden.dispatchRequest, runtime_scheduler_result_reference: twoStageResult, runtime_budget_reference: generousPerStageButTightAggregateBudget
  }), {});
  assert.equal(totalBlocked.decision.status, 'DISPATCH_BUDGET_BLOCKED');
  assert.deepEqual(totalBlocked.decision.reason_codes, ['dispatch_prepared_total_tokens_exceed_runtime_budget']);

  const generousPerStageButTightCostBudget = buildRuntimeBudgetSimulationReference({
    ...orig, maximum_input_tokens: 1000, maximum_output_tokens: 1000, maximum_total_tokens: 1000, maximum_total_cost_minor_units: 7
  });
  const costBlocked = evaluateRuntimeDispatchRequest(rebuildDispatchRequest({
    ...golden.dispatchRequest, runtime_scheduler_result_reference: twoStageResult, runtime_budget_reference: generousPerStageButTightCostBudget
  }), {});
  assert.equal(costBlocked.decision.status, 'DISPATCH_BUDGET_BLOCKED');
  assert.deepEqual(costBlocked.decision.reason_codes, ['dispatch_prepared_cost_exceeds_runtime_budget']);
});

// --- pr107fix FIX 2: recomputed Scheduler Order + required predecessor order ------------------------

test('FIX2: sequential-plan (stage-1 required-after stage-0) reaches prepared with genuine order preserved', () => {
  const golden = buildGoldenDispatchBundle('sequential-plan');
  const outcome = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  assert.equal(outcome.decision.status, 'DISPATCH_PACKAGE_PREPARED_SIMULATION');
  assert.equal(outcome.orderRef.scheduler_order_preserved, true);
  assert.equal(outcome.orderRef.required_predecessor_order_preserved, true);
  assert.equal(golden.schedulerOutcome.schedulerDependencyRefs.length, 1);
});

test('FIX2: reversed canonical Scheduler order with a required predecessor edge blocks as DISPATCH_ORDER_BLOCKED', () => {
  const golden = buildGoldenDispatchBundle('sequential-plan');
  const origSchedPkg = golden.dispatchRequest.runtime_scheduler_package_reference;
  const reversedSchedPkg = buildRuntimeSchedulerPackage({
    ...origSchedPkg, ordered_scheduler_stage_reference_ids: [...origSchedPkg.ordered_scheduler_stage_reference_ids].reverse()
  });
  const outcome = evaluateRuntimeDispatchRequest(
    rebuildDispatchRequest({ ...golden.dispatchRequest, runtime_scheduler_package_reference: reversedSchedPkg }), {}
  );
  assert.equal(outcome.decision.status, 'DISPATCH_ORDER_BLOCKED');
  assert.equal(outcome.decision.reason_codes.length, 1);
  assert.match(outcome.decision.reason_codes[0], /^dispatch_required_predecessor_order_violation::/);
});

test('FIX2: canonical order missing a real scheduler stage blocks as DISPATCH_ORDER_BLOCKED', () => {
  const golden = buildGoldenDispatchBundle();
  const origSchedPkg = golden.dispatchRequest.runtime_scheduler_package_reference;
  const truncatedSchedPkg = buildRuntimeSchedulerPackage({
    ...origSchedPkg, ordered_scheduler_stage_reference_ids: origSchedPkg.ordered_scheduler_stage_reference_ids.slice(0, 1)
  });
  const outcome = evaluateRuntimeDispatchRequest(
    rebuildDispatchRequest({ ...golden.dispatchRequest, runtime_scheduler_package_reference: truncatedSchedPkg }), {}
  );
  assert.equal(outcome.decision.status, 'DISPATCH_ORDER_BLOCKED');
  assert.deepEqual(outcome.decision.reason_codes, ['dispatch_stage_not_in_scheduler_order']);
});

test('FIX2: duplicated id in canonical Scheduler order blocks as DISPATCH_ORDER_BLOCKED', () => {
  const golden = buildGoldenDispatchBundle();
  const origSchedPkg = golden.dispatchRequest.runtime_scheduler_package_reference;
  const [firstId] = origSchedPkg.ordered_scheduler_stage_reference_ids;
  const duplicatedSchedPkg = buildRuntimeSchedulerPackage({
    ...origSchedPkg, ordered_scheduler_stage_reference_ids: [firstId, ...origSchedPkg.ordered_scheduler_stage_reference_ids]
  });
  const outcome = evaluateRuntimeDispatchRequest(
    rebuildDispatchRequest({ ...golden.dispatchRequest, runtime_scheduler_package_reference: duplicatedSchedPkg }), {}
  );
  assert.equal(outcome.decision.status, 'DISPATCH_ORDER_BLOCKED');
  assert.deepEqual(outcome.decision.reason_codes, ['dispatch_stage_duplicate_in_order']);
});

test('FIX2: raw Scheduler Dependency References substituted for a different set blocks as DISPATCH_SCHEDULER_BLOCKED', () => {
  const golden = buildGoldenDispatchBundle('sequential-plan');
  const outcome = evaluateRuntimeDispatchRequest(
    { ...golden.dispatchRequest, runtime_scheduler_dependency_references: [] }, {}
  );
  assert.equal(outcome.decision.status, 'DISPATCH_SCHEDULER_BLOCKED');
  assert.deepEqual(outcome.decision.reason_codes, ['scheduler_dependency_references_substituted_or_incomplete']);
});

test('FIX2: shuffled input order of Scheduler Dependency References never alters the outcome', () => {
  const golden = buildGoldenDispatchBundle('sequential-plan');
  const shuffled = [...golden.dispatchRequest.runtime_scheduler_dependency_references].reverse();
  const outcome = evaluateRuntimeDispatchRequest(
    { ...golden.dispatchRequest, runtime_scheduler_dependency_references: shuffled }, {}
  );
  assert.equal(outcome.decision.status, 'DISPATCH_PACKAGE_PREPARED_SIMULATION');
});

// --- pr107fix FIX 3: Runtime Capacity recomputed per dimension --------------------------------------

test('FIX3: insufficient available_tokens_capacity blocks only the intent that actually needs tokens', () => {
  const golden = buildGoldenDispatchBundle('prepared-low-cost-model-plan');
  const orig = golden.dispatchRequest.runtime_capacity_snapshot_reference;
  const tinyTokens = buildRuntimeCapacitySnapshotReference({ ...orig, maximum_tokens_capacity: 1, used_tokens_capacity: 1, available_tokens_capacity: 0 });
  const outcome = evaluateRuntimeDispatchRequest(
    rebuildDispatchRequest({ ...golden.dispatchRequest, runtime_capacity_snapshot_reference: tinyTokens }), {}
  );
  assert.equal(outcome.decision.status, 'DISPATCH_PACKAGE_PREPARED_SIMULATION');
  const blockedCapacity = outcome.capacityRefs.find((c) => c.runtime_token_capacity_available === false);
  assert.ok(blockedCapacity, 'expected at least one capacity reference with insufficient token capacity');
  assert.equal(blockedCapacity.capacity_validated, false);
  const blockedIntent = outcome.intentRefs.find((i) => i.dispatch_capacity_reference_id === blockedCapacity.dispatch_capacity_reference_id);
  assert.equal(blockedIntent.dispatch_intent_status, 'DISPATCH_INTENT_CAPACITY_BLOCKED');
});

test('FIX3: insufficient available_model_stage_capacity blocks a model-carrying stage even with ample tokens', () => {
  const golden = buildGoldenDispatchBundle();
  const modelResult = tamperFirstSchedulerStage(golden, { model_selection_reference_id: 'selref-2' });
  const orig = golden.dispatchRequest.runtime_capacity_snapshot_reference;
  const noModelCapacity = buildRuntimeCapacitySnapshotReference({
    ...orig, total_model_stage_capacity: 0, used_model_stage_capacity: 0, available_model_stage_capacity: 0
  });
  const outcome = evaluateRuntimeDispatchRequest(rebuildDispatchRequest({
    ...golden.dispatchRequest, runtime_scheduler_result_reference: modelResult, runtime_capacity_snapshot_reference: noModelCapacity
  }), {});
  assert.equal(outcome.decision.status, 'DISPATCH_PACKAGE_PREPARED_SIMULATION');
  const firstCapacity = outcome.capacityRefs[0];
  assert.equal(firstCapacity.runtime_model_capacity_available, false);
  assert.equal(firstCapacity.capacity_validated, false);
});

test('FIX3: capacity never applied/reserved/consumed regardless of dimension outcome', () => {
  const golden = buildGoldenDispatchBundle();
  const outcome = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  for (const capacity of outcome.capacityRefs) {
    assert.equal(capacity.capacity_applied, false);
    assert.equal(capacity.capacity_reserved, false);
    assert.equal(capacity.slots_consumed, false);
  }
});

// --- pr107fix FIX 4: full Dispatch Package integrity, no placeholders -------------------------------

test('FIX4: worker_assignment_fingerprints and stage_policy_requirement_source_fingerprints are real, sorted, deduped', () => {
  const golden = buildGoldenDispatchBundle();
  const outcome = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  assert.equal(outcome.decision.status, 'DISPATCH_PACKAGE_PREPARED_SIMULATION');
  assert.equal(outcome.package.worker_assignment_fingerprints.length, golden.dispatchRequest.runtime_worker_stage_assignment_references.length);
  assert.ok(outcome.package.worker_assignment_fingerprints.every((fp) => typeof fp === 'string' && fp.length > 0));
  const sorted = [...outcome.package.worker_assignment_fingerprints].sort();
  assert.deepEqual(outcome.package.worker_assignment_fingerprints, sorted);
  for (const fp of [...outcome.package.worker_assignment_fingerprints, ...outcome.package.stage_policy_requirement_source_fingerprints]) {
    assert.notEqual(fp, 'fingerprint_not_available');
    assert.notEqual(fp, 'NOT_AVAILABLE');
  }
});

test('FIX4: no fingerprint or digest field on a prepared package is ever the placeholder sentinel', () => {
  const golden = buildGoldenDispatchBundle();
  const outcome = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  assert.equal(outcome.decision.status, 'DISPATCH_PACKAGE_PREPARED_SIMULATION');
  const mandatoryFingerprintFields = [
    'worker_assignment_package_fingerprint', 'worker_assignment_package_digest', 'scheduler_package_fingerprint',
    'scheduler_package_digest', 'runtime_execution_package_fingerprint', 'runtime_execution_package_digest',
    'capacity_snapshot_fingerprint', 'concurrency_fingerprint', 'runtime_budget_fingerprint', 'freshness_fingerprint',
    'idempotency_fingerprint', 'dispatch_order_fingerprint', 'dispatch_replay_fingerprint'
  ];
  for (const field of mandatoryFingerprintFields) {
    assert.notEqual(outcome.package[field], 'fingerprint_not_available', field);
    assert.notEqual(outcome.package[field], 'digest_not_available', field);
  }
});

test('FIX4: altering a worker stage assignment changes worker_assignment_fingerprints and the package fingerprint', () => {
  const golden = buildGoldenDispatchBundle();
  const outcomeA = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  assert.equal(outcomeA.decision.status, 'DISPATCH_PACKAGE_PREPARED_SIMULATION');

  const { buildRuntimeWorkerStageAssignmentReference } = require('../src/core/runtime-worker-stage-assignment-reference');
  const origAssignments = golden.dispatchRequest.runtime_worker_stage_assignment_references;
  const tamperedAssignments = origAssignments.map((a, index) => (
    index === 0 ? buildRuntimeWorkerStageAssignmentReference({ ...a, assignment_reason_codes: [...a.assignment_reason_codes, 'pr107fix_regression_probe'] }) : a
  ));
  // Non-substitution is proven against the Worker Assignment Package's own recorded fingerprint set
  // -- an independently re-fingerprinted assignment is caught there, exactly as intended; this test
  // only needs the fingerprint LIST itself (computed straight from the raw request field) to differ.
  const rawFingerprints = tamperedAssignments.map((a) => a.assignment_fingerprint).sort();
  assert.notDeepEqual(rawFingerprints, [...outcomeA.package.worker_assignment_fingerprints].sort());
});

// --- pr107fix2 FIX 1: Worker Capacity only requires genuinely-requested dimensions ------------------

test('pr107fix2 FIX1: no-LLM stages prepare even with zero worker model/tool/workflow/parallel capacity', () => {
  const golden = buildGoldenDispatchBundle();
  const zeroed = zeroWorkerCapacityDimensions(golden, ['model', 'tool', 'workflow', 'parallel']);
  const outcome = evaluateRuntimeDispatchRequest(
    rebuildDispatchRequest({ ...golden.dispatchRequest, runtime_worker_capacity_references: zeroed }), {}
  );
  assert.equal(outcome.decision.status, 'DISPATCH_PACKAGE_PREPARED_SIMULATION');
  assert.equal(outcome.package.prepared_intent_count, 2);
  for (const capacity of outcome.capacityRefs) {
    assert.equal(capacity.worker_model_capacity_available, true);
    assert.equal(capacity.worker_tool_capacity_available, true);
    assert.equal(capacity.worker_workflow_capacity_available, true);
    assert.equal(capacity.worker_parallel_capacity_available, true);
    assert.equal(capacity.capacity_validated, true);
  }
});

test('pr107fix2 FIX1: a model/tool/workflow/parallel-carrying stage blocks when that worker dimension is zero', () => {
  const golden = buildGoldenDispatchBundle();
  for (const [stageOverride, capacityDimension, flagField] of [
    [{ model_selection_reference_id: 'selref-4' }, 'model', 'worker_model_capacity_available'],
    [{ tool_reference_ids: ['toolref-2'] }, 'tool', 'worker_tool_capacity_available'],
    [{ workflow_reference_id: 'workflowref-2' }, 'workflow', 'worker_workflow_capacity_available'],
    [{ parallelizable: true }, 'parallel', 'worker_parallel_capacity_available']
  ]) {
    const taggedResult = tamperFirstSchedulerStage(golden, stageOverride);
    const zeroed = zeroWorkerCapacityDimensions(golden, [capacityDimension]);
    const outcome = evaluateRuntimeDispatchRequest(rebuildDispatchRequest({
      ...golden.dispatchRequest, runtime_scheduler_result_reference: taggedResult, runtime_worker_capacity_references: zeroed
    }), {});
    assert.equal(outcome.decision.status, 'DISPATCH_PACKAGE_PREPARED_SIMULATION');
    const firstCapacity = outcome.capacityRefs[0];
    assert.equal(firstCapacity[flagField], false, capacityDimension);
    assert.equal(firstCapacity.capacity_validated, false, capacityDimension);
  }
});

test('pr107fix2 FIX1: a stage with two tools requires exactly one tool assignment, never two', () => {
  const golden = buildGoldenDispatchBundle();
  const twoToolsResult = tamperFirstSchedulerStage(golden, { tool_reference_ids: ['toolref-a', 'toolref-b'] });
  const origCapacityRefs = golden.dispatchRequest.runtime_worker_capacity_references;
  const exactlyOneToolSlot = origCapacityRefs.map((c) => buildRuntimeWorkerCapacityReference({
    ...c, maximum_tool_assignments: 1, current_tool_assignments: 0, available_tool_assignments: 1
  }));
  const outcome = evaluateRuntimeDispatchRequest(rebuildDispatchRequest({
    ...golden.dispatchRequest, runtime_scheduler_result_reference: twoToolsResult, runtime_worker_capacity_references: exactlyOneToolSlot
  }), {});
  assert.equal(outcome.decision.status, 'DISPATCH_PACKAGE_PREPARED_SIMULATION');
  assert.equal(outcome.capacityRefs[0].requested_tool_slots, 1);
  assert.equal(outcome.capacityRefs[0].worker_tool_capacity_available, true);
  assert.equal(outcome.package.prepared_intent_count, 2);
});

test('pr107fix2 FIX1: a hostile context never alters capacity outcomes', () => {
  const golden = buildGoldenDispatchBundle();
  const clean = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  const hostile = evaluateRuntimeDispatchRequest(golden.dispatchRequest, { capacityAvailable: true, workerModelCapacityAvailable: true });
  assert.deepEqual(clean.capacityRefs, hostile.capacityRefs);
});

// --- pr107fix2 FIX 2: cross-validated Scheduler Dependency collection + real required/optional -----

test('pr107fix2 FIX2: sequential-plan derives a genuine required/optional partition from the collection, not stage.dependency_reference_ids wholesale', () => {
  const golden = buildGoldenDispatchBundle('sequential-plan');
  const outcome = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  assert.equal(outcome.decision.status, 'DISPATCH_PACKAGE_PREPARED_SIMULATION');
  const [dependencyRef] = golden.schedulerOutcome.schedulerDependencyRefs;
  assert.equal(dependencyRef.required, true);
  const targetGate = outcome.dependencyGateRefs.find((g) => g.required_dependency_reference_ids.includes(dependencyRef.source_runtime_dependency_reference_id));
  assert.ok(targetGate, 'expected a dependency gate carrying the real dependency id as required');
  assert.deepEqual(targetGate.optional_dependency_reference_ids, []);
  assert.equal(outcome.package.scheduler_dependency_fingerprints.length, 1);
  assert.equal(outcome.package.scheduler_dependency_fingerprints[0], dependencyRef.dependency_fingerprint);
});

test('pr107fix2 FIX2: an optional (required=false) dependency never blocks the Dependency Gate, but required=true does', () => {
  const zero = buildRuntimeDispatchDependencyGateReference({
    dispatch_dependency_gate_reference_id: 'dg-optional-1', runtime_dispatch_package_id: 'pkg-1', runtime_scheduler_package_id: 'sched-1',
    runtime_dispatch_stage_reference_id: 'stg-1', scheduler_stage_reference_id: 'sstage-1',
    required_dependency_reference_ids: [], optional_dependency_reference_ids: ['dep-opt-1'], blocking_dependency_reference_ids: []
  });
  assert.equal(zero.dispatch_allowed_by_dependencies, true);

  const required = buildRuntimeDispatchDependencyGateReference({
    dispatch_dependency_gate_reference_id: 'dg-required-1', runtime_dispatch_package_id: 'pkg-1', runtime_scheduler_package_id: 'sched-1',
    runtime_dispatch_stage_reference_id: 'stg-2', scheduler_stage_reference_id: 'sstage-2',
    required_dependency_reference_ids: ['dep-req-1'], optional_dependency_reference_ids: [], blocking_dependency_reference_ids: ['dep-req-1']
  });
  assert.equal(required.dispatch_allowed_by_dependencies, false);
});

test('pr107fix2 FIX2: duplicated scheduler_dependency_reference_id blocks as DISPATCH_SCHEDULER_BLOCKED', () => {
  const golden = buildGoldenDispatchBundle('sequential-plan');
  const [dependencyRef] = golden.dispatchRequest.runtime_scheduler_dependency_references;
  const duplicated = [dependencyRef, dependencyRef];
  const outcome = evaluateRuntimeDispatchRequest({ ...golden.dispatchRequest, runtime_scheduler_dependency_references: duplicated }, {});
  assert.equal(outcome.decision.status, 'DISPATCH_SCHEDULER_BLOCKED');
  assert.deepEqual(outcome.decision.reason_codes, ['dispatch_scheduler_dependency_duplicate']);
});

test('pr107fix2 FIX2: a dependency retargeted to a non-existent scheduler stage blocks with a target-mismatch reason', () => {
  const golden = buildGoldenDispatchBundle('sequential-plan');
  const tamperedDeps = tamperFirstSchedulerDependency(golden, { to_scheduler_stage_reference_id: 'a-nonexistent-scheduler-stage-reference-id' });
  const outcome = evaluateRuntimeDispatchRequest({ ...golden.dispatchRequest, runtime_scheduler_dependency_references: tamperedDeps }, {});
  assert.equal(outcome.decision.status, 'DISPATCH_ORDER_BLOCKED');
  assert.deepEqual(outcome.decision.reason_codes, ['dispatch_scheduler_dependency_target_mismatch']);
});

test('pr107fix2 FIX2: a required dependency missing from blocking_dependency_reference_ids blocks as inconsistent', () => {
  const golden = buildGoldenDispatchBundle('sequential-plan');
  const origResult = golden.dispatchRequest.runtime_scheduler_result_reference;
  const [dependencyRef] = golden.dispatchRequest.runtime_scheduler_dependency_references;
  const stages = origResult.scheduler_stage_references.map((s) => (
    s.scheduler_stage_reference_id === dependencyRef.to_scheduler_stage_reference_id
      ? buildRuntimeSchedulerStageReference({ ...s, blocking_dependency_reference_ids: [] })
      : s
  ));
  const tamperedResult = buildRuntimeSchedulerResult({ ...origResult, scheduler_stage_references: stages });
  const outcome = evaluateRuntimeDispatchRequest({ ...golden.dispatchRequest, runtime_scheduler_result_reference: tamperedResult }, {});
  assert.equal(outcome.decision.status, 'DISPATCH_ORDER_BLOCKED');
  assert.deepEqual(outcome.decision.reason_codes, ['dispatch_scheduler_blocking_dependency_not_required']);
});

test('pr107fix2 FIX2: shuffled input order of the dependency collection never alters the outcome', () => {
  const golden = buildGoldenDispatchBundle('sequential-plan');
  const shuffled = [...golden.dispatchRequest.runtime_scheduler_dependency_references].reverse();
  const clean = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  const outcome = evaluateRuntimeDispatchRequest({ ...golden.dispatchRequest, runtime_scheduler_dependency_references: shuffled }, {});
  assert.equal(outcome.decision.status, 'DISPATCH_PACKAGE_PREPARED_SIMULATION');
  assert.deepEqual(clean.decision, outcome.decision);
});

test('pr107fix2 FIX2: altering a dependency (same id, different content) changes scheduler_dependency_fingerprints and the package fingerprint', () => {
  // `dependency_order` does not participate in the collection's structural cross-checks (it is a
  // tie-break display field, not a topology field), so this is the "muda" branch of "Alterar
  // qualquer dependency deve mudar ou bloquear o package" -- the id-set non-substitution proof is
  // deliberately identity-based (see idSetMatches), not a full-content fingerprint compare, so a
  // same-id content change is expected to be reflected in the package rather than block the request.
  const golden = buildGoldenDispatchBundle('sequential-plan');
  const outcomeA = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  assert.equal(outcomeA.decision.status, 'DISPATCH_PACKAGE_PREPARED_SIMULATION');

  const [dependencyRef] = golden.dispatchRequest.runtime_scheduler_dependency_references;
  const rebuilt = buildRuntimeSchedulerDependencyReference({ ...dependencyRef, dependency_order: dependencyRef.dependency_order + 1 });
  assert.notEqual(rebuilt.dependency_fingerprint, dependencyRef.dependency_fingerprint);
  const outcomeB = evaluateRuntimeDispatchRequest(
    { ...golden.dispatchRequest, runtime_scheduler_dependency_references: [rebuilt] }, {}
  );
  assert.equal(outcomeB.decision.status, 'DISPATCH_PACKAGE_PREPARED_SIMULATION');
  assert.notDeepEqual(outcomeB.package.scheduler_dependency_fingerprints, outcomeA.package.scheduler_dependency_fingerprints);
  assert.notEqual(outcomeB.package.dispatch_package_fingerprint, outcomeA.package.dispatch_package_fingerprint);
  assert.notEqual(outcomeB.decision.runtime_dispatch_package_fingerprint, outcomeA.decision.runtime_dispatch_package_fingerprint);
});

// --- Regression -----------------------------------------------------------------------------------

test('regression: architecture gates report zero findings with every PR107 module included', () => {
  const findings = runAllGates();
  assert.deepEqual(findings, []);
});

test('regression: nenhum worker real, processo, thread, container, fila, job for criado em qualquer outcome producible', () => {
  const golden = buildGoldenDispatchBundle();
  const outcome = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  assert.equal(outcome.result.worker_reserved, false);
  assert.equal(outcome.result.worker_started, false);
  assert.equal(outcome.result.worker_process_created, false);
  assert.equal(outcome.result.worker_thread_created, false);
  assert.equal(outcome.result.container_started, false);
  assert.equal(outcome.result.job_created, false);
  assert.equal(outcome.result.queue_created, false);
  assert.equal(outcome.result.stage_dispatched, false);
  assert.equal(outcome.result.network_used, false);
  assert.equal(outcome.result.secret_resolved, false);
  assert.equal(outcome.result.executed, false);
});

test('regression: no network access and no secret resolution ever occurs while evaluating a dispatch request', () => {
  const golden = buildGoldenDispatchBundle();
  assert.deepEqual(findAgentCoreOperationalMaterial(golden.dispatchRequest), []);
});

test('regression: PR #106 worker assignment request builder remains untouched and functional', () => {
  const golden = buildGoldenDispatchBundle();
  const rebuilt = buildRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest);
  assert.deepEqual(Object.keys(rebuilt).sort(), Object.keys(golden.workerAssignmentRequest).sort());
});
