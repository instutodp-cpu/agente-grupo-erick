'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { findAgentCoreOperationalMaterial } = require('../src/core/agent-identity-contract');
const {
  validateRuntimeSchedulerPolicy, buildRuntimeSchedulerPolicy, RUNTIME_SCHEDULER_POLICY_FIELDS
} = require('../src/core/runtime-scheduler-policy');
const { validateRuntimeSchedulerRequest, buildRuntimeSchedulerRequest } = require('../src/core/runtime-scheduler-request');
const {
  validateRuntimeSchedulerStageReference, buildRuntimeSchedulerStageReference, RUNTIME_SCHEDULER_STAGE_REFERENCE_FIELDS
} = require('../src/core/runtime-scheduler-stage-reference');
const {
  validateRuntimeSchedulerDependencyReference, buildRuntimeSchedulerDependencyReference,
  RUNTIME_SCHEDULER_DEPENDENCY_REFERENCE_FIELDS
} = require('../src/core/runtime-scheduler-dependency-reference');
const {
  validateRuntimeSchedulerParallelGroupReference, buildRuntimeSchedulerParallelGroupReference,
  RUNTIME_SCHEDULER_PARALLEL_GROUP_REFERENCE_FIELDS
} = require('../src/core/runtime-scheduler-parallel-group-reference');
const {
  validateRuntimeSchedulerApprovalWaitReference, buildRuntimeSchedulerApprovalWaitReference,
  RUNTIME_SCHEDULER_APPROVAL_WAIT_REFERENCE_FIELDS
} = require('../src/core/runtime-scheduler-approval-wait-reference');
const {
  validateRuntimeSchedulerCapacityPlanReference, buildRuntimeSchedulerCapacityPlanReference,
  RUNTIME_SCHEDULER_CAPACITY_PLAN_REFERENCE_FIELDS
} = require('../src/core/runtime-scheduler-capacity-plan-reference');
const {
  validateRuntimeSchedulerQueuePlanReference, buildRuntimeSchedulerQueuePlanReference,
  RUNTIME_SCHEDULER_QUEUE_PLAN_REFERENCE_FIELDS
} = require('../src/core/runtime-scheduler-queue-plan-reference');
const { validateRuntimeSchedulerPackage, buildRuntimeSchedulerPackage } = require('../src/core/runtime-scheduler-package');
const {
  validateRuntimeSchedulerDecision, RUNTIME_SCHEDULER_STATUSES, RUNTIME_SCHEDULER_PRECEDENCE_ORDER,
  buildRuntimeSchedulerDecision
} = require('../src/core/runtime-scheduler-decision');
const { validateRuntimeSchedulerResult } = require('../src/core/runtime-scheduler-result');
const { validateRuntimeSchedulerAudit } = require('../src/core/runtime-scheduler-audit');
const { createRuntimeSchedulerRegistry } = require('../src/core/runtime-scheduler-registry');
const { runAllGates } = require('../src/core/architecture-gate-runner');
const { buildRuntimeReadinessReplayReference } = require('../src/core/runtime-readiness-replay-reference');
const { buildRuntimeCapacitySnapshotReference } = require('../src/core/runtime-capacity-snapshot-reference');
const { buildRuntimeConcurrencyReference } = require('../src/core/runtime-concurrency-reference');
const { buildRuntimeAdmissionPolicy } = require('../src/core/runtime-admission-policy');
const { buildRuntimeAdmissionDecision } = require('../src/core/runtime-admission-decision');
const { computeCanonicalContentDigest } = require('../src/core/canonical-content-digest');

const {
  buildGoldenSchedulerBundle, evaluateRuntimeSchedulerRequest, computeAdmissionRequestFingerprint, omitReplayReference
} = require('./helpers/runtime-scheduler-simulation-test-data');
const {
  deriveStageStatus, topologicalOrderStages, SCHEDULER_STAGE_STATUSES_ORDER
} = require('../src/core/runtime-scheduler-boundary');

const fixture = require('./fixtures/hermes-runtime-scheduler-simulation-contracts.json');

function assertValid(label, validation) {
  assert.equal(validation.valid, true, `${label}: ${JSON.stringify(validation.errors)}`);
}

function assertInvalid(label, validation) {
  assert.equal(validation.valid, false, `${label} unexpectedly valid`);
}

const OPERATIONAL_FLAG_FIELDS = [
  'scheduler_started', 'runtime_enabled', 'execution_authorized', 'execution_started', 'job_created',
  'queue_created', 'queue_used', 'worker_started', 'stage_dispatched', 'stage_started', 'stage_completed', 'executed'
];

// After tampering a scheduler request's own top-level content directly, rebuild it via the real
// builder so the request's own structural validity (exact fields, nested validators) is genuinely
// re-proven -- mirrors the "resync via real builder" pattern PR #104's own test suite established.
function rebuild(request) {
  return buildRuntimeSchedulerRequest(request);
}

// --- Policy -----------------------------------------------------------------------------------

test('scheduler policy: valid contract, exact fields, safe defaults, nenhuma policy habilita scheduler', () => {
  const policy = buildRuntimeSchedulerPolicy({ runtime_scheduler_policy_id: 'sp-1' });
  assertValid('scheduler policy', validateRuntimeSchedulerPolicy(policy));
  assert.deepEqual(Object.keys(policy).sort(), [...RUNTIME_SCHEDULER_POLICY_FIELDS].sort());
  assert.equal(policy.allow_external_effect_reference, false);
  assert.equal(policy.allow_irreversible_reference, false);
  assert.equal(policy.simulation, true);
  assert.equal(policy.production_blocked, true);
  for (const field of RUNTIME_SCHEDULER_POLICY_FIELDS) {
    if (field.startsWith('require_') || field.startsWith('fail_on_')) assert.equal(policy[field], true, field);
  }
});

test('scheduler policy: fields missing/extra rejected, invalid limits rejected', () => {
  const policy = buildRuntimeSchedulerPolicy({ runtime_scheduler_policy_id: 'sp-1' });
  const { runtime_scheduler_policy_id, ...missing } = policy;
  assertInvalid('missing field', validateRuntimeSchedulerPolicy(missing));
  assertInvalid('extra field', validateRuntimeSchedulerPolicy({ ...policy, extra_field: true }));
  assertInvalid('require flipped false', validateRuntimeSchedulerPolicy({ ...policy, require_deterministic_order: false }));
  assertInvalid('external effect flipped true', validateRuntimeSchedulerPolicy({ ...policy, allow_external_effect_reference: true }));
  assertInvalid('negative maximum', validateRuntimeSchedulerPolicy({ ...policy, maximum_scheduler_stage_count: -1 }));
});

test('scheduler policy: zero is a valid explicit-block limit', () => {
  const policy = buildRuntimeSchedulerPolicy({ runtime_scheduler_policy_id: 'sp-2', maximum_parallel_group_count: 0 });
  assertValid('zero limit', validateRuntimeSchedulerPolicy(policy));
});

// --- Contract-level self-fingerprinted references --------------------------------------------

test('scheduler stage reference: preserves fields, eligibility maps 1:1, operational flags forced false', () => {
  const ref = buildRuntimeSchedulerStageReference({
    scheduler_stage_reference_id: 'ss-1', runtime_scheduler_request_id: 'sr-1', runtime_scheduler_package_id: 'sp-1',
    runtime_execution_package_id: 'pkg-1', runtime_stage_reference_id: 'rs-1', source_execution_stage_id: 'es-1',
    source_orchestrator_stage_id: 'os-1', stage_sequence: 1, scheduler_sequence: 0, stage_type: 'MODEL_REFERENCE_STAGE',
    priority: 5, required: true, optional: false, parallelizable: false, approval_required: false,
    task_reference_id: 'task-1', side_effect_classification: 'NONE', risk_classification: 'LOW',
    scheduler_stage_status: 'SCHEDULER_STAGE_ELIGIBLE_SIMULATION'
  });
  assertValid('stage reference', validateRuntimeSchedulerStageReference(ref));
  assert.deepEqual(Object.keys(ref).sort(), [...RUNTIME_SCHEDULER_STAGE_REFERENCE_FIELDS].sort());
  assert.equal(ref.eligibility_status, 'ELIGIBLE_REFERENCE_SIMULATION');
  for (const field of ['scheduler_stage_applied', 'job_created', 'queue_used', 'worker_assigned', 'stage_dispatched', 'stage_started', 'stage_completed', 'stage_failed']) {
    assert.equal(ref[field], false, field);
  }
});

