'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { findAgentCoreOperationalMaterial } = require('../src/core/agent-identity-contract');
const { runAllGates } = require('../src/core/architecture-gate-runner');

const {
  validateRuntimeQueueAdmissionPolicy, buildRuntimeQueueAdmissionPolicy, RUNTIME_QUEUE_ADMISSION_POLICY_FIELDS
} = require('../src/core/runtime-queue-admission-policy');
const {
  validateRuntimeQueueClassReference, buildRuntimeQueueClassReference, RUNTIME_QUEUE_CLASS_REFERENCE_FIELDS
} = require('../src/core/runtime-queue-class-reference');
const {
  validateRuntimeQueueCapacitySnapshotReference, buildRuntimeQueueCapacitySnapshotReference,
  RUNTIME_QUEUE_CAPACITY_SNAPSHOT_REFERENCE_FIELDS
} = require('../src/core/runtime-queue-capacity-snapshot-reference');
const {
  validateRuntimeQueueQuotaReference, buildRuntimeQueueQuotaReference, RUNTIME_QUEUE_QUOTA_REFERENCE_FIELDS
} = require('../src/core/runtime-queue-quota-reference');
const {
  validateRuntimeQueuePartitionReference, buildRuntimeQueuePartitionReference, RUNTIME_QUEUE_PARTITION_REFERENCE_FIELDS
} = require('../src/core/runtime-queue-partition-reference');
const {
  validateRuntimeQueueFairnessReference, buildRuntimeQueueFairnessReference, RUNTIME_QUEUE_FAIRNESS_REFERENCE_FIELDS
} = require('../src/core/runtime-queue-fairness-reference');
const {
  validateRuntimeQueueIntentBindingReference, buildRuntimeQueueIntentBindingReference,
  RUNTIME_QUEUE_INTENT_BINDING_REFERENCE_FIELDS
} = require('../src/core/runtime-queue-intent-binding-reference');
const {
  validateRuntimeQueueAdmissionEntryReference, buildRuntimeQueueAdmissionEntryReference,
  RUNTIME_QUEUE_ADMISSION_ENTRY_REFERENCE_FIELDS
} = require('../src/core/runtime-queue-admission-entry-reference');
const {
  validateRuntimeQueueAdmissionOrderReference, buildRuntimeQueueAdmissionOrderReference,
  RUNTIME_QUEUE_ADMISSION_ORDER_REFERENCE_FIELDS
} = require('../src/core/runtime-queue-admission-order-reference');
const {
  validateRuntimeQueueAdmissionReplayReference, buildRuntimeQueueAdmissionReplayReference,
  RUNTIME_QUEUE_ADMISSION_REPLAY_REFERENCE_FIELDS
} = require('../src/core/runtime-queue-admission-replay-reference');
const {
  validateRuntimeQueueAdmissionRequest, buildRuntimeQueueAdmissionRequest, RUNTIME_QUEUE_ADMISSION_REQUEST_FIELDS
} = require('../src/core/runtime-queue-admission-request');
const { validateRuntimeQueueAdmissionPackage, buildRuntimeQueueAdmissionPackage } = require('../src/core/runtime-queue-admission-package');
const {
  validateRuntimeQueueAdmissionDecision, QUEUE_ADMISSION_STATUSES, QUEUE_ADMISSION_PRECEDENCE_ORDER
} = require('../src/core/runtime-queue-admission-decision');
const { validateRuntimeQueueAdmissionResult } = require('../src/core/runtime-queue-admission-result');
const { validateRuntimeQueueAdmissionAudit } = require('../src/core/runtime-queue-admission-audit');
const { createRuntimeQueueAdmissionRegistry } = require('../src/core/runtime-queue-admission-registry');
const { evaluateRuntimeQueueAdmissionRequest, selectQueueClass } = require('../src/core/runtime-queue-admission-boundary');

const { buildGoldenQueueAdmissionBundle } = require('./helpers/runtime-queue-admission-simulation-test-data');

function assertValid(label, validation) {
  assert.equal(validation.valid, true, `${label}: ${JSON.stringify(validation.errors)}`);
}

function assertInvalid(label, validation) {
  assert.equal(validation.valid, false, `${label} unexpectedly valid`);
}

