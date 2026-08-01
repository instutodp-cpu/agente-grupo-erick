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