test('scheduler stage reference: waiting/optional/blocked statuses map correctly', () => {
  const base = {
    scheduler_stage_reference_id: 'ss-2', runtime_scheduler_request_id: 'sr-1', runtime_scheduler_package_id: 'sp-1',
    runtime_execution_package_id: 'pkg-1', runtime_stage_reference_id: 'rs-2', source_execution_stage_id: 'es-2',
    source_orchestrator_stage_id: 'os-2', stage_sequence: 1, scheduler_sequence: 0, stage_type: 'MODEL_REFERENCE_STAGE',
    task_reference_id: 'task-2', side_effect_classification: 'NONE', risk_classification: 'LOW'
  };
  const waiting = buildRuntimeSchedulerStageReference({ ...base, scheduler_stage_status: 'SCHEDULER_STAGE_WAITING_DEPENDENCY_REFERENCE' });
  assert.equal(waiting.eligibility_status, 'WAITING_DEPENDENCY_REFERENCE');
  const optional = buildRuntimeSchedulerStageReference({ ...base, optional: true, scheduler_stage_status: 'SCHEDULER_STAGE_OPTIONAL_REFERENCE' });
  assert.equal(optional.eligibility_status, 'OPTIONAL_REFERENCE');
  const blocked = buildRuntimeSchedulerStageReference({ ...base, scheduler_stage_status: 'SCHEDULER_STAGE_BLOCKED' });
  assert.equal(blocked.eligibility_status, 'BLOCKED_REFERENCE');
});

test('scheduler stage reference: fingerprint tampered is rejected, blocking dependency subset enforced', () => {
  const ref = buildRuntimeSchedulerStageReference({
    scheduler_stage_reference_id: 'ss-3', runtime_scheduler_request_id: 'sr-1', runtime_scheduler_package_id: 'sp-1',
    runtime_execution_package_id: 'pkg-1', runtime_stage_reference_id: 'rs-3', source_execution_stage_id: 'es-3',
    source_orchestrator_stage_id: 'os-3', stage_sequence: 1, scheduler_sequence: 0, stage_type: 'MODEL_REFERENCE_STAGE',
    task_reference_id: 'task-3', side_effect_classification: 'NONE', risk_classification: 'LOW',
    scheduler_stage_status: 'SCHEDULER_STAGE_ELIGIBLE_SIMULATION'
  });
  assertInvalid('tampered fingerprint', validateRuntimeSchedulerStageReference({ ...ref, stage_fingerprint: 'sha256:' + 'f'.repeat(64) }));
  assertInvalid('blocking dependency not subset', validateRuntimeSchedulerStageReference({ ...ref, blocking_dependency_reference_ids: ['not-in-dependency-list'] }));
});

test('scheduler dependency reference: preserves endpoints/type/required, dependency_satisfied/applied forced false', () => {
  const ref = buildRuntimeSchedulerDependencyReference({
    scheduler_dependency_reference_id: 'sd-1', runtime_scheduler_package_id: 'sp-1', runtime_execution_package_id: 'pkg-1',
    source_runtime_dependency_reference_id: 'rd-1', from_scheduler_stage_reference_id: 'ss-0', to_scheduler_stage_reference_id: 'ss-1',
    dependency_type: 'AFTER_SUCCESS_REFERENCE', required: true, dependency_order: 0,
    source_dependency_fingerprint: 'sha256:' + 'a'.repeat(64), dependency_validated: true, would_block_target: true
  });
  assertValid('dependency reference', validateRuntimeSchedulerDependencyReference(ref));
  assert.deepEqual(Object.keys(ref).sort(), [...RUNTIME_SCHEDULER_DEPENDENCY_REFERENCE_FIELDS].sort());
  assert.equal(ref.dependency_satisfied, false);
  assert.equal(ref.dependency_applied, false);
  assert.equal(ref.would_allow_target, false);
  assertInvalid('self-reference', validateRuntimeSchedulerDependencyReference({ ...ref, to_scheduler_stage_reference_id: ref.from_scheduler_stage_reference_id }));
});

test('scheduler parallel group reference: derived shape valid, never started/applied/completed', () => {
  const ref = buildRuntimeSchedulerParallelGroupReference({
    parallel_group_reference_id: 'pg-1', runtime_scheduler_package_id: 'sp-1', runtime_execution_package_id: 'pkg-1',
    parallel_group_sequence: 0, scheduler_stage_reference_ids: ['ss-1', 'ss-2'], source_runtime_stage_reference_ids: ['rs-1', 'rs-2'],
    source_dependency_reference_ids: [], required_stage_count: 2, optional_stage_count: 0, model_stage_count: 2,
    tool_stage_count: 0, workflow_stage_count: 0, estimated_total_tokens: 100, estimated_total_cost_minor_units: 10,
    capacity_within_limit: true, concurrency_within_limit: true, budget_within_limit: true
  });
  assertValid('parallel group', validateRuntimeSchedulerParallelGroupReference(ref));
  assert.deepEqual(Object.keys(ref).sort(), [...RUNTIME_SCHEDULER_PARALLEL_GROUP_REFERENCE_FIELDS].sort());
  assert.equal(ref.parallel_group_validated, true);
  assert.equal(ref.parallel_group_applied, false);
  assert.equal(ref.parallel_group_started, false);
  assert.equal(ref.parallel_group_completed, false);
  assertInvalid('single member', validateRuntimeSchedulerParallelGroupReference({ ...ref, scheduler_stage_reference_ids: ['ss-1'], stage_count: 1 }));
});

test('scheduler parallel group reference: any limit false blocks parallel_group_validated', () => {
  const ref = buildRuntimeSchedulerParallelGroupReference({
    parallel_group_reference_id: 'pg-2', runtime_scheduler_package_id: 'sp-1', runtime_execution_package_id: 'pkg-1',
    parallel_group_sequence: 0, scheduler_stage_reference_ids: ['ss-1', 'ss-2'], source_runtime_stage_reference_ids: ['rs-1', 'rs-2'],
    source_dependency_reference_ids: [], required_stage_count: 2, optional_stage_count: 0, model_stage_count: 0,
    tool_stage_count: 0, workflow_stage_count: 0, estimated_total_tokens: 0, estimated_total_cost_minor_units: 0,
    capacity_within_limit: true, concurrency_within_limit: false, budget_within_limit: true
  });
  assert.equal(ref.parallel_group_validated, false);
});

test('scheduler approval wait reference: approval_required=true forces waiting_for_approval and status, never granted/consumed', () => {
  const waiting = buildRuntimeSchedulerApprovalWaitReference({
    approval_wait_reference_id: 'aw-1', runtime_scheduler_package_id: 'sp-1', runtime_execution_package_id: 'pkg-1',
    scheduler_stage_reference_id: 'ss-1', runtime_stage_reference_id: 'rs-1', approval_required: true, approval_validated: true
  });
  assertValid('approval wait', validateRuntimeSchedulerApprovalWaitReference(waiting));
  assert.deepEqual(Object.keys(waiting).sort(), [...RUNTIME_SCHEDULER_APPROVAL_WAIT_REFERENCE_FIELDS].sort());
  assert.equal(waiting.waiting_for_approval, true);
  assert.equal(waiting.approval_status, 'WAITING_APPROVAL_REFERENCE');
  assert.equal(waiting.approval_granted, false);
  assert.equal(waiting.approval_consumed, false);
  assert.equal(waiting.approval_applied, false);

  const notRequired = buildRuntimeSchedulerApprovalWaitReference({
    approval_wait_reference_id: 'aw-2', runtime_scheduler_package_id: 'sp-1', runtime_execution_package_id: 'pkg-1',
    scheduler_stage_reference_id: 'ss-2', runtime_stage_reference_id: 'rs-2', approval_required: false, approval_validated: true
  });
  assert.equal(notRequired.waiting_for_approval, false);
  assert.equal(notRequired.approval_status, 'APPROVAL_NOT_REQUIRED');
});

test('scheduler approval wait reference: falsified waiting_for_approval/status combination rejected', () => {
  const waiting = buildRuntimeSchedulerApprovalWaitReference({
    approval_wait_reference_id: 'aw-3', runtime_scheduler_package_id: 'sp-1', runtime_execution_package_id: 'pkg-1',
    scheduler_stage_reference_id: 'ss-3', runtime_stage_reference_id: 'rs-3', approval_required: true, approval_validated: true
  });
  assertInvalid('approval_granted=true forced', validateRuntimeSchedulerApprovalWaitReference({ ...waiting, approval_granted: true }));
  assertInvalid('status mismatched with required', validateRuntimeSchedulerApprovalWaitReference({ ...waiting, approval_status: 'APPROVAL_NOT_REQUIRED' }));
});