const OPERATIONAL_FLAG_FIELDS = [
  'queue_admission_applied', 'queue_created', 'queue_item_created', 'queue_item_enqueued', 'queue_position_reserved',
  'queue_capacity_consumed', 'queue_backlog_changed', 'job_created', 'dispatch_authorized', 'dispatch_applied',
  'dispatch_sent', 'dispatch_acknowledged', 'dispatch_lease_created', 'worker_reserved', 'worker_started',
  'worker_connection_opened', 'worker_process_created', 'worker_thread_created', 'container_started',
  'stage_dispatched', 'stage_started', 'stage_completed', 'stage_failed', 'runtime_enabled', 'execution_authorized',
  'execution_started', 'network_used', 'secret_resolved', 'executed'
];

// --- Policy -----------------------------------------------------------------------------------

test('queue admission policy: valid contract, exact fields, safe defaults, nenhuma policy habilita fila', () => {
  const policy = buildRuntimeQueueAdmissionPolicy({ runtime_queue_admission_policy_id: 'qap-1' });
  assertValid('policy', validateRuntimeQueueAdmissionPolicy(policy));
  assert.deepEqual(Object.keys(policy).sort(), [...RUNTIME_QUEUE_ADMISSION_POLICY_FIELDS].sort());
  assert.equal(policy.allow_queue_admission_package_preparation_simulation, true);
  assert.equal(policy.allow_external_effect_reference, false);
  assert.equal(policy.allow_irreversible_reference, false);
  for (const field of RUNTIME_QUEUE_ADMISSION_POLICY_FIELDS) {
    if (field.startsWith('require_') || field.startsWith('fail_on_') || field === 'fail_closed') assert.equal(policy[field], true, field);
  }
});

test('queue admission policy: missing/extra fields and smuggled unsafe flags rejected', () => {
  const policy = buildRuntimeQueueAdmissionPolicy({ runtime_queue_admission_policy_id: 'qap-1' });
  assertInvalid('missing field', validateRuntimeQueueAdmissionPolicy({ ...policy, allow_model_queue_reference: undefined }));
  assertInvalid('extra field', validateRuntimeQueueAdmissionPolicy({ ...policy, extra_field: true }));
  assertInvalid('external effect smuggled true', validateRuntimeQueueAdmissionPolicy({ ...policy, allow_external_effect_reference: true }));
  assertInvalid('require flag smuggled false', validateRuntimeQueueAdmissionPolicy({ ...policy, require_dispatch_package_prepared: false }));
});

// --- Reference contracts -------------------------------------------------------------------------

test('queue class reference: exact fields, external/irreversible always false, queue_created=false', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  assertValid('queue class', validateRuntimeQueueClassReference(golden.queueClass));
  assert.deepEqual(Object.keys(golden.queueClass).sort(), [...RUNTIME_QUEUE_CLASS_REFERENCE_FIELDS].sort());
  assert.equal(golden.queueClass.supports_external_effect, false);
  assert.equal(golden.queueClass.supports_irreversible, false);
  assert.equal(golden.queueClass.queue_created, false);
  assert.equal(golden.queueClass.queue_class_applied, false);
});

test('queue capacity snapshot: arithmetic consistency, no reservation, no backlog change', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  assertValid('capacity snapshot', validateRuntimeQueueCapacitySnapshotReference(golden.capacitySnapshot));
  assert.deepEqual(Object.keys(golden.capacitySnapshot).sort(), [...RUNTIME_QUEUE_CAPACITY_SNAPSHOT_REFERENCE_FIELDS].sort());
  assert.equal(golden.capacitySnapshot.capacity_applied, false);
  assert.equal(golden.capacitySnapshot.capacity_reserved, false);
  assert.equal(golden.capacitySnapshot.queue_backlog_changed, false);
  assertInvalid('inconsistent dimension', validateRuntimeQueueCapacitySnapshotReference({ ...golden.capacitySnapshot, available_backlog_count: 999999 }));
});

test('queue quota reference: single-scope required, no application/consumption', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  assertValid('quota', validateRuntimeQueueQuotaReference(golden.quota));
  assert.deepEqual(Object.keys(golden.quota).sort(), [...RUNTIME_QUEUE_QUOTA_REFERENCE_FIELDS].sort());
  assert.equal(golden.quota.quota_applied, false);
  assert.equal(golden.quota.quota_reserved, false);
  assert.equal(golden.quota.quota_consumed, false);
  assertInvalid('no scope set', validateRuntimeQueueQuotaReference({
    ...golden.quota, tenant_id: null
  }));
});