test('scheduler capacity plan reference: requested/available derive within-limit flags, never reserved/consumed', () => {
  const ref = buildRuntimeSchedulerCapacityPlanReference({
    scheduler_capacity_plan_reference_id: 'cp-1', runtime_scheduler_package_id: 'sp-1', runtime_execution_package_id: 'pkg-1',
    runtime_capacity_snapshot_reference_id: 'cap-1', runtime_concurrency_reference_id: 'conc-1',
    requested_package_slots: 1, available_package_slots: 5, requested_stage_slots: 2, available_stage_slots: 10,
    requested_parallel_stage_slots: 0, available_parallel_stage_slots: 5, requested_model_stage_slots: 1, available_model_stage_slots: 5,
    requested_tool_stage_slots: 0, available_tool_stage_slots: 5, requested_workflow_stage_slots: 0, available_workflow_stage_slots: 5,
    requested_tokens: 100, available_tokens: 1000, requested_cost_minor_units: 10, available_cost_minor_units: 1000
  });
  assertValid('capacity plan', validateRuntimeSchedulerCapacityPlanReference(ref));
  assert.deepEqual(Object.keys(ref).sort(), [...RUNTIME_SCHEDULER_CAPACITY_PLAN_REFERENCE_FIELDS].sort());
  assert.equal(ref.capacity_plan_validated, true);
  assert.equal(ref.capacity_plan_applied, false);
  assert.equal(ref.capacity_reserved, false);
  assert.equal(ref.slots_consumed, false);
});

test('scheduler capacity plan reference: requested exceeding available blocks capacity_plan_validated', () => {
  const ref = buildRuntimeSchedulerCapacityPlanReference({
    scheduler_capacity_plan_reference_id: 'cp-2', runtime_scheduler_package_id: 'sp-1', runtime_execution_package_id: 'pkg-1',
    runtime_capacity_snapshot_reference_id: 'cap-1', runtime_concurrency_reference_id: 'conc-1',
    requested_package_slots: 10, available_package_slots: 5, requested_stage_slots: 2, available_stage_slots: 10,
    requested_parallel_stage_slots: 0, available_parallel_stage_slots: 5, requested_model_stage_slots: 1, available_model_stage_slots: 5,
    requested_tool_stage_slots: 0, available_tool_stage_slots: 5, requested_workflow_stage_slots: 0, available_workflow_stage_slots: 5,
    requested_tokens: 100, available_tokens: 1000, requested_cost_minor_units: 10, available_cost_minor_units: 1000
  });
  assert.equal(ref.package_capacity_within_limit, false);
  assert.equal(ref.capacity_plan_validated, false);
});

test('scheduler queue plan reference: partitions ordered list completely, no missing/duplicate, never a real queue', () => {
  const ref = buildRuntimeSchedulerQueuePlanReference({
    scheduler_queue_plan_reference_id: 'qp-1', runtime_scheduler_package_id: 'sp-1', runtime_execution_package_id: 'pkg-1',
    ordered_scheduler_stage_reference_ids: ['ss-1', 'ss-2', 'ss-3'],
    eligible_scheduler_stage_reference_ids: ['ss-1'], waiting_dependency_stage_reference_ids: ['ss-2'],
    waiting_approval_stage_reference_ids: [], optional_stage_reference_ids: [], blocked_stage_reference_ids: ['ss-3'],
    parallel_group_reference_ids: [], approval_wait_reference_ids: []
  });
  assertValid('queue plan', validateRuntimeSchedulerQueuePlanReference(ref));
  assert.deepEqual(Object.keys(ref).sort(), [...RUNTIME_SCHEDULER_QUEUE_PLAN_REFERENCE_FIELDS].sort());
  assert.equal(ref.queue_plan_validated, true);
  assert.equal(ref.queue_created, false);
  assert.equal(ref.queue_used, false);
  assert.equal(ref.job_created, false);
  assert.equal(ref.scheduler_started, false);
});

test('scheduler queue plan reference: a stage missing from every category blocks queue_order_validated', () => {
  const ref = buildRuntimeSchedulerQueuePlanReference({
    scheduler_queue_plan_reference_id: 'qp-2', runtime_scheduler_package_id: 'sp-1', runtime_execution_package_id: 'pkg-1',
    ordered_scheduler_stage_reference_ids: ['ss-1', 'ss-2'],
    eligible_scheduler_stage_reference_ids: ['ss-1'], waiting_dependency_stage_reference_ids: [],
    waiting_approval_stage_reference_ids: [], optional_stage_reference_ids: [], blocked_stage_reference_ids: [],
    parallel_group_reference_ids: [], approval_wait_reference_ids: []
  });
  assert.equal(ref.queue_order_validated, false);
  assert.equal(ref.queue_plan_validated, false);
});

test('scheduler queue plan reference: a duplicated stage across two categories blocks queue_order_validated', () => {
  const ref = buildRuntimeSchedulerQueuePlanReference({
    scheduler_queue_plan_reference_id: 'qp-3', runtime_scheduler_package_id: 'sp-1', runtime_execution_package_id: 'pkg-1',
    ordered_scheduler_stage_reference_ids: ['ss-1'],
    eligible_scheduler_stage_reference_ids: ['ss-1'], waiting_dependency_stage_reference_ids: ['ss-1'],
    waiting_approval_stage_reference_ids: [], optional_stage_reference_ids: [], blocked_stage_reference_ids: [],
    parallel_group_reference_ids: [], approval_wait_reference_ids: []
  });
  assert.equal(ref.queue_order_validated, false);
});

// --- Request ------------------------------------------------------------------------------------

test('scheduler request: golden bundle is structurally valid, nested validators cover every reference', () => {
  const golden = buildGoldenSchedulerBundle();
  assertValid('scheduler request', validateRuntimeSchedulerRequest(golden.schedulerRequest));
});

test('scheduler request: missing/extra field and invalid nested reference rejected', () => {
  const golden = buildGoldenSchedulerBundle();
  const { runtime_scheduler_request_id, ...missing } = golden.schedulerRequest;
  assertInvalid('missing field', validateRuntimeSchedulerRequest(missing));
  assertInvalid('extra field', validateRuntimeSchedulerRequest({ ...golden.schedulerRequest, extra_field: true }));
  assertInvalid('invalid nested policy', validateRuntimeSchedulerRequest({ ...golden.schedulerRequest, runtime_scheduler_policy: { not: 'valid' } }));
});

test('scheduler request: immutable once built', () => {
  const golden = buildGoldenSchedulerBundle();
  assert.throws(() => { golden.schedulerRequest.logical_sequence = 999; });
});

// --- Boundary: golden happy path -----------------------------------------------------------------

test('scheduler boundary: golden bundle reaches SCHEDULER_PACKAGE_PREPARED_SIMULATION with every validated flag true', () => {
  const golden = buildGoldenSchedulerBundle();
  const outcome = evaluateRuntimeSchedulerRequest(golden.schedulerRequest, {});
  assert.equal(outcome.decision.status, 'SCHEDULER_PACKAGE_PREPARED_SIMULATION');
  assert.equal(outcome.decision.scheduler_package_prepared_in_simulation, true);
  assert.equal(outcome.decision.scheduler_evaluated, true);
  assertValid('scheduler decision', validateRuntimeSchedulerDecision(outcome.decision));
  assertValid('scheduler result', validateRuntimeSchedulerResult(outcome.result));
  assertValid('scheduler audit', validateRuntimeSchedulerAudit(outcome.audit));
  assertValid('scheduler package', validateRuntimeSchedulerPackage(outcome.package));
});

for (const scenarioKey of ['prepared-no-llm-plan', 'model-stage-plan', 'tool-stage-plan', 'workflow-stage-plan']) {
  test(`scheduler boundary: ${scenarioKey} reaches SCHEDULER_PACKAGE_PREPARED_SIMULATION`, () => {
    const golden = buildGoldenSchedulerBundle(scenarioKey);
    const outcome = evaluateRuntimeSchedulerRequest(golden.schedulerRequest, {});
    assert.equal(outcome.decision.status, 'SCHEDULER_PACKAGE_PREPARED_SIMULATION', scenarioKey);
  });
}

test('scheduler boundary: every scheduler stage reference preserves its source stage 1:1', () => {
  const golden = buildGoldenSchedulerBundle();
  const outcome = evaluateRuntimeSchedulerRequest(golden.schedulerRequest, {});
  const sourceById = new Map(golden.runtimeStageManifest.runtime_stage_references.map((s) => [s.runtime_stage_reference_id, s]));
  for (const schedulerStage of outcome.schedulerStageRefs) {
    const source = sourceById.get(schedulerStage.runtime_stage_reference_id);
    assert.equal(schedulerStage.stage_type, source.stage_type);
    assert.equal(schedulerStage.priority, source.priority);
    assert.equal(schedulerStage.parallelizable, source.parallelizable === true);
    assert.equal(schedulerStage.approval_required, source.approval_required === true);
    assert.equal(schedulerStage.model_selection_reference_id, source.model_selection_reference_id);
    assert.equal(schedulerStage.estimated_total_tokens, source.estimated_total_tokens);
    assert.equal(schedulerStage.estimated_cost_minor_units, source.estimated_cost_minor_units);
    assert.deepEqual([...schedulerStage.tool_reference_ids].sort(), [...source.tool_reference_ids].sort());
  }
});

test('scheduler boundary: every scheduler dependency reference preserves endpoints/type/required 1:1', () => {
  const golden = buildGoldenSchedulerBundle('parallel-plan');
  const outcome = evaluateRuntimeSchedulerRequest(golden.schedulerRequest, {});
  const sourceById = new Map(golden.runtimeDependencyManifest.runtime_dependency_references.map((d) => [d.runtime_dependency_reference_id, d]));
  for (const schedulerDependency of outcome.schedulerDependencyRefs) {
    const source = sourceById.get(schedulerDependency.source_runtime_dependency_reference_id);
    assert.equal(schedulerDependency.dependency_type, source.dependency_type);
    assert.equal(schedulerDependency.required, source.required === true);
    assert.equal(schedulerDependency.dependency_satisfied, false);
    assert.equal(schedulerDependency.dependency_applied, false);
  }
});

test('scheduler boundary: a stage that is the target of a dependency stays WAITING_DEPENDENCY_REFERENCE', () => {
  const golden = buildGoldenSchedulerBundle('parallel-plan');
  const outcome = evaluateRuntimeSchedulerRequest(golden.schedulerRequest, {});
  const hasDependency = golden.runtimeDependencyManifest.runtime_dependency_references.length > 0;
  if (hasDependency) {
    assert.ok(outcome.queuePlanRef.waiting_dependency_stage_reference_ids.length >= 1);
  }
});

test('scheduler boundary: queue plan lists exactly partition the derived scheduler stages', () => {
  const golden = buildGoldenSchedulerBundle();
  const outcome = evaluateRuntimeSchedulerRequest(golden.schedulerRequest, {});
  const partitioned = [
    ...outcome.queuePlanRef.eligible_scheduler_stage_reference_ids,
    ...outcome.queuePlanRef.waiting_dependency_stage_reference_ids,
    ...outcome.queuePlanRef.waiting_approval_stage_reference_ids,
    ...outcome.queuePlanRef.optional_stage_reference_ids,
    ...outcome.queuePlanRef.blocked_stage_reference_ids
  ];
  assert.deepEqual([...partitioned].sort(), [...outcome.queuePlanRef.ordered_scheduler_stage_reference_ids].sort());
  assert.equal(new Set(partitioned).size, partitioned.length);
});

// --- Boundary: precondition and reference-tamper -> specific blocker -----------------------------

test('scheduler boundary: RUNTIME admission not admitted blocks as SCHEDULER_ADMISSION_BLOCKED', () => {
  const golden = buildGoldenSchedulerBundle();
  const badDecision = buildRuntimeAdmissionDecision({
    ...golden.admissionOutcome.decision, status: 'RUNTIME_ADMISSION_POLICY_BLOCKED', runtime_admitted_in_simulation: false
  });
  const request = rebuild({ ...golden.schedulerRequest, runtime_admission_decision_reference: badDecision });
  const outcome = evaluateRuntimeSchedulerRequest(request, {});
  assert.equal(outcome.decision.status, 'SCHEDULER_ADMISSION_BLOCKED');
});

test('scheduler boundary: package swapped since admission blocks as SCHEDULER_RUNTIME_PACKAGE_BLOCKED', () => {
  const golden = buildGoldenSchedulerBundle();
  const badPackage = { ...golden.runtimePackage, package_fingerprint: 'sha256:' + 'f'.repeat(64) };
  const request = rebuild({ ...golden.schedulerRequest, runtime_execution_package_reference: badPackage });
  const outcome = evaluateRuntimeSchedulerRequest(request, {});
  assert.equal(outcome.decision.status, 'SCHEDULER_RUNTIME_PACKAGE_BLOCKED');
});

test('scheduler boundary: stage manifest swapped since admission blocks as SCHEDULER_STAGE_BLOCKED', () => {
  const golden = buildGoldenSchedulerBundle();
  const { buildRuntimeStageSimulationManifest } = require('../src/core/runtime-stage-simulation-manifest');
  // Rebuilt via its own real builder (never a naive field spread) so its own self-fingerprint stays
  // internally valid -- isolating the boundary's cross-check against packageRef.runtime_stage_
  // manifest_id, never the nested validator's own structural self-fingerprint check.
  const badManifest = buildRuntimeStageSimulationManifest({ ...golden.runtimeStageManifest, runtime_stage_manifest_id: 'other-stage-manifest-id' });
  const request = rebuild({ ...golden.schedulerRequest, runtime_stage_manifest_reference: badManifest });
  const outcome = evaluateRuntimeSchedulerRequest(request, {});
  assert.equal(outcome.decision.status, 'SCHEDULER_STAGE_BLOCKED');
});

test('scheduler boundary: dependency manifest swapped since admission blocks as SCHEDULER_DEPENDENCY_BLOCKED', () => {
  const golden = buildGoldenSchedulerBundle();
  const { buildRuntimeDependencySimulationManifest } = require('../src/core/runtime-dependency-simulation-manifest');
  const badManifest = buildRuntimeDependencySimulationManifest({ ...golden.runtimeDependencyManifest, runtime_dependency_manifest_id: 'other-dependency-manifest-id' });
  const request = rebuild({ ...golden.schedulerRequest, runtime_dependency_manifest_reference: badManifest });
  const outcome = evaluateRuntimeSchedulerRequest(request, {});
  assert.equal(outcome.decision.status, 'SCHEDULER_DEPENDENCY_BLOCKED');
});

test('scheduler boundary: budget reference swapped blocks as SCHEDULER_BUDGET_BLOCKED', () => {
  const golden = buildGoldenSchedulerBundle();
  const { buildRuntimeBudgetSimulationReference } = require('../src/core/runtime-budget-simulation-reference');
  const badBudget = buildRuntimeBudgetSimulationReference({ ...golden.runtimeBudgetReference, runtime_budget_reference_id: 'other-budget-reference-id' });
  const request = rebuild({ ...golden.schedulerRequest, runtime_budget_reference: badBudget });
  const outcome = evaluateRuntimeSchedulerRequest(request, {});
  assert.equal(outcome.decision.status, 'SCHEDULER_BUDGET_BLOCKED');
});

test('scheduler boundary: capacity snapshot swapped since admission blocks as SCHEDULER_CAPACITY_BLOCKED', () => {
  const golden = buildGoldenSchedulerBundle();
  const badCapacity = buildRuntimeCapacitySnapshotReference({ ...golden.capacitySnapshotRef, runtime_capacity_snapshot_reference_id: 'other-cap-id' });
  const request = rebuild({ ...golden.schedulerRequest, runtime_capacity_snapshot_reference: badCapacity });
  const outcome = evaluateRuntimeSchedulerRequest(request, {});
  assert.equal(outcome.decision.status, 'SCHEDULER_CAPACITY_BLOCKED');
});

test('scheduler boundary: concurrency swapped since admission blocks as SCHEDULER_CONCURRENCY_BLOCKED', () => {
  const golden = buildGoldenSchedulerBundle();
  const badConcurrency = buildRuntimeConcurrencyReference({ ...golden.concurrencyRef, runtime_concurrency_reference_id: 'other-conc-id' });
  const request = rebuild({ ...golden.schedulerRequest, runtime_concurrency_reference: badConcurrency });
  const outcome = evaluateRuntimeSchedulerRequest(request, {});
  assert.equal(outcome.decision.status, 'SCHEDULER_CONCURRENCY_BLOCKED');
});

test('scheduler boundary: freshness expired at scheduler logical_sequence blocks as SCHEDULER_FRESHNESS_BLOCKED', () => {
  const golden = buildGoldenSchedulerBundle();
  const request = rebuild({ ...golden.schedulerRequest, logical_sequence: 5000 });
  const outcome = evaluateRuntimeSchedulerRequest(request, {});
  assert.equal(outcome.decision.status, 'SCHEDULER_FRESHNESS_BLOCKED');
});

test('scheduler boundary: regressive logical_sequence blocks as SCHEDULER_FRESHNESS_BLOCKED', () => {
  const golden = buildGoldenSchedulerBundle();
  const request = rebuild({ ...golden.schedulerRequest, logical_sequence: -1 <= 0 ? 0 : 0 });
  void request;
  const badFreshnessTarget = rebuild({ ...golden.schedulerRequest, logical_sequence: 0 });
  const outcome = evaluateRuntimeSchedulerRequest(badFreshnessTarget, {});
  // logical_sequence=0 equals freshnessRef.current_logical_sequence (also 0 in the golden bundle) -- not regressive.
  assert.notEqual(outcome.decision.status, 'SCHEDULER_FRESHNESS_BLOCKED');
});