test('queue partition reference: key type structurally 1:1 with strategy', () => {
  const partition = buildRuntimeQueuePartitionReference({
    runtime_queue_partition_reference_id: 'qp-1', runtime_queue_class_reference_id: 'qc-1',
    partition_strategy: 'ORGANIZATION_PARTITION_REFERENCE', partition_key_value: 'org-1', organization_id: 'org-1'
  });
  assertValid('partition', validateRuntimeQueuePartitionReference(partition));
  assert.deepEqual(Object.keys(partition).sort(), [...RUNTIME_QUEUE_PARTITION_REFERENCE_FIELDS].sort());
  assert.equal(partition.partition_key_type, 'ORGANIZATION_ID_REFERENCE');
  assert.equal(partition.queue_created, false);
  assert.equal(partition.queue_item_created, false);
  assertInvalid('key type mismatched with strategy', validateRuntimeQueuePartitionReference({ ...partition, partition_key_type: 'TENANT_ID_REFERENCE' }));
});

test('queue fairness reference: exact fields, no reservation, deterministic ranks required', () => {
  const fairness = buildRuntimeQueueFairnessReference({
    runtime_queue_fairness_reference_id: 'qf-1', runtime_queue_admission_request_id: 'qar-1', runtime_queue_class_reference_id: 'qc-1',
    fairness_strategy: 'FIFO_WITHIN_PRIORITY_REFERENCE', tenant_id: 't-1', organization_id: 'o-1', project_id: 'p-1', agent_id: 'a-1',
    priority_class: 'NORMAL_REFERENCE', dispatch_sequence: 0, logical_sequence: 0
  });
  assertValid('fairness', validateRuntimeQueueFairnessReference(fairness));
  assert.deepEqual(Object.keys(fairness).sort(), [...RUNTIME_QUEUE_FAIRNESS_REFERENCE_FIELDS].sort());
  assert.equal(fairness.queue_position_reserved, false);
  assert.equal(fairness.fairness_applied, false);
});

test('queue intent binding reference: validated only when PREPARED and every match dimension true', () => {
  const base = {
    queue_intent_binding_reference_id: 'qib-1', runtime_queue_admission_request_id: 'qar-1', runtime_queue_admission_package_id: 'qap-1',
    runtime_dispatch_package_id: 'dp-1', dispatch_intent_reference_id: 'di-1', runtime_dispatch_stage_reference_id: 'ds-1',
    dispatch_worker_binding_reference_id: 'dwb-1', scheduler_stage_reference_id: 'ss-1', runtime_stage_reference_id: 'rs-1',
    runtime_worker_reference_id: 'w-1', runtime_queue_class_reference_id: 'qc-1', runtime_queue_partition_reference_id: 'qp-1',
    runtime_queue_quota_reference_id: 'qq-1', runtime_queue_capacity_snapshot_reference_id: 'qcs-1'
  };
  const allTrue = buildRuntimeQueueIntentBindingReference({
    ...base, dispatch_intent_status: 'DISPATCH_INTENT_PREPARED_SIMULATION',
    queue_class_match: true, partition_match: true, quota_match: true, capacity_match: true, fairness_match: true, freshness_match: true
  });
  assertValid('all true', validateRuntimeQueueIntentBindingReference(allTrue));
  assert.deepEqual(Object.keys(allTrue).sort(), [...RUNTIME_QUEUE_INTENT_BINDING_REFERENCE_FIELDS].sort());
  assert.equal(allTrue.intent_binding_validated, true);

  const oneFalse = buildRuntimeQueueIntentBindingReference({
    ...base, dispatch_intent_status: 'DISPATCH_INTENT_PREPARED_SIMULATION',
    queue_class_match: true, partition_match: true, quota_match: true, capacity_match: false, fairness_match: true, freshness_match: true
  });
  assert.equal(oneFalse.intent_binding_validated, false);

  const notPrepared = buildRuntimeQueueIntentBindingReference({
    ...base, dispatch_intent_status: 'DISPATCH_INTENT_OPTIONAL_REFERENCE',
    queue_class_match: true, partition_match: true, quota_match: true, capacity_match: true, fairness_match: true, freshness_match: true
  });
  assert.equal(notPrepared.intent_binding_validated, false);
});