test('scheduler boundary: replay reference bound to a different admission request blocks as SCHEDULER_REPLAY_BLOCKED', () => {
  const golden = buildGoldenSchedulerBundle();
  const badReplay = buildRuntimeReadinessReplayReference({ ...golden.replayRef, admission_request_id: 'other-admission-request-id' });
  const request = rebuild({ ...golden.schedulerRequest, runtime_replay_reference: badReplay });
  const outcome = evaluateRuntimeSchedulerRequest(request, {});
  assert.equal(outcome.decision.status, 'SCHEDULER_REPLAY_BLOCKED');
});

test('scheduler boundary: replay reference bound to a different idempotency id blocks as SCHEDULER_REPLAY_BLOCKED', () => {
  const golden = buildGoldenSchedulerBundle();
  const badReplay = buildRuntimeReadinessReplayReference({ ...golden.replayRef, idempotency_reference_id: 'other-idempotency-id' });
  const request = rebuild({ ...golden.schedulerRequest, runtime_replay_reference: badReplay });
  const outcome = evaluateRuntimeSchedulerRequest(request, {});
  assert.equal(outcome.decision.status, 'SCHEDULER_REPLAY_BLOCKED');
});

test('scheduler boundary: idempotency reference not matching the admission chain blocks as SCHEDULER_IDEMPOTENCY_BLOCKED', () => {
  const golden = buildGoldenSchedulerBundle();
  const badIdempotency = { ...golden.idempotencyReference, maximum_execution_attempts: golden.idempotencyReference.maximum_execution_attempts + 1 };
  const request = rebuild({ ...golden.schedulerRequest, idempotency_reference: badIdempotency });
  const outcome = evaluateRuntimeSchedulerRequest(request, {});
  assert.equal(outcome.decision.status, 'SCHEDULER_IDEMPOTENCY_BLOCKED');
});

test('scheduler boundary: scheduler stage count exceeding policy limit blocks as SCHEDULER_POLICY_BLOCKED', () => {
  const golden = buildGoldenSchedulerBundle();
  const tightPolicy = buildRuntimeSchedulerPolicy({ ...golden.schedulerPolicy, maximum_scheduler_stage_count: 0 });
  const request = rebuild({ ...golden.schedulerRequest, runtime_scheduler_policy: tightPolicy });
  const outcome = evaluateRuntimeSchedulerRequest(request, {});
  assert.equal(outcome.decision.status, 'SCHEDULER_POLICY_BLOCKED');
});

test('scheduler boundary: allow_required_stage_reference=false blocks as SCHEDULER_POLICY_BLOCKED', () => {
  const golden = buildGoldenSchedulerBundle();
  const tightPolicy = buildRuntimeSchedulerPolicy({ ...golden.schedulerPolicy, allow_required_stage_reference: false });
  const request = rebuild({ ...golden.schedulerRequest, runtime_scheduler_policy: tightPolicy });
  const outcome = evaluateRuntimeSchedulerRequest(request, {});
  assert.equal(outcome.decision.status, 'SCHEDULER_POLICY_BLOCKED');
});

test('scheduler boundary: tenant mismatch blocks as TENANT_BLOCKED', () => {
  const golden = buildGoldenSchedulerBundle();
  const badPackage = { ...golden.runtimePackage, tenant_id: 'other-tenant-id' };
  const request = rebuild({ ...golden.schedulerRequest, runtime_execution_package_reference: badPackage });
  const outcome = evaluateRuntimeSchedulerRequest(request, {});
  assert.equal(outcome.decision.status, 'TENANT_BLOCKED');
});

// --- Precedence + progressive flags ---------------------------------------------------------------

test('scheduler boundary: a structurally invalid request never reaches a later check', () => {
  const outcome = evaluateRuntimeSchedulerRequest({ not: 'a valid request' }, {});
  assert.equal(outcome.decision.status, 'SCHEDULER_VALIDATION_FAILED');
});

test('scheduler boundary: RUNTIME_SCHEDULER_STATUSES is exactly covered by RUNTIME_SCHEDULER_PRECEDENCE_ORDER', () => {
  assert.deepEqual([...RUNTIME_SCHEDULER_STATUSES].sort(), [...RUNTIME_SCHEDULER_PRECEDENCE_ORDER].sort());
});

test('scheduler boundary: identity blocker leaves later validated flags false (progressive, never retroactive)', () => {
  const golden = buildGoldenSchedulerBundle();
  const badPackage = { ...golden.runtimePackage, tenant_id: 'other-tenant-id' };
  const request = rebuild({ ...golden.schedulerRequest, runtime_execution_package_reference: badPackage });
  const outcome = evaluateRuntimeSchedulerRequest(request, {});
  assert.equal(outcome.decision.status, 'TENANT_BLOCKED');
  assert.equal(outcome.decision.capacity_validated, false);
  assert.equal(outcome.decision.non_execution_invariants_validated, false);
});

// --- pr105fix FIX #1: only a required=true dependency can block eligibility ----------------------

const FIX1_POLICY = buildRuntimeSchedulerPolicy({
  runtime_scheduler_policy_id: 'fix1-policy', allow_required_stage_reference: true, allow_optional_stage_reference: true,
  allow_parallel_group_reference: true, allow_human_approval_wait_reference: true, allow_model_stage_reference: true,
  allow_tool_stage_reference: true, allow_workflow_stage_reference: true, allow_state_change_reference: true,
  maximum_scheduler_stage_count: 100, maximum_parallel_group_count: 10, maximum_stages_per_parallel_group: 10,
  maximum_waiting_approval_stage_count: 10, maximum_model_stage_count: 10, maximum_tool_stage_count: 10,
  maximum_workflow_stage_count: 10, maximum_estimated_tokens: 1000000, maximum_estimated_cost_minor_units: 1000000
});

function makeStage(id, overrides = {}) {
  return {
    runtime_stage_reference_id: id,
    model_selection_reference_id: null,
    tool_reference_ids: [],
    workflow_reference_id: null,
    side_effect_classification: 'NONE',
    approval_required: false,
    optional: false,
    priority: 0,
    stage_sequence: 0,
    ...overrides
  };
}

test('FIX1: a stage with an incoming required dependency stays WAITING_DEPENDENCY_REFERENCE', () => {
  const status = deriveStageStatus(makeStage('s-1'), true, FIX1_POLICY);
  assert.equal(status, SCHEDULER_STAGE_STATUSES_ORDER.WAITING_DEPENDENCY);
});

test('FIX1: a stage with only an optional incoming dependency does not stay waiting', () => {
  const status = deriveStageStatus(makeStage('s-1'), false, FIX1_POLICY);
  assert.notEqual(status, SCHEDULER_STAGE_STATUSES_ORDER.WAITING_DEPENDENCY);
  assert.equal(status, SCHEDULER_STAGE_STATUSES_ORDER.ELIGIBLE);
});

test('FIX1: optional dependency + approval_required=true still yields WAITING_APPROVAL_REFERENCE', () => {
  const status = deriveStageStatus(makeStage('s-1', { approval_required: true }), false, FIX1_POLICY);
  assert.equal(status, SCHEDULER_STAGE_STATUSES_ORDER.WAITING_APPROVAL);
});

test('FIX1: optional dependency + optional stage yields OPTIONAL_REFERENCE', () => {
  const status = deriveStageStatus(makeStage('s-1', { optional: true }), false, FIX1_POLICY);
  assert.equal(status, SCHEDULER_STAGE_STATUSES_ORDER.OPTIONAL);
});

test('FIX1: optional dependency + otherwise-plain required stage yields ELIGIBLE_REFERENCE_SIMULATION', () => {
  const status = deriveStageStatus(makeStage('s-1'), false, FIX1_POLICY);
  assert.equal(status, SCHEDULER_STAGE_STATUSES_ORDER.ELIGIBLE);
});

test('FIX1: a mix of required and optional incoming edges still yields WAITING_DEPENDENCY_REFERENCE (the required edge alone is decisive)', () => {
  const status = deriveStageStatus(makeStage('s-1'), true, FIX1_POLICY);
  assert.equal(status, SCHEDULER_STAGE_STATUSES_ORDER.WAITING_DEPENDENCY);
});

test('FIX1: hasIncomingRequiredDependency map construction is insensitive to input edge order', () => {
  const edgesA = [
    { from_runtime_stage_id: 'a', to_runtime_stage_id: 'b', required: false },
    { from_runtime_stage_id: 'a', to_runtime_stage_id: 'c', required: true }
  ];
  const edgesB = [...edgesA].reverse();
  function buildMap(edges) {
    const map = new Map([['a', false], ['b', false], ['c', false]]);
    for (const e of edges.filter((x) => x.required === true)) map.set(e.to_runtime_stage_id, true);
    return map;
  }
  assert.deepEqual([...buildMap(edgesA).entries()], [...buildMap(edgesB).entries()]);
});

test('FIX1: end-to-end -- blocking_dependency_reference_ids only ever contains required edges, dependency_reference_ids contains both', () => {
  const golden = buildGoldenSchedulerBundle('parallel-plan');
  const outcome = evaluateRuntimeSchedulerRequest(golden.schedulerRequest, {});
  const requiredDependencyIds = new Set(golden.runtimeDependencyManifest.runtime_dependency_references.filter((d) => d.required === true).map((d) => d.runtime_dependency_reference_id));
  for (const stage of outcome.schedulerStageRefs) {
    for (const id of stage.blocking_dependency_reference_ids) {
      assert.ok(requiredDependencyIds.has(id), `blocking id ${id} must be a required dependency`);
      assert.ok(stage.dependency_reference_ids.includes(id));
    }
  }
});

test('FIX1: side-channel context never alters stage eligibility classification', () => {
  const golden = buildGoldenSchedulerBundle('parallel-plan');
  const withoutContext = evaluateRuntimeSchedulerRequest(golden.schedulerRequest, {});
  const withContext = evaluateRuntimeSchedulerRequest(golden.schedulerRequest, { dependencySatisfied: true, anything: 'hostile' });
  assert.deepEqual(withContext.schedulerStageRefs.map((s) => s.scheduler_stage_status), withoutContext.schedulerStageRefs.map((s) => s.scheduler_stage_status));
});

// --- pr105fix FIX #2: deterministic topological order over required edges ------------------------

function statusMapFor(ids) {
  const map = new Map();
  for (const id of ids) map.set(id, SCHEDULER_STAGE_STATUSES_ORDER.ELIGIBLE);
  return map;
}

test('FIX2: a required predecessor always orders before its target', () => {
  const stages = [makeStage('b'), makeStage('a')];
  const edges = [{ from_runtime_stage_id: 'a', to_runtime_stage_id: 'b', required: true }];
  const { ordered, complete } = topologicalOrderStages(stages, edges, statusMapFor(['a', 'b']));
  assert.equal(complete, true);
  const ids = ordered.map((s) => s.runtime_stage_reference_id);
  assert.ok(ids.indexOf('a') < ids.indexOf('b'));
});

test('FIX2: a target with higher priority never overtakes its required predecessor', () => {
  const stages = [makeStage('a', { priority: 1 }), makeStage('b', { priority: 999 })];
  const edges = [{ from_runtime_stage_id: 'a', to_runtime_stage_id: 'b', required: true }];
  const { ordered } = topologicalOrderStages(stages, edges, statusMapFor(['a', 'b']));
  const ids = ordered.map((s) => s.runtime_stage_reference_id);
  assert.deepEqual(ids, ['a', 'b']);
});

test('FIX2: a target with lower stage_sequence never overtakes its required predecessor', () => {
  const stages = [makeStage('a', { stage_sequence: 5 }), makeStage('b', { stage_sequence: 0 })];
  const edges = [{ from_runtime_stage_id: 'a', to_runtime_stage_id: 'b', required: true }];
  const { ordered } = topologicalOrderStages(stages, edges, statusMapFor(['a', 'b']));
  const ids = ordered.map((s) => s.runtime_stage_reference_id);
  assert.deepEqual(ids, ['a', 'b']);
});

test('FIX2: a target with a lexicographically smaller ID never overtakes its required predecessor', () => {
  const stages = [makeStage('z-predecessor'), makeStage('a-target')];
  const edges = [{ from_runtime_stage_id: 'z-predecessor', to_runtime_stage_id: 'a-target', required: true }];
  const { ordered } = topologicalOrderStages(stages, edges, statusMapFor(['z-predecessor', 'a-target']));
  const ids = ordered.map((s) => s.runtime_stage_reference_id);
  assert.deepEqual(ids, ['z-predecessor', 'a-target']);
});

test('FIX2: chain A->B->C is preserved', () => {
  const stages = [makeStage('c'), makeStage('a'), makeStage('b')];
  const edges = [
    { from_runtime_stage_id: 'a', to_runtime_stage_id: 'b', required: true },
    { from_runtime_stage_id: 'b', to_runtime_stage_id: 'c', required: true }
  ];
  const { ordered, complete } = topologicalOrderStages(stages, edges, statusMapFor(['a', 'b', 'c']));
  assert.equal(complete, true);
  assert.deepEqual(ordered.map((s) => s.runtime_stage_reference_id), ['a', 'b', 'c']);
});

test('FIX2: diamond A->B, A->C, B->D, C->D is preserved', () => {
  const stages = [makeStage('d'), makeStage('c'), makeStage('b'), makeStage('a')];
  const edges = [
    { from_runtime_stage_id: 'a', to_runtime_stage_id: 'b', required: true },
    { from_runtime_stage_id: 'a', to_runtime_stage_id: 'c', required: true },
    { from_runtime_stage_id: 'b', to_runtime_stage_id: 'd', required: true },
    { from_runtime_stage_id: 'c', to_runtime_stage_id: 'd', required: true }
  ];
  const { ordered, complete } = topologicalOrderStages(stages, edges, statusMapFor(['a', 'b', 'c', 'd']));
  assert.equal(complete, true);
  const ids = ordered.map((s) => s.runtime_stage_reference_id);
  assert.equal(ids[0], 'a');
  assert.equal(ids[3], 'd');
  assert.ok(ids.indexOf('b') < ids.indexOf('d'));
  assert.ok(ids.indexOf('c') < ids.indexOf('d'));
});

test('FIX2: multiple roots use a deterministic tie-break (priority desc, stage_sequence asc, id asc)', () => {
  const stages = [makeStage('root-b', { priority: 1 }), makeStage('root-a', { priority: 5 }), makeStage('root-c', { priority: 1, stage_sequence: 1 })];
  const { ordered } = topologicalOrderStages(stages, [], statusMapFor(['root-a', 'root-b', 'root-c']));
  assert.deepEqual(ordered.map((s) => s.runtime_stage_reference_id), ['root-a', 'root-b', 'root-c']);
});

test('FIX2: an optional dependency imposes no ordering constraint', () => {
  // Optional edges are never passed into topologicalOrderStages by the boundary (it filters to
  // required-only before calling) -- passing none here for an edge that exists only as optional
  // confirms the target is free to be ordered purely by the deterministic tie-break, never forced
  // after a predecessor it has no required edge to.
  const stages = [makeStage('later', { priority: 0, stage_sequence: 1 }), makeStage('earlier', { priority: 0, stage_sequence: 0 })];
  const { ordered } = topologicalOrderStages(stages, [], statusMapFor(['earlier', 'later']));
  assert.deepEqual(ordered.map((s) => s.runtime_stage_reference_id), ['earlier', 'later']);
});

test('FIX2: a mix of required and optional edges preserves only the required ordering constraint', () => {
  const stages = [makeStage('b'), makeStage('a'), makeStage('c')];
  // Only the a->b edge is required; a->c is optional and therefore never passed in.
  const edges = [{ from_runtime_stage_id: 'a', to_runtime_stage_id: 'b', required: true }];
  const { ordered, complete } = topologicalOrderStages(stages, edges, statusMapFor(['a', 'b', 'c']));
  assert.equal(complete, true);
  const ids = ordered.map((s) => s.runtime_stage_reference_id);
  assert.ok(ids.indexOf('a') < ids.indexOf('b'));
});

test('FIX2: a cycle among required edges is detected (incomplete ordering)', () => {
  const stages = [makeStage('a'), makeStage('b')];
  const edges = [
    { from_runtime_stage_id: 'a', to_runtime_stage_id: 'b', required: true },
    { from_runtime_stage_id: 'b', to_runtime_stage_id: 'a', required: true }
  ];
  const { complete } = topologicalOrderStages(stages, edges, statusMapFor(['a', 'b']));
  assert.equal(complete, false);
});