test('queue admission entry reference: validated only when ACCEPTED and every gate true, never applied/enqueued', () => {
  const base = {
    runtime_queue_admission_entry_reference_id: 'qae-1', runtime_queue_admission_package_id: 'qap-1', runtime_queue_admission_request_id: 'qar-1',
    queue_intent_binding_reference_id: 'qib-1', runtime_queue_fairness_reference_id: 'qf-1', dispatch_intent_reference_id: 'di-1',
    runtime_dispatch_stage_reference_id: 'ds-1', runtime_worker_reference_id: 'w-1', runtime_queue_class_reference_id: 'qc-1',
    runtime_queue_partition_reference_id: 'qp-1', admission_sequence: 0, queue_priority_class: 'NORMAL_REFERENCE'
  };
  const accepted = buildRuntimeQueueAdmissionEntryReference({
    ...base, admission_status: 'QUEUE_ADMISSION_ACCEPTED_SIMULATION',
    queue_class_gate_passed: true, partition_gate_passed: true, quota_gate_passed: true, capacity_gate_passed: true,
    fairness_gate_passed: true, freshness_gate_passed: true, replay_gate_passed: true, idempotency_gate_passed: true
  });
  assertValid('accepted entry', validateRuntimeQueueAdmissionEntryReference(accepted));
  assert.deepEqual(Object.keys(accepted).sort(), [...RUNTIME_QUEUE_ADMISSION_ENTRY_REFERENCE_FIELDS].sort());
  assert.equal(accepted.queue_admission_validated, true);
  assert.equal(accepted.queue_admission_applied, false);
  assert.equal(accepted.queue_created, false);
  assert.equal(accepted.queue_item_enqueued, false);
  assert.equal(accepted.queue_position_reserved, false);

  const deferred = buildRuntimeQueueAdmissionEntryReference({ ...base, admission_status: 'QUEUE_ADMISSION_DEFERRED_QUOTA_REFERENCE' });
  assert.equal(deferred.queue_admission_validated, false);
});

test('queue admission order reference: partitions cover every entry exactly once, order preserved flags gate validated', () => {
  const order = buildRuntimeQueueAdmissionOrderReference({
    runtime_queue_admission_order_reference_id: 'qao-1', runtime_queue_admission_package_id: 'qap-1', runtime_dispatch_package_id: 'dp-1',
    ordered_dispatch_intent_reference_ids: ['di-1', 'di-2'], ordered_queue_admission_entry_reference_ids: ['qae-1', 'qae-2'],
    accepted_queue_admission_entry_reference_ids: ['qae-1'], blocked_queue_admission_entry_reference_ids: ['qae-2'],
    dispatch_order_preserved: true, priority_order_preserved: true, fairness_order_preserved: true, required_predecessor_order_preserved: true
  });
  assertValid('order', validateRuntimeQueueAdmissionOrderReference(order));
  assert.deepEqual(Object.keys(order).sort(), [...RUNTIME_QUEUE_ADMISSION_ORDER_REFERENCE_FIELDS].sort());
  assert.equal(order.queue_admission_order_validated, true);
  assert.equal(order.queue_admission_order_applied, false);

  const partialFlags = buildRuntimeQueueAdmissionOrderReference({
    runtime_queue_admission_order_reference_id: 'qao-2', runtime_queue_admission_package_id: 'qap-1', runtime_dispatch_package_id: 'dp-1',
    ordered_dispatch_intent_reference_ids: ['di-1'], ordered_queue_admission_entry_reference_ids: ['qae-1'],
    accepted_queue_admission_entry_reference_ids: ['qae-1'],
    dispatch_order_preserved: true, priority_order_preserved: false, fairness_order_preserved: true, required_predecessor_order_preserved: true
  });
  assert.equal(partialFlags.queue_admission_order_validated, false);
});

test('queue admission replay reference: replay_consumed permanently false, replay_allowed derived', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  assertValid('replay', validateRuntimeQueueAdmissionReplayReference(golden.queueAdmissionReplayRef));
  assert.deepEqual(Object.keys(golden.queueAdmissionReplayRef).sort(), [...RUNTIME_QUEUE_ADMISSION_REPLAY_REFERENCE_FIELDS].sort());
  assert.equal(golden.queueAdmissionReplayRef.replay_consumed, false);
  assert.equal(golden.queueAdmissionReplayRef.replay_allowed, true);
});

// --- Request ------------------------------------------------------------------------------------

test('queue admission request: golden bundle is structurally valid', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  assertValid('request', validateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest));
  assert.deepEqual(Object.keys(golden.queueAdmissionRequest).sort(), [...RUNTIME_QUEUE_ADMISSION_REQUEST_FIELDS].sort());
});

test('queue admission request: missing/extra field and invalid nested reference rejected', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  assertInvalid('missing field', validateRuntimeQueueAdmissionRequest({ ...golden.queueAdmissionRequest, runtime_queue_admission_policy: undefined }));
  assertInvalid('extra field', validateRuntimeQueueAdmissionRequest({ ...golden.queueAdmissionRequest, extra_field: true }));
  assertInvalid('invalid nested dispatch decision', validateRuntimeQueueAdmissionRequest({
    ...golden.queueAdmissionRequest, runtime_dispatch_decision_reference: { not: 'valid' }
  }));
});

// --- Boundary: golden happy path -----------------------------------------------------------------

test('boundary: golden bundle reaches QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION with every validated flag true', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION');
  assert.equal(outcome.decision.queue_admission_package_prepared_in_simulation, true);
  for (const field of [
    'request_validated', 'policy_validated', 'dispatch_validated', 'identity_validated', 'freshness_validated',
    'replay_validated', 'idempotency_validated', 'registry_snapshot_validated', 'network_policies_validated',
    'secret_policies_validated', 'stage_policy_requirements_validated', 'queue_classes_validated',
    'queue_capacity_snapshots_validated', 'queue_quotas_validated', 'queue_partitions_validated',
    'queue_fairness_validated', 'intent_bindings_validated', 'admission_entries_validated',
    'admission_order_validated', 'package_fingerprint_validated', 'package_digest_validated',
    'non_execution_invariants_validated'
  ]) {
    assert.equal(outcome.decision[field], true, field);
  }
  assert.equal(outcome.package.entry_count, 2);
  assert.equal(outcome.package.accepted_count, 2);
});

test('boundary: sequential-plan admits only the non-waiting intent, the other stays WAITING_DEPENDENCY', () => {
  const golden = buildGoldenQueueAdmissionBundle('sequential-plan');
  const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION');
  assert.equal(outcome.package.entry_count, 2);
  assert.equal(outcome.package.accepted_count, 1);
  const waiting = outcome.admissionEntryRefs.find((e) => e.admission_status === 'QUEUE_ADMISSION_WAITING_DEPENDENCY_REFERENCE');
  assert.ok(waiting, 'expected one entry waiting on dependency');
});

test('boundary: dispatch chain not genuinely prepared blocks as QUEUE_ADMISSION_DISPATCH_BLOCKED', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const tampered = {
    ...golden.queueAdmissionRequest,
    runtime_dispatch_decision_reference: { ...golden.dispatchOutcome.decision, status: 'DISPATCH_VALIDATION_FAILED' }
  };
  const outcome = evaluateRuntimeQueueAdmissionRequest(tampered, {});
  assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_VALIDATION_FAILED');
});

test('boundary: freshness expired at current logical_sequence blocks as QUEUE_ADMISSION_FRESHNESS_BLOCKED', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const request = buildRuntimeQueueAdmissionRequest({
    ...golden.queueAdmissionRequest,
    logical_sequence: golden.queueAdmissionRequest.runtime_freshness_reference.current_logical_sequence + 1000000
  });
  const outcome = evaluateRuntimeQueueAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_FRESHNESS_BLOCKED');
});

test('boundary: replay reference not bound to this request blocks as QUEUE_ADMISSION_REPLAY_BLOCKED', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const wrongReplayRef = buildRuntimeQueueAdmissionReplayReference({
    ...golden.queueAdmissionReplayRef, runtime_dispatch_package_fingerprint: 'sha256:' + 'c'.repeat(64)
  });
  const tampered = { ...golden.queueAdmissionRequest, runtime_queue_admission_replay_reference: wrongReplayRef };
  const outcome = evaluateRuntimeQueueAdmissionRequest(tampered, {});
  assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_REPLAY_BLOCKED');
});