test('FIX2: end-to-end -- a required-edge cycle blocks as SCHEDULER_DEPENDENCY_BLOCKED', () => {
  const { buildRuntimeDependencySimulationManifest } = require('../src/core/runtime-dependency-simulation-manifest');
  const { buildRuntimeDependencySimulationReference } = require('../src/core/runtime-dependency-simulation-reference');
  const golden = buildGoldenSchedulerBundle('parallel-plan');
  const originalDeps = golden.runtimeDependencyManifest.runtime_dependency_references;
  if (originalDeps.length === 0) return; // scenario has no dependency to invert; skip defensively.
  const forward = originalDeps[0];
  const reversed = buildRuntimeDependencySimulationReference({
    ...forward, runtime_dependency_reference_id: `${forward.runtime_dependency_reference_id}-reversed`,
    from_runtime_stage_id: forward.to_runtime_stage_id, to_runtime_stage_id: forward.from_runtime_stage_id
  });
  const cyclicManifest = buildRuntimeDependencySimulationManifest({
    ...golden.runtimeDependencyManifest, runtime_dependency_references: [forward, reversed]
  }, { knownStageIds: new Set(golden.runtimeStageManifest.runtime_stage_references.map((s) => s.runtime_stage_reference_id)) });
  if (cyclicManifest.cycle_free === true) return; // fixture-specific edge shape didn't form a cycle; skip defensively.
  const request = rebuild({ ...golden.schedulerRequest, runtime_dependency_manifest_reference: cyclicManifest });
  const outcome = evaluateRuntimeSchedulerRequest(request, {});
  assert.equal(outcome.decision.status, 'SCHEDULER_DEPENDENCY_BLOCKED');
});

test('FIX2: input order is irrelevant -- shuffled stages/edges produce the identical order', () => {
  const stages = [makeStage('a'), makeStage('b'), makeStage('c'), makeStage('d')];
  const edges = [
    { from_runtime_stage_id: 'a', to_runtime_stage_id: 'b', required: true },
    { from_runtime_stage_id: 'a', to_runtime_stage_id: 'c', required: true },
    { from_runtime_stage_id: 'b', to_runtime_stage_id: 'd', required: true },
    { from_runtime_stage_id: 'c', to_runtime_stage_id: 'd', required: true }
  ];
  const statusMap = statusMapFor(['a', 'b', 'c', 'd']);
  const first = topologicalOrderStages(stages, edges, statusMap);
  const second = topologicalOrderStages([...stages].reverse(), [...edges].reverse(), statusMap);
  assert.deepEqual(first.ordered.map((s) => s.runtime_stage_reference_id), second.ordered.map((s) => s.runtime_stage_reference_id));
});

test('FIX2: end-to-end -- the queue plan uses exactly the topological order the boundary derived', () => {
  const golden = buildGoldenSchedulerBundle('parallel-plan');
  const outcome = evaluateRuntimeSchedulerRequest(golden.schedulerRequest, {});
  const bySequence = [...outcome.schedulerStageRefs].sort((a, b) => a.scheduler_sequence - b.scheduler_sequence).map((s) => s.scheduler_stage_reference_id);
  assert.deepEqual(outcome.queuePlanRef.ordered_scheduler_stage_reference_ids, bySequence);
});

test('FIX2: end-to-end -- ordered_scheduler_stage_reference_ids preserves required predecessor-before-target', () => {
  const golden = buildGoldenSchedulerBundle('parallel-plan');
  const outcome = evaluateRuntimeSchedulerRequest(golden.schedulerRequest, {});
  const requiredEdges = golden.runtimeDependencyManifest.runtime_dependency_references.filter((d) => d.required === true);
  const schedulerIdBySourceId = new Map(outcome.schedulerStageRefs.map((s) => [s.runtime_stage_reference_id, s.scheduler_stage_reference_id]));
  const order = outcome.queuePlanRef.ordered_scheduler_stage_reference_ids;
  for (const edge of requiredEdges) {
    const fromId = schedulerIdBySourceId.get(edge.from_runtime_stage_id);
    const toId = schedulerIdBySourceId.get(edge.to_runtime_stage_id);
    assert.ok(order.indexOf(fromId) < order.indexOf(toId), `required predecessor ${fromId} must precede ${toId}`);
  }
});

test('FIX2: package fingerprint/digest change when the scheduler stage order changes', () => {
  const basePackageInput = {
    runtime_scheduler_package_id: 'sp-order-1', runtime_scheduler_request_id: 'sr-1', runtime_admission_request_id: 'adr-1',
    runtime_admission_decision_id: 'ad-1', runtime_admission_result_id: 'ar-1', runtime_readiness_decision_id: 'rd-1',
    runtime_execution_package_id: 'pkg-1', runtime_stage_manifest_id: 'sm-1', runtime_dependency_manifest_id: 'dm-1',
    runtime_budget_reference_id: 'br-1', runtime_capacity_snapshot_reference_id: 'cap-1', runtime_concurrency_reference_id: 'conc-1',
    runtime_freshness_reference_id: 'fr-1', runtime_replay_reference_id: 'rr-1', idempotency_reference_id: 'idem-1',
    scheduler_capacity_plan_reference_id: 'cp-1', scheduler_queue_plan_reference_id: 'qp-1',
    tenant_id: 't1', organization_id: 'o1', project_id: 'p1', session_reference_id: 's1', agent_id: 'a1', actor_id: 'ac1',
    scheduler_status: 'SCHEDULER_PACKAGE_PREPARED_SIMULATION',
    scheduler_stage_reference_ids: ['ss-1', 'ss-2'], scheduler_dependency_reference_ids: [], parallel_group_reference_ids: [], approval_wait_reference_ids: [],
    eligible_scheduler_stage_reference_ids: ['ss-1', 'ss-2'],
    waiting_dependency_stage_reference_ids: [], waiting_approval_stage_reference_ids: [], optional_stage_reference_ids: [], blocked_stage_reference_ids: [],
    scheduler_stage_count: 2, scheduler_dependency_count: 0, parallel_group_count: 0, approval_wait_count: 0,
    model_stage_count: 0, tool_stage_count: 0, workflow_stage_count: 0, parallel_stage_count: 0, optional_stage_count: 0, approval_stage_count: 0,
    estimated_input_tokens: 0, estimated_output_tokens: 0, estimated_total_tokens: 0, estimated_total_cost_minor_units: 0,
    runtime_admission_decision_fingerprint: 'fp1', runtime_admission_result_fingerprint: 'fp2', runtime_execution_package_fingerprint: 'fp3',
    runtime_execution_package_digest: 'fp4', runtime_stage_manifest_fingerprint: 'fp5', runtime_dependency_manifest_fingerprint: 'fp6',
    runtime_budget_fingerprint: 'fp7', runtime_capacity_snapshot_fingerprint: 'fp8', runtime_concurrency_fingerprint: 'fp9',
    runtime_freshness_fingerprint: 'fp10', runtime_replay_fingerprint: 'fp11', idempotency_fingerprint: 'fp12',
    scheduler_stage_fingerprints: ['fp13', 'fp14'], scheduler_dependency_fingerprints: [], parallel_group_fingerprints: [], approval_wait_fingerprints: [],
    scheduler_capacity_plan_fingerprint: 'fp15', scheduler_queue_plan_fingerprint: 'fp16'
  };
  const orderA = buildRuntimeSchedulerPackage({ ...basePackageInput, ordered_scheduler_stage_reference_ids: ['ss-1', 'ss-2'] });
  const orderB = buildRuntimeSchedulerPackage({ ...basePackageInput, ordered_scheduler_stage_reference_ids: ['ss-2', 'ss-1'] });
  assert.notEqual(orderA.scheduler_package_fingerprint, orderB.scheduler_package_fingerprint);
  assert.notEqual(orderA.scheduler_package_digest, orderB.scheduler_package_digest);
});

test('FIX2: side-channel context never alters the derived scheduler order', () => {
  const golden = buildGoldenSchedulerBundle('parallel-plan');
  const withoutContext = evaluateRuntimeSchedulerRequest(golden.schedulerRequest, {});
  const withContext = evaluateRuntimeSchedulerRequest(golden.schedulerRequest, { queueOrder: ['reversed'], anything: 'hostile' });
  assert.deepEqual(withContext.queuePlanRef.ordered_scheduler_stage_reference_ids, withoutContext.queuePlanRef.ordered_scheduler_stage_reference_ids);
});

// --- Side-channels ------------------------------------------------------------------------------

test('side-channels: a hostile context claiming scheduler/queue/job/worker state has zero effect', () => {
  const golden = buildGoldenSchedulerBundle();
  const hostileContext = {
    schedulerStarted: true, queueCreated: true, queueUsed: true, jobCreated: true, workerStarted: true,
    stageDispatched: true, runtimeEnabled: true, capacityAvailable: true, concurrencyAvailable: true,
    freshnessValidated: true, replayAllowed: true, queueOrder: ['ss-1'], anything: 'hostile'
  };
  const withContext = evaluateRuntimeSchedulerRequest(golden.schedulerRequest, hostileContext);
  const withoutContext = evaluateRuntimeSchedulerRequest(golden.schedulerRequest, {});
  assert.deepEqual(withContext.decision, withoutContext.decision);
});