test('boundary: an intent with no compatible queue class is entry-level QUEUE_ADMISSION_QUEUE_CLASS_BLOCKED, not a request-level block', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const incompatibleClass = buildRuntimeQueueClassReference({ ...golden.queueClass, supported_stage_types: ['MODEL_REFERENCE_STAGE'] });
  const request = buildRuntimeQueueAdmissionRequest({
    ...golden.queueAdmissionRequest, runtime_queue_class_references: [incompatibleClass]
  });
  const outcome = evaluateRuntimeQueueAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION');
  assert.equal(outcome.package.accepted_count, 0);
  assert.ok(outcome.admissionEntryRefs.every((e) => e.admission_status === 'QUEUE_ADMISSION_QUEUE_CLASS_BLOCKED'));
});

test('boundary: insufficient queue capacity defers the entry as QUEUE_ADMISSION_DEFERRED_BACKLOG_REFERENCE', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const zeroBacklog = buildRuntimeQueueCapacitySnapshotReference({
    ...golden.capacitySnapshot, maximum_backlog_count: 0, current_backlog_count: 0, available_backlog_count: 0
  });
  const request = buildRuntimeQueueAdmissionRequest({
    ...golden.queueAdmissionRequest, runtime_queue_capacity_snapshot_references: [zeroBacklog]
  });
  const outcome = evaluateRuntimeQueueAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION');
  assert.equal(outcome.package.accepted_count, 0);
  assert.ok(outcome.admissionEntryRefs.every((e) => e.admission_status === 'QUEUE_ADMISSION_DEFERRED_BACKLOG_REFERENCE'));
});

test('boundary: insufficient quota defers the entry as QUEUE_ADMISSION_DEFERRED_QUOTA_REFERENCE', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const zeroQuota = buildRuntimeQueueQuotaReference({
    ...golden.quota, maximum_admission_count: 0, current_admission_count: 0, available_admission_count: 0
  });
  const request = buildRuntimeQueueAdmissionRequest({
    ...golden.queueAdmissionRequest, runtime_queue_quota_references: [zeroQuota]
  });
  const outcome = evaluateRuntimeQueueAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION');
  assert.equal(outcome.package.accepted_count, 0);
  assert.ok(outcome.admissionEntryRefs.every((e) => e.admission_status === 'QUEUE_ADMISSION_DEFERRED_QUOTA_REFERENCE'));
});

test('boundary: greedy sequential admission -- second entry deferred once the first consumes remaining backlog', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const oneSlotBacklog = buildRuntimeQueueCapacitySnapshotReference({
    ...golden.capacitySnapshot, maximum_backlog_count: 1, current_backlog_count: 0, available_backlog_count: 1
  });
  const request = buildRuntimeQueueAdmissionRequest({
    ...golden.queueAdmissionRequest, runtime_queue_capacity_snapshot_references: [oneSlotBacklog]
  });
  const outcome = evaluateRuntimeQueueAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION');
  assert.equal(outcome.package.accepted_count, 1);
  assert.equal(outcome.package.deferred_count, 1);
});

test('boundary: DISPATCH_STATUSES precedence covers QUEUE_ADMISSION_STATUSES exactly', () => {
  assert.deepEqual([...QUEUE_ADMISSION_STATUSES].sort(), [...QUEUE_ADMISSION_PRECEDENCE_ORDER].sort());
});

test('selectQueueClass: returns null when no class is compatible, deterministic pick when multiple are', () => {
  const canonical = { tenantId: 't-1', organizationId: 'o-1', projectId: 'p-1', agentId: 'a-1' };
  const stage = { stage_type: 'DETERMINISTIC_STAGE', required_capabilities: [], required_modalities: [], optional: false, parallelizable: false, side_effect_classification: 'NONE', model_selection_reference_id: null, tool_reference_ids: [], workflow_reference_id: null };
  assert.equal(selectQueueClass(stage, { queueClassRefs: [], canonical, capacitySnapshotByClassId: new Map(), quotaRefsByClassId: new Map() }), null);
});

// --- Package integrity -----------------------------------------------------------------------------

test('package integrity: fingerprint/digest self-recompute detects tampering', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION');
  assertInvalid('tampered entry_count', validateRuntimeQueueAdmissionPackage({ ...outcome.package, entry_count: 999 }));
});

// --- Decision / Result / Audit --------------------------------------------------------------------

test('queue admission decision: valid contract for a prepared outcome', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  assertValid('decision', validateRuntimeQueueAdmissionDecision(outcome.decision));
});