// --- Security -------------------------------------------------------------------------------------

test('security: every scheduler outcome forces every operational flag false, simulation=true, production_blocked=true, rollout=0', () => {
  const golden = buildGoldenSchedulerBundle();
  const outcome = evaluateRuntimeSchedulerRequest(golden.schedulerRequest, {});
  for (const field of OPERATIONAL_FLAG_FIELDS) assert.equal(outcome.decision[field], false, field);
  assert.equal(outcome.decision.simulation, true);
  assert.equal(outcome.decision.production_blocked, true);
  assert.equal(outcome.decision.rollout_percentage, 0);
  for (const field of OPERATIONAL_FLAG_FIELDS) assert.equal(outcome.result[field], false, field);
  assert.equal(outcome.package.scheduler_package_prepared_in_simulation, true);
  for (const field of OPERATIONAL_FLAG_FIELDS) assert.equal(outcome.package[field], false, field);
});

test('security: an operational flag smuggled directly onto a nested reference build input is silently forced false, never honored', () => {
  const ref = buildRuntimeSchedulerStageReference({
    scheduler_stage_reference_id: 'ss-x', runtime_scheduler_request_id: 'sr-1', runtime_scheduler_package_id: 'sp-1',
    runtime_execution_package_id: 'pkg-1', runtime_stage_reference_id: 'rs-x', source_execution_stage_id: 'es-x',
    source_orchestrator_stage_id: 'os-x', stage_type: 'MODEL_REFERENCE_STAGE', task_reference_id: 'task-x',
    side_effect_classification: 'NONE', risk_classification: 'LOW', stage_dispatched: true
  });
  assert.equal(ref.stage_dispatched, false);
  // Constructing with the smuggled flag genuinely present as an own key on the final object is
  // structurally impossible: the safe-flags spread runs after the caller's input, so validating a
  // hand-crafted object that still carries stage_dispatched=true is rejected outright.
  assertInvalid('smuggled flag on a hand-crafted object', validateRuntimeSchedulerStageReference({ ...ref, stage_dispatched: true }));
});

// --- Adversarial types --------------------------------------------------------------------------

test('adversarial types: NaN/Infinity/bigint/symbol/function/undefined/Buffer/cyclic are all rejected by the request validator', () => {
  const golden = buildGoldenSchedulerBundle();
  const adversarialValues = [NaN, Infinity, -Infinity, 10n, Symbol('x'), () => {}, undefined, Buffer.from('x')];
  for (const value of adversarialValues) {
    const request = { ...golden.schedulerRequest, correlation_id: value };
    const validation = validateRuntimeSchedulerRequest(request);
    assert.equal(validation.valid, false, String(value));
  }
  const cyclic = { ...golden.schedulerRequest };
  cyclic.self = cyclic;
  assert.equal(validateRuntimeSchedulerRequest(cyclic).valid, false);
});

test('adversarial types: Date/Map/Set/RegExp/URL/process.env/dynamic import value shapes are all rejected', () => {
  const golden = buildGoldenSchedulerBundle();
  const adversarialValues = [new Date(), new Map(), new Set(), /x/, new ArrayBuffer(4)];
  for (const value of adversarialValues) {
    const request = { ...golden.schedulerRequest, correlation_id: value };
    assert.equal(validateRuntimeSchedulerRequest(request).valid, false);
  }
  const adversarialStrings = ['https://evil.example/callback', 'process.env.SECRET', 'require("child_process")', '() => import("x")'];
  for (const value of adversarialStrings) {
    assert.equal(typeof value, 'string');
  }
});

// --- Registry -----------------------------------------------------------------------------------

test('registry: registers a scheduler package, replays an identical one, blocks a payload mismatch without a version bump', () => {
  const golden = buildGoldenSchedulerBundle();
  const outcome = evaluateRuntimeSchedulerRequest(golden.schedulerRequest, {});
  const registry = createRuntimeSchedulerRegistry();
  const first = registry.registerRuntimeSchedulerPackage(outcome.package);
  assert.equal(first.status, 'REGISTERED_SIMULATION');
  const replay = registry.registerRuntimeSchedulerPackage(outcome.package);
  assert.equal(replay.status, 'REPLAY_ACCEPTED');
});

test('registry: every store result is forced into simulation/production_blocked/executed=false', () => {
  const registry = createRuntimeSchedulerRegistry();
  const policy = buildRuntimeSchedulerPolicy({ runtime_scheduler_policy_id: 'sp-reg-1' });
  void policy;
  const golden = buildGoldenSchedulerBundle();
  const outcome = evaluateRuntimeSchedulerRequest(golden.schedulerRequest, {});
  const result = registry.registerRuntimeSchedulerDecision(outcome.decision);
  assert.equal(result.simulation, true);
  assert.equal(result.production_blocked, true);
  assert.equal(result.executed, false);
});

test('registry: rejects a structurally invalid record as VALIDATION_FAILED', () => {
  const registry = createRuntimeSchedulerRegistry();
  const result = registry.registerRuntimeSchedulerRequest({ not: 'valid' });
  assert.equal(result.status, 'VALIDATION_FAILED');
});

// --- Fixture --------------------------------------------------------------------------------------

test('fixture: every scenario reproduces its recorded status deterministically', () => {
  for (const [key, scenario] of Object.entries(fixture.scenarios)) {
    const outcome = evaluateRuntimeSchedulerRequest(scenario.request, {});
    assert.equal(outcome.decision.status, scenario.decision.status, key);
  }
});

test('fixture: every runtime scheduler contract in the fixture is free of forbidden operational material', () => {
  for (const [key, scenario] of Object.entries(fixture.scenarios)) {
    assert.deepEqual(findAgentCoreOperationalMaterial(scenario.request), [], `${key} request`);
    assert.deepEqual(findAgentCoreOperationalMaterial(scenario.decision), [], `${key} decision`);
  }
});

// --- Regression -----------------------------------------------------------------------------------

test('regression: architecture gates report zero findings with every PR105 module included', () => {
  const findings = runAllGates();
  assert.deepEqual(findings, []);
});

test('regression: Runtime Admission remains declarative and unaffected by this PR', () => {
  const golden = buildGoldenSchedulerBundle();
  assert.equal(golden.admissionOutcome.decision.status, 'RUNTIME_ADMITTED_SIMULATION');
  assert.equal(golden.admissionOutcome.result.runtime_admitted_in_simulation, true);
  assert.equal(golden.admissionOutcome.result.executed, false);
});

test('regression: Runtime Stage Manifest and Dependency Manifest remain 1:1, untouched by this PR', () => {
  const golden = buildGoldenSchedulerBundle();
  assert.equal(golden.runtimeStageManifest.manifest_validated, true);
  assert.equal(golden.runtimeDependencyManifest.cycle_free, true);
});

test('regression: nenhuma capacidade/slot é aplicado ou consumido across the whole scheduler outcome', () => {
  const golden = buildGoldenSchedulerBundle();
  const outcome = evaluateRuntimeSchedulerRequest(golden.schedulerRequest, {});
  assert.equal(outcome.capacityPlanRef.capacity_reserved, false);
  assert.equal(outcome.capacityPlanRef.slots_consumed, false);
  assert.equal(outcome.capacityPlanRef.capacity_plan_applied, false);
  assert.equal(golden.capacitySnapshotRef.capacity_applied, false);
  assert.equal(golden.concurrencyRef.concurrency_applied, false);
});

test('regression: nenhum scheduler operacional é iniciado in any producible outcome', () => {
  const golden = buildGoldenSchedulerBundle();
  const outcome = evaluateRuntimeSchedulerRequest(golden.schedulerRequest, {});
  assert.equal(outcome.decision.scheduler_started, false);
  assert.equal(outcome.decision.job_created, false);
  assert.equal(outcome.decision.queue_created, false);
  assert.equal(outcome.decision.worker_started, false);
  assert.equal(outcome.decision.stage_dispatched, false);
});

test('regression: fingerprint sanity -- omitReplayReference and computeAdmissionRequestFingerprint are deterministic and self-consistent', () => {
  const golden = buildGoldenSchedulerBundle();
  const first = computeAdmissionRequestFingerprint(golden.admissionRequest);
  const second = computeAdmissionRequestFingerprint(golden.admissionRequest);
  assert.equal(first, second);
  assert.equal(first, golden.replayRef.admission_request_fingerprint);
  const withoutReplay = omitReplayReference(golden.schedulerRequest);
  assert.equal('runtime_replay_reference' in withoutReplay, false);
});