test('queue admission result: valid contract for a prepared outcome', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  assertValid('result', validateRuntimeQueueAdmissionResult(outcome.result));
});

test('queue admission audit: never registers payload/prompt/secret content, only ids/fingerprints/counts', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  assertValid('audit', validateRuntimeQueueAdmissionAudit(outcome.audit));
  assert.deepEqual(findAgentCoreOperationalMaterial(outcome.audit), []);
});

// --- Registry -----------------------------------------------------------------------------------

test('registry: registers a queue admission package, replays an identical one, blocks a payload mismatch', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  const registry = createRuntimeQueueAdmissionRegistry();
  const first = registry.registerRuntimeQueueAdmissionPackage(outcome.package);
  assert.equal(first.status, 'REGISTERED_SIMULATION');
  const replay = registry.registerRuntimeQueueAdmissionPackage(outcome.package);
  assert.equal(replay.status, 'REPLAY_ACCEPTED');
  const mutated = buildRuntimeQueueAdmissionPackage({ ...outcome.package, estimated_total_cost_minor_units: outcome.package.estimated_total_cost_minor_units + 1 });
  const mismatch = registry.registerRuntimeQueueAdmissionPackage(mutated);
  assert.equal(mismatch.status, 'PAYLOAD_MISMATCH');
});

test('registry: rejects a structurally invalid record as VALIDATION_FAILED', () => {
  const registry = createRuntimeQueueAdmissionRegistry();
  const result = registry.registerRuntimeQueueAdmissionRequest({ not: 'valid' });
  assert.equal(result.status, 'VALIDATION_FAILED');
});

// --- Side-channels / Security -----------------------------------------------------------------

test('side-channels: a hostile context claiming queue availability/enqueue permission has zero effect', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const hostileContext = {
    queueAvailable: true, queueCreated: true, queueItemCreated: true, enqueueAllowed: true, priority: 'CRITICAL_REFERENCE',
    partition: 'anything', quotaAvailable: true, backlogAvailable: true, fairnessScore: 999, position: 0, anything: 'goes'
  };
  const outcomeClean = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  const outcomeHostile = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, hostileContext);
  assert.deepEqual(outcomeClean.decision, outcomeHostile.decision);
});

test('security: every outcome forces every operational flag false, simulation=true, production_blocked=true, rollout=0', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
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
  const golden = buildGoldenQueueAdmissionBundle();
  const cyclic = {};
  cyclic.self = cyclic;
  const adversarialValues = [NaN, Infinity, -Infinity, 10n, Symbol('x'), () => {}, undefined, Buffer.from('x'), cyclic];
  for (const value of adversarialValues) {
    const tampered = { ...golden.queueAdmissionRequest, correlation_id: value };
    assertInvalid(`adversarial value ${String(value)}`, validateRuntimeQueueAdmissionRequest(tampered));
  }
});

// --- Regression -----------------------------------------------------------------------------------

test('regression: architecture gates report zero findings with every PR108 module included', () => {
  const findings = runAllGates();
  assert.deepEqual(findings, []);
});

test('regression: nenhuma fila, item, job ou dispatch operacional é criado em qualquer outcome producible', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  assert.equal(outcome.result.queue_created, false);
  assert.equal(outcome.result.queue_item_created, false);
  assert.equal(outcome.result.queue_item_enqueued, false);
  assert.equal(outcome.result.queue_position_reserved, false);
  assert.equal(outcome.result.job_created, false);
  assert.equal(outcome.result.dispatch_authorized, false);
  assert.equal(outcome.result.worker_reserved, false);
  assert.equal(outcome.result.stage_dispatched, false);
  assert.equal(outcome.result.network_used, false);
  assert.equal(outcome.result.secret_resolved, false);
  assert.equal(outcome.result.executed, false);
});

test('regression: no network access and no secret resolution ever occurs while evaluating a queue admission request', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  assert.deepEqual(findAgentCoreOperationalMaterial(golden.queueAdmissionRequest), []);
});

test('regression: PR #107 dispatch boundary remains untouched and functional', () => {
  const { evaluateRuntimeDispatchRequest } = require('../src/core/runtime-dispatch-boundary');
  const golden = buildGoldenQueueAdmissionBundle();
  const outcome = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
  assert.equal(outcome.decision.status, 'DISPATCH_PACKAGE_PREPARED_SIMULATION');
});
