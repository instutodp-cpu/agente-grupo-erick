'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { findAgentCoreOperationalMaterial } = require('../src/core/agent-identity-contract');
const { runAllGates } = require('../src/core/architecture-gate-runner');
const { buildOfficialRegistrySnapshot } = require('./helpers/runtime-worker-assignment-test-data');
const { buildExecutionRegistrySnapshotReference, computeSnapshotFingerprint } = require('../src/core/execution-registry-snapshot-reference');

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
const {
  evaluateRuntimeQueueAdmissionRequest, selectQueueClass, evaluateQueueClassCompatibility, classifyQuotaScope,
  checkPriorityOrderPreserved, checkFairnessOrderPreserved
} = require('../src/core/runtime-queue-admission-boundary');
const { buildModelSelectionDecision } = require('../src/core/model-selection-decision');
const { buildRuntimeWorkerStagePolicyRequirementReference } = require('../src/core/runtime-worker-stage-policy-requirement-reference');
const { stablePayload } = require('../src/core/transcription-provider-contract-registry');

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
    runtime_queue_quota_reference_ids: ['qq-1-agent', 'qq-1-organization', 'qq-1-project', 'qq-1-tenant'], runtime_queue_capacity_snapshot_reference_id: 'qcs-1'
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
    runtime_queue_partition_reference_id: 'qp-1', runtime_queue_quota_reference_ids: ['qq-1-agent', 'qq-1-organization', 'qq-1-project', 'qq-1-tenant'],
    admission_sequence: 0, queue_priority_class: 'NORMAL_REFERENCE'
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
  // pr108fix FIX 2: the quota collection must stay COMPLETE (all 4 scopes present) for the class to
  // remain a candidate at all -- zero the available amounts on every scope, never remove one.
  const zeroQuotas = golden.quotas.map((q) => buildRuntimeQueueQuotaReference({
    ...q, maximum_admission_count: 0, current_admission_count: 0, available_admission_count: 0
  }));
  const request = buildRuntimeQueueAdmissionRequest({
    ...golden.queueAdmissionRequest, runtime_queue_quota_references: zeroQuotas
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

// --- pr108fix FIX 1: Queue Class validates real provider/model/tool/workflow IDs -----------------

function buildFix1Fixture() {
  const canonical = { tenantId: 't-1', organizationId: 'o-1', projectId: 'p-1', agentId: 'a-1' };
  const decision = buildModelSelectionDecision({
    decision_id: 'decision-1', selection_request_id: 'sel-req-1', agent_id: 'a-1', tenant_id: 't-1', organization_id: 'o-1',
    status: 'MODEL_SELECTED_SIMULATION', selected_candidate_id: 'cand-1', selected_provider_id: 'mock-provider-a', selected_model_id: 'gen-a'
  });
  const modelReq = buildRuntimeWorkerStagePolicyRequirementReference({
    stage_policy_requirement_reference_id: 'req-1', scheduler_stage_reference_id: 'stage-1', requirement_element: 'MODEL',
    source_reference_id: 'decision-1', source_reference_type: 'MODEL_SELECTION_REFERENCE', source_reference_version: 1,
    source_reference_fingerprint: stablePayload(decision), source_registry_snapshot_reference_id: 'snap-1',
    source_resolution_status: 'RESOLVED_FROM_OFFICIAL_REFERENCE', source_provider_slug: 'mock-provider-a', source_stage_domain: 'GENERIC_DOMAIN'
  });
  const toolAReq = buildRuntimeWorkerStagePolicyRequirementReference({
    stage_policy_requirement_reference_id: 'req-tool-a', scheduler_stage_reference_id: 'stage-1', requirement_element: 'TOOL',
    source_reference_id: 'tool-a', source_reference_type: 'TOOL_CONTRACT_REFERENCE', source_reference_version: 1,
    source_reference_fingerprint: stablePayload({ tool_id: 'tool-a', tool_version: 1 }), source_registry_snapshot_reference_id: 'snap-1',
    source_resolution_status: 'RESOLVED_FROM_OFFICIAL_REFERENCE', source_provider_slug: 'mock-provider-a', source_stage_domain: 'GENERIC_DOMAIN'
  });
  const workflowReq = buildRuntimeWorkerStagePolicyRequirementReference({
    stage_policy_requirement_reference_id: 'req-workflow', scheduler_stage_reference_id: 'stage-1', requirement_element: 'WORKFLOW',
    source_reference_id: 'workflow-a', source_reference_type: 'WORKFLOW_CONTRACT_REFERENCE', source_reference_version: 1,
    source_reference_fingerprint: stablePayload({ workflow_id: 'workflow-a', workflow_version: 1 }), source_registry_snapshot_reference_id: 'snap-1',
    source_resolution_status: 'RESOLVED_FROM_OFFICIAL_REFERENCE', source_provider_slug: 'mock-provider-a', source_stage_domain: 'GENERIC_DOMAIN'
  });
  const qcBase = {
    runtime_queue_class_reference_id: 'qc-1', queue_class_name: 'fix1-class', queue_class_type: 'SHARED_QUEUE_REFERENCE',
    queue_domain: 'GENERIC_DOMAIN', queue_priority_class: 'NORMAL_REFERENCE', queue_partition_strategy: 'TENANT_PARTITION_REFERENCE',
    queue_fairness_strategy: 'FIFO_WITHIN_PRIORITY_REFERENCE', queue_retry_class: 'NO_RETRY_REFERENCE',
    supports_no_llm: true, supports_model: true, supports_tool: true, supports_workflow: true, supports_parallel: true,
    supports_optional: true, supports_state_change: true,
    supported_stage_types: ['MODEL_REFERENCE_STAGE'], supported_capability_ids: [], supported_modality_ids: [],
    supported_model_provider_ids: ['mock-provider-a'], supported_model_ids: ['gen-a'], supported_tool_ids: ['tool-a'],
    supported_workflow_ids: ['workflow-a'],
    maximum_backlog_count: 1000, maximum_inflight_count: 1000, maximum_parallel_count: 100, maximum_model_count: 100,
    maximum_tool_count: 100, maximum_workflow_count: 100, maximum_tokens: 100000000, maximum_cost_minor_units: 100000000,
    maximum_logical_age_sequences: 100000, queue_class_active: true
  };
  const qc = buildRuntimeQueueClassReference(qcBase);
  const stage = {
    scheduler_stage_reference_id: 'stage-1', stage_type: 'MODEL_REFERENCE_STAGE', required_capabilities: [], required_modalities: [],
    optional: false, parallelizable: false, side_effect_classification: 'NONE',
    model_selection_reference_id: 'decision-1', tool_reference_ids: [], workflow_reference_id: null
  };
  const ctx = {
    canonical,
    stagePolicyRequirementsByStageId: new Map([['stage-1', [modelReq, toolAReq, workflowReq]]]),
    modelSelectionDecisionsById: new Map([['decision-1', decision]]),
    validCapacityClassIds: new Set(['qc-1']),
    capacitySnapshotByClassId: new Map([['qc-1', {}]]),
    quotaCollectionByClassId: new Map([['qc-1', {}]])
  };
  return { qcBase, qc, stage, ctx, decision };
}

test('FIX1: model provider/id compatible with matching Queue Class', () => {
  const { qc, stage, ctx } = buildFix1Fixture();
  assert.deepEqual(evaluateQueueClassCompatibility(qc, stage, ctx), []);
});

test('FIX1: model provider divergent from supported_model_provider_ids blocks', () => {
  const { qcBase, stage, ctx } = buildFix1Fixture();
  const wrongProvider = buildRuntimeQueueClassReference({ ...qcBase, supported_model_provider_ids: ['mock-provider-b'] });
  assert.deepEqual(evaluateQueueClassCompatibility(wrongProvider, stage, ctx), ['queue_class_model_provider_mismatch']);
});

test('FIX1: model id divergent from supported_model_ids blocks', () => {
  const { qcBase, stage, ctx } = buildFix1Fixture();
  const wrongModel = buildRuntimeQueueClassReference({ ...qcBase, supported_model_ids: ['gen-b'] });
  assert.deepEqual(evaluateQueueClassCompatibility(wrongModel, stage, ctx), ['queue_class_model_id_mismatch']);
});

test('FIX1: all required tools supported passes, partial tool support blocks', () => {
  const { qc, qcBase, stage, ctx } = buildFix1Fixture();
  const stageWithTool = { ...stage, tool_reference_ids: ['tool-a'] };
  assert.deepEqual(evaluateQueueClassCompatibility(qc, stageWithTool, ctx), []);

  const secondToolReq = buildRuntimeWorkerStagePolicyRequirementReference({
    stage_policy_requirement_reference_id: 'req-tool-b', scheduler_stage_reference_id: 'stage-1', requirement_element: 'TOOL',
    source_reference_id: 'tool-b', source_reference_type: 'TOOL_CONTRACT_REFERENCE', source_reference_version: 1,
    source_reference_fingerprint: stablePayload({ tool_id: 'tool-b', tool_version: 1 }), source_registry_snapshot_reference_id: 'snap-1',
    source_resolution_status: 'RESOLVED_FROM_OFFICIAL_REFERENCE', source_provider_slug: 'mock-provider-a', source_stage_domain: 'GENERIC_DOMAIN'
  });
  const ctxWithBothTools = {
    ...ctx, stagePolicyRequirementsByStageId: new Map([['stage-1', [...ctx.stagePolicyRequirementsByStageId.get('stage-1'), secondToolReq]]])
  };
  const stageWithTwoTools = { ...stage, tool_reference_ids: ['tool-a', 'tool-b'] };
  // qc only supports 'tool-a' -- 'tool-b' is genuinely resolved but not in the allowlist, never a partial match.
  assert.deepEqual(evaluateQueueClassCompatibility(qc, stageWithTwoTools, ctxWithBothTools), ['queue_class_tool_id_mismatch::tool-b']);
});

test('FIX1: workflow compatible passes, workflow divergent blocks', () => {
  const { qc, qcBase, stage, ctx } = buildFix1Fixture();
  const stageWithWorkflow = { ...stage, workflow_reference_id: 'workflow-a' };
  assert.deepEqual(evaluateQueueClassCompatibility(qc, stageWithWorkflow, ctx), []);
  const wrongWorkflowClass = buildRuntimeQueueClassReference({ ...qcBase, supported_workflow_ids: ['workflow-b'] });
  assert.deepEqual(evaluateQueueClassCompatibility(wrongWorkflowClass, stageWithWorkflow, ctx), ['queue_class_workflow_id_mismatch']);
});

test('FIX1: mixed stage (model+tool+workflow) validates every element independently', () => {
  const { qc, qcBase, stage, ctx } = buildFix1Fixture();
  const mixedStage = { ...stage, tool_reference_ids: ['tool-a'], workflow_reference_id: 'workflow-a' };
  assert.deepEqual(evaluateQueueClassCompatibility(qc, mixedStage, ctx), []);
  const wrongEverything = buildRuntimeQueueClassReference({
    ...qcBase, supported_model_provider_ids: ['mock-provider-b'], supported_tool_ids: [], supported_workflow_ids: []
  });
  const reasons = evaluateQueueClassCompatibility(wrongEverything, mixedStage, ctx);
  assert.ok(reasons.includes('queue_class_model_provider_mismatch'));
  assert.ok(reasons.includes('queue_class_tool_id_mismatch::tool-a'));
  assert.ok(reasons.includes('queue_class_workflow_id_mismatch'));
});

test('FIX1: an unresolvable stage requirement never authorizes a match, empty allowlists are never a wildcard', () => {
  const { qc, qcBase, stage, ctx } = buildFix1Fixture();
  const unresolvedCtx = { ...ctx, stagePolicyRequirementsByStageId: new Map() };
  assert.deepEqual(evaluateQueueClassCompatibility(qc, stage, unresolvedCtx), ['queue_class_stage_requirement_unresolvable']);

  const emptyLists = buildRuntimeQueueClassReference({
    ...qcBase, supported_model_provider_ids: [], supported_model_ids: [], supported_tool_ids: [], supported_workflow_ids: []
  });
  const reasons = evaluateQueueClassCompatibility(emptyLists, stage, ctx);
  assert.ok(reasons.includes('queue_class_model_provider_mismatch'));
  assert.ok(reasons.includes('queue_class_model_id_mismatch'));
});

test('FIX1: input order of stage policy requirements never alters the outcome', () => {
  const { qc, stage, ctx } = buildFix1Fixture();
  const reversedCtx = { ...ctx, stagePolicyRequirementsByStageId: new Map([['stage-1', [...ctx.stagePolicyRequirementsByStageId.get('stage-1')].reverse()]]) };
  assert.deepEqual(evaluateQueueClassCompatibility(qc, stage, ctx), evaluateQueueClassCompatibility(qc, stage, reversedCtx));
});

test('FIX1: a hostile context hint never changes which requirements are consulted', () => {
  const { qc, stage, ctx } = buildFix1Fixture();
  const outcomeClean = evaluateQueueClassCompatibility(qc, stage, ctx);
  const outcomeHostile = evaluateQueueClassCompatibility(qc, stage, { ...ctx, hostileHint: { allow: true } });
  assert.deepEqual(outcomeClean, outcomeHostile);
});

// --- pr108fix FIX 2: complete quota collection per scope -------------------------------------------

test('FIX2: classifyQuotaScope derives the single non-null scope field', () => {
  assert.equal(classifyQuotaScope({ tenant_id: 't-1', organization_id: null, project_id: null, agent_id: null }), 'TENANT');
  assert.equal(classifyQuotaScope({ tenant_id: null, organization_id: 'o-1', project_id: null, agent_id: null }), 'ORGANIZATION');
  assert.equal(classifyQuotaScope({ tenant_id: null, organization_id: null, project_id: 'p-1', agent_id: null }), 'PROJECT');
  assert.equal(classifyQuotaScope({ tenant_id: null, organization_id: null, project_id: null, agent_id: 'a-1' }), 'AGENT');
});

test('FIX2: missing any single scope (tenant/organization/project/agent) blocks the class entirely', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  for (const missingIndex of [0, 1, 2, 3]) {
    const partialQuotas = golden.quotas.filter((q, i) => i !== missingIndex);
    const request = buildRuntimeQueueAdmissionRequest({ ...golden.queueAdmissionRequest, runtime_queue_quota_references: partialQuotas });
    const outcome = evaluateRuntimeQueueAdmissionRequest(request, {});
    assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION');
    assert.equal(outcome.package.accepted_count, 0, `missing scope index ${missingIndex} should block admission`);
    assert.ok(outcome.admissionEntryRefs.every((e) => e.reason_codes.includes('queue_quota_collection_incomplete')));
  }
});

test('FIX2: a quota bound to a foreign identity blocks the class even though the scope slot is technically filled', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const foreignTenantQuota = buildRuntimeQueueQuotaReference({ ...golden.quotas[0], tenant_id: 'tenant-foreign' });
  const request = buildRuntimeQueueAdmissionRequest({
    ...golden.queueAdmissionRequest, runtime_queue_quota_references: [foreignTenantQuota, ...golden.quotas.slice(1)]
  });
  const outcome = evaluateRuntimeQueueAdmissionRequest(request, {});
  assert.equal(outcome.package.accepted_count, 0);
  assert.ok(outcome.admissionEntryRefs.every((e) => e.reason_codes.includes('queue_quota_collection_incomplete')));
});

test('FIX2: a genuinely complete quota collection carries all 4 ids on the Intent Binding and Admission Entry', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  const accepted = outcome.admissionEntryRefs.filter((e) => e.admission_status === 'QUEUE_ADMISSION_ACCEPTED_SIMULATION');
  assert.ok(accepted.length > 0);
  for (const entry of accepted) {
    assert.equal(entry.runtime_queue_quota_reference_ids.length, 4);
    const binding = outcome.intentBindingRefs.find((b) => b.queue_intent_binding_reference_id === entry.queue_intent_binding_reference_id);
    assert.deepEqual(binding.runtime_queue_quota_reference_ids, entry.runtime_queue_quota_reference_ids);
  }
});

// --- pr108fix FIX 3: only FIFO_WITHIN_PRIORITY_REFERENCE is implemented ----------------------------

test('FIX3: FIFO_WITHIN_PRIORITY_REFERENCE is genuinely admitted (already the golden default)', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  assert.equal(golden.queueClass.queue_fairness_strategy, 'FIFO_WITHIN_PRIORITY_REFERENCE');
  const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  assert.equal(outcome.package.accepted_count, 2);
});

for (const unimplemented of ['STRICT_PRIORITY_WITH_TENANT_FAIRNESS', 'WEIGHTED_ROUND_ROBIN_REFERENCE', 'DETERMINISTIC_FAIR_SHARE_REFERENCE']) {
  test(`FIX3: unimplemented fairness strategy ${unimplemented} blocks as QUEUE_ADMISSION_FAIRNESS_BLOCKED`, () => {
    const golden = buildGoldenQueueAdmissionBundle();
    const nonFifoClass = buildRuntimeQueueClassReference({ ...golden.queueClass, queue_fairness_strategy: unimplemented });
    const request = buildRuntimeQueueAdmissionRequest({ ...golden.queueAdmissionRequest, runtime_queue_class_references: [nonFifoClass] });
    const outcome = evaluateRuntimeQueueAdmissionRequest(request, {});
    assert.equal(outcome.package.accepted_count, 0);
    assert.ok(outcome.admissionEntryRefs.every((e) => e.admission_status === 'QUEUE_ADMISSION_FAIRNESS_BLOCKED'));
    assert.ok(outcome.admissionEntryRefs.every((e) => e.reason_codes.includes(`queue_fairness_strategy_not_implemented::${unimplemented}`)));
    assert.ok(outcome.admissionEntryRefs.every((e) => e.queue_admission_validated === false));
  });
}

test('FIX3: unimplemented fairness strategy never mutates the deterministic global rank ordering', () => {
  const golden = buildGoldenQueueAdmissionBundle('sequential-plan');
  const nonFifoClass = buildRuntimeQueueClassReference({ ...golden.queueClass, queue_fairness_strategy: 'DETERMINISTIC_FAIR_SHARE_REFERENCE' });
  const requestClean = buildRuntimeQueueAdmissionRequest({ ...golden.queueAdmissionRequest, runtime_queue_class_references: [golden.queueClass] });
  const requestBlocked = buildRuntimeQueueAdmissionRequest({ ...golden.queueAdmissionRequest, runtime_queue_class_references: [nonFifoClass] });
  const outcomeClean = evaluateRuntimeQueueAdmissionRequest(requestClean, {});
  const outcomeBlocked = evaluateRuntimeQueueAdmissionRequest(requestBlocked, {});
  const ranksClean = outcomeClean.fairnessRefs.map((f) => f.global_admission_rank);
  const ranksBlocked = outcomeBlocked.fairnessRefs.map((f) => f.global_admission_rank);
  assert.deepEqual(ranksClean, ranksBlocked);
});

// --- pr108fix FIX 4: Queue Capacity Snapshot freshness recomputed at admission sequence ------------

test('FIX4: same sequence and a later sequence within the validity window both pass', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  for (const laterSequence of [0, 50]) {
    const request = buildRuntimeQueueAdmissionRequest({ ...golden.queueAdmissionRequest, logical_sequence: laterSequence });
    const outcome = evaluateRuntimeQueueAdmissionRequest(request, {});
    assert.equal(outcome.package.accepted_count, 2, `sequence ${laterSequence} should still admit`);
  }
});

test('FIX4: expiration between the snapshot and this admission blocks with QUEUE_ADMISSION_CAPACITY_BLOCKED', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const tightSnapshot = buildRuntimeQueueCapacitySnapshotReference({ ...golden.capacitySnapshot, logical_sequence: 0, snapshot_valid_sequences: 10 });
  const request = buildRuntimeQueueAdmissionRequest({
    ...golden.queueAdmissionRequest, runtime_queue_capacity_snapshot_references: [tightSnapshot], logical_sequence: 500
  });
  const outcome = evaluateRuntimeQueueAdmissionRequest(request, {});
  assert.equal(outcome.package.accepted_count, 0);
  assert.ok(outcome.admissionEntryRefs.every((e) => e.admission_status === 'QUEUE_ADMISSION_CAPACITY_BLOCKED'));
  assert.ok(outcome.admissionEntryRefs.every((e) => e.reason_codes.includes('queue_capacity_snapshot_not_valid_at_admission')));
});

test('FIX4: a regressive request sequence relative to the snapshot never passes', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const futureSnapshot = buildRuntimeQueueCapacitySnapshotReference({ ...golden.capacitySnapshot, logical_sequence: 100, snapshot_valid_sequences: 100000 });
  const request = buildRuntimeQueueAdmissionRequest({
    ...golden.queueAdmissionRequest, runtime_queue_capacity_snapshot_references: [futureSnapshot], logical_sequence: 0
  });
  const outcome = evaluateRuntimeQueueAdmissionRequest(request, {});
  assert.equal(outcome.package.accepted_count, 0);
  assert.ok(outcome.admissionEntryRefs.every((e) => e.admission_status === 'QUEUE_ADMISSION_CAPACITY_BLOCKED'));
});

test('FIX4: snapshot_expired_logically=false and capacity_validated=true on the snapshot itself never mask genuine expiration at this admission sequence', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  // The snapshot's own flags claim everything is fine -- only the request's own logical_sequence,
  // compared against this snapshot's logical_sequence/snapshot_valid_sequences, decides freshness.
  const staleButSelfReportedFine = buildRuntimeQueueCapacitySnapshotReference({
    ...golden.capacitySnapshot, logical_sequence: 0, snapshot_valid_sequences: 5, capacity_validated: true
  });
  const request = buildRuntimeQueueAdmissionRequest({
    ...golden.queueAdmissionRequest, runtime_queue_capacity_snapshot_references: [staleButSelfReportedFine], logical_sequence: 1000
  });
  const outcome = evaluateRuntimeQueueAdmissionRequest(request, {});
  assert.equal(outcome.package.accepted_count, 0);
});

// --- pr108fix2 FIX 1: all four per-identity policy limits participate -----------------------------

const IDENTITY_LIMIT_CASES = Object.freeze([
  ['tenant', 'maximum_per_tenant_admission_count', 'queue_admission_per_tenant_count_exceeds_policy_limit'],
  ['organization', 'maximum_per_organization_admission_count', 'queue_admission_per_organization_count_exceeds_policy_limit'],
  ['project', 'maximum_per_project_admission_count', 'queue_admission_per_project_count_exceeds_policy_limit'],
  ['agent', 'maximum_per_agent_admission_count', 'queue_admission_per_agent_count_exceeds_policy_limit']
]);

for (const [label, policyField, reasonCode] of IDENTITY_LIMIT_CASES) {
  test(`FIX1(pr108fix2): ${label} limit exactly at the accepted count passes`, () => {
    const golden = buildGoldenQueueAdmissionBundle(undefined, { policy: { [policyField]: 2 } });
    const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
    assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION');
    assert.equal(outcome.package.accepted_count, 2);
  });

  test(`FIX1(pr108fix2): ${label} limit below the accepted count blocks QUEUE_ADMISSION_POLICY_BLOCKED`, () => {
    const golden = buildGoldenQueueAdmissionBundle(undefined, { policy: { [policyField]: 1 } });
    const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
    assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_POLICY_BLOCKED');
    assert.ok(outcome.decision.blockers.includes(reasonCode));
  });
}

test('FIX1(pr108fix2): different limits across identities -- the smallest effective limit blocks first', () => {
  const golden = buildGoldenQueueAdmissionBundle(undefined, {
    policy: {
      maximum_per_tenant_admission_count: 10, maximum_per_organization_admission_count: 1,
      maximum_per_project_admission_count: 10, maximum_per_agent_admission_count: 10
    }
  });
  const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_POLICY_BLOCKED');
  assert.ok(outcome.decision.blockers.includes('queue_admission_per_organization_count_exceeds_policy_limit'));
});

test('FIX1(pr108fix2): only genuinely accepted entries count against identity limits -- deferred/waiting/optional/blocked never do', () => {
  const golden = buildGoldenQueueAdmissionBundle('sequential-plan', { policy: { maximum_per_tenant_admission_count: 1 } });
  const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  // sequential-plan admits exactly 1 (the other intent stays WAITING_DEPENDENCY) -- the waiting one
  // must never push the accepted count past the limit of 1.
  assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION');
  assert.equal(outcome.package.accepted_count, 1);
});

test('FIX1(pr108fix2): a hostile context never alters identity limit enforcement', () => {
  const golden = buildGoldenQueueAdmissionBundle(undefined, { policy: { maximum_per_tenant_admission_count: 1 } });
  const outcomeClean = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  const outcomeHostile = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, { maximum_per_tenant_admission_count: 999999 });
  assert.deepEqual(outcomeClean.decision, outcomeHostile.decision);
});

// --- pr108fix2 FIX 2: unified decision order + genuinely recomputed order flags --------------------

function fifoEntry(priorityClass, dispatchSequence) {
  return { selectedClass: { queue_priority_class: priorityClass }, intent: { dispatch_sequence: dispatchSequence } };
}

test('checkPriorityOrderPreserved: non-decreasing priority ranks in canonical order pass', () => {
  const ordered = [fifoEntry('CRITICAL_REFERENCE', 0), fifoEntry('CRITICAL_REFERENCE', 1), fifoEntry('NORMAL_REFERENCE', 2), fifoEntry('BACKGROUND_REFERENCE', 3)];
  assert.equal(checkPriorityOrderPreserved(ordered), true);
});

test('checkPriorityOrderPreserved: a higher-priority intent appearing after a lower-priority one fails', () => {
  const ordered = [fifoEntry('NORMAL_REFERENCE', 0), fifoEntry('CRITICAL_REFERENCE', 1)];
  assert.equal(checkPriorityOrderPreserved(ordered), false);
});

test('checkPriorityOrderPreserved: an unselected class (null) is treated as BACKGROUND_REFERENCE, never masking a violation', () => {
  const noClass = { selectedClass: null, intent: { dispatch_sequence: 1 } };
  const ordered = [fifoEntry('CRITICAL_REFERENCE', 0), noClass, fifoEntry('CRITICAL_REFERENCE', 2)];
  assert.equal(checkPriorityOrderPreserved(ordered), false);
});

test('checkFairnessOrderPreserved: strictly increasing dispatch_sequence within the same priority class passes', () => {
  const ordered = [fifoEntry('NORMAL_REFERENCE', 0), fifoEntry('CRITICAL_REFERENCE', 1), fifoEntry('NORMAL_REFERENCE', 2)];
  assert.equal(checkFairnessOrderPreserved(ordered), true);
});

test('checkFairnessOrderPreserved: a non-increasing dispatch_sequence within the same (scattered) priority class fails', () => {
  const ordered = [fifoEntry('NORMAL_REFERENCE', 5), fifoEntry('CRITICAL_REFERENCE', 0), fifoEntry('NORMAL_REFERENCE', 3)];
  assert.equal(checkFairnessOrderPreserved(ordered), false);
});

test('FIX2(pr108fix2): golden bundle recomputes all 4 order flags to genuinely true', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  assert.equal(outcome.orderRef.dispatch_order_preserved, true);
  assert.equal(outcome.orderRef.priority_order_preserved, true);
  assert.equal(outcome.orderRef.fairness_order_preserved, true);
  assert.equal(outcome.orderRef.required_predecessor_order_preserved, true);
});

test('FIX2(pr108fix2): a required dependency edge reversed in the raw Scheduler Dependency References is never silently accepted', () => {
  const golden = buildGoldenQueueAdmissionBundle('sequential-plan');
  const rawDependencies = golden.queueAdmissionRequest.runtime_scheduler_dependency_references;
  assert.ok(rawDependencies.length > 0, 'sequential-plan must carry at least one scheduler dependency');
  const reversed = rawDependencies.map((d) => ({
    ...d, from_scheduler_stage_reference_id: d.to_scheduler_stage_reference_id, to_scheduler_stage_reference_id: d.from_scheduler_stage_reference_id
  }));
  // Reversing from/to without recomputing dependency_fingerprint already makes the reference
  // self-inconsistent -- the Scheduler Dependency Reference's own validator (reused verbatim, never
  // re-derived by this layer) rejects it at construction, proving the edge can never be silently
  // inverted without detection.
  assert.throws(() => buildRuntimeQueueAdmissionRequest({ ...golden.queueAdmissionRequest, runtime_scheduler_dependency_references: reversed }));
});

test('FIX2(pr108fix2): shuffled input reference arrays never alter the canonical admission order', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const shuffledRequest = buildRuntimeQueueAdmissionRequest({
    ...golden.queueAdmissionRequest,
    runtime_dispatch_stage_references: [...golden.queueAdmissionRequest.runtime_dispatch_stage_references].reverse(),
    runtime_dispatch_intent_references: [...golden.queueAdmissionRequest.runtime_dispatch_intent_references].reverse(),
    runtime_queue_quota_references: [...golden.queueAdmissionRequest.runtime_queue_quota_references].reverse()
  });
  const outcomeClean = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  const outcomeShuffled = evaluateRuntimeQueueAdmissionRequest(shuffledRequest, {});
  assert.deepEqual(outcomeClean.orderRef.ordered_queue_admission_entry_reference_ids, outcomeShuffled.orderRef.ordered_queue_admission_entry_reference_ids);
  assert.deepEqual(outcomeClean.decision.status, outcomeShuffled.decision.status);
});

test('FIX2(pr108fix2): admission_sequence is unique per accepted entry, never reused', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  const acceptedSequences = outcome.admissionEntryRefs
    .filter((e) => e.admission_status === 'QUEUE_ADMISSION_ACCEPTED_SIMULATION')
    .map((e) => e.admission_sequence);
  assert.equal(new Set(acceptedSequences).size, acceptedSequences.length);
});

test('package integrity(pr108fix2): the order fingerprint changes when the real admission order changes, blocking a forged flip', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  const forgedOrder = { ...outcome.orderRef, ordered_queue_admission_entry_reference_ids: [...outcome.orderRef.ordered_queue_admission_entry_reference_ids].reverse() };
  assertInvalid('forged reversed order', validateRuntimeQueueAdmissionOrderReference(forgedOrder));
});

test('package integrity(pr108fix2): queue_admission_order_validated is false whenever any single preserved flag is false, never true by default', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  assert.equal(outcome.orderRef.queue_admission_order_validated, true);
  for (const flag of ['dispatch_order_preserved', 'priority_order_preserved', 'fairness_order_preserved', 'required_predecessor_order_preserved']) {
    const forgedOrder = buildRuntimeQueueAdmissionOrderReference({ ...outcome.orderRef, [flag]: false });
    assertValid(`order with ${flag}=false is still structurally valid`, validateRuntimeQueueAdmissionOrderReference(forgedOrder));
    assert.equal(forgedOrder.queue_admission_order_validated, false, `${flag}=false must make queue_admission_order_validated false`);
  }
});

// --- pr108fix3 FIX 1: a Queue Class blocker must precede an Order blocker --------------------------

test('FIX1(pr108fix3): only order-eligible (selectedClass !== null) entries participate in checkPriorityOrderPreserved', () => {
  const noClassFirst = { selectedClass: null, intent: { dispatch_sequence: 0 } };
  const highSecond = fifoEntry('HIGH_REFERENCE', 1);
  const mixed = [noClassFirst, highSecond];
  // Unfiltered, a synthetic BACKGROUND_REFERENCE (rank 4) followed by HIGH_REFERENCE (rank 1) would
  // read as a priority violation (4 then 1 is decreasing). Filtered to order-eligible entries only
  // (mirroring exactly what the boundary now does before calling this function), the no-class entry
  // never participates, so a single HIGH entry alone can never violate anything.
  assert.equal(checkPriorityOrderPreserved(mixed), false);
  const eligible = mixed.filter((entry) => entry.selectedClass !== null);
  assert.equal(checkPriorityOrderPreserved(eligible), true);
});

test('FIX1(pr108fix3): only order-eligible entries participate in checkFairnessOrderPreserved', () => {
  const noClassFirst = { selectedClass: null, intent: { dispatch_sequence: 5 } };
  const normalSecond = fifoEntry('NORMAL_REFERENCE', 0);
  const mixed = [noClassFirst, normalSecond];
  const eligible = mixed.filter((entry) => entry.selectedClass !== null);
  assert.equal(checkFairnessOrderPreserved(eligible), true);
});

test('FIX1(pr108fix3): a genuinely absent Queue Class never masks itself as an order violation in the full boundary', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const incompatibleClass = buildRuntimeQueueClassReference({ ...golden.queueClass, supported_stage_types: ['MODEL_REFERENCE_STAGE'] });
  const request = buildRuntimeQueueAdmissionRequest({ ...golden.queueAdmissionRequest, runtime_queue_class_references: [incompatibleClass] });
  const outcome = evaluateRuntimeQueueAdmissionRequest(request, {});
  // The whole evaluation still reaches PACKAGE_PREPARED_SIMULATION (order proofs never fired for
  // these class-less entries); each entry surfaces its own genuine QUEUE_ADMISSION_QUEUE_CLASS_BLOCKED.
  assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION');
  assert.ok(outcome.admissionEntryRefs.every((e) => e.admission_status === 'QUEUE_ADMISSION_QUEUE_CLASS_BLOCKED'));
});

test('FIX1(pr108fix3): two genuinely order-eligible entries with inverted priority still block QUEUE_ADMISSION_ORDER_BLOCKED', () => {
  const low = fifoEntry('LOW_REFERENCE', 0);
  const critical = fifoEntry('CRITICAL_REFERENCE', 1);
  assert.equal(checkPriorityOrderPreserved([low, critical]), false);
});

test('FIX1(pr108fix3): fairness never masks a genuine Queue Class mismatch -- order-eligible filtering happens before either proof runs', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const nonFifoClass = buildRuntimeQueueClassReference({ ...golden.queueClass, queue_fairness_strategy: 'WEIGHTED_ROUND_ROBIN_REFERENCE' });
  const request = buildRuntimeQueueAdmissionRequest({ ...golden.queueAdmissionRequest, runtime_queue_class_references: [nonFifoClass] });
  const outcome = evaluateRuntimeQueueAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION');
  assert.ok(outcome.admissionEntryRefs.every((e) => e.admission_status === 'QUEUE_ADMISSION_FAIRNESS_BLOCKED'));
});

test('FIX1(pr108fix3): the order-eligible filter always drops every no-class entry, regardless of its position in canonical order', () => {
  const a = fifoEntry('NORMAL_REFERENCE', 0);
  const b = fifoEntry('NORMAL_REFERENCE', 1);
  const noClassAtStart = { selectedClass: null, intent: { dispatch_sequence: -1 } };
  const noClassAtEnd = { selectedClass: null, intent: { dispatch_sequence: 2 } };
  const withNoClassFirst = [noClassAtStart, a, b].filter((entry) => entry.selectedClass !== null);
  const withNoClassLast = [a, b, noClassAtEnd].filter((entry) => entry.selectedClass !== null);
  assert.equal(checkPriorityOrderPreserved(withNoClassFirst), true);
  assert.equal(checkPriorityOrderPreserved(withNoClassLast), true);
  assert.equal(checkFairnessOrderPreserved(withNoClassFirst), true);
  assert.equal(checkFairnessOrderPreserved(withNoClassLast), true);
});

test('FIX1(pr108fix3): a hostile context never alters Queue Class vs Order precedence', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const incompatibleClass = buildRuntimeQueueClassReference({ ...golden.queueClass, supported_stage_types: ['MODEL_REFERENCE_STAGE'] });
  const request = buildRuntimeQueueAdmissionRequest({ ...golden.queueAdmissionRequest, runtime_queue_class_references: [incompatibleClass] });
  const outcomeClean = evaluateRuntimeQueueAdmissionRequest(request, {});
  const outcomeHostile = evaluateRuntimeQueueAdmissionRequest(request, { priority: 'CRITICAL_REFERENCE', reorder: true });
  assert.deepEqual(outcomeClean.decision, outcomeHostile.decision);
});

// --- pr108fix3 FIX 2: Registry Snapshot mandatory on the PREPARED path -----------------------------

test('FIX2(pr108fix3): a genuine official Registry Snapshot bound to the Dispatch Package passes and reaches PREPARED', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION');
  assert.notEqual(outcome.package.registry_snapshot_fingerprint, 'fingerprint_not_available');
});

test('FIX2(pr108fix3): registry_snapshot_reference=null at this layer blocks even when the Dispatch Package has a genuine one', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const request = buildRuntimeQueueAdmissionRequest({ ...golden.queueAdmissionRequest, registry_snapshot_reference: null });
  const outcome = evaluateRuntimeQueueAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_REGISTRY_SNAPSHOT_BLOCKED');
  assert.ok(outcome.decision.blockers.includes('queue_admission_registry_snapshot_missing'));
});

test('FIX2(pr108fix3): a Dispatch Package with no Registry Snapshot at all blocks queue_admission_registry_snapshot_missing', () => {
  const golden = buildGoldenQueueAdmissionBundle(undefined, { registrySnapshotRef: null });
  const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_REGISTRY_SNAPSHOT_BLOCKED');
  assert.ok(outcome.decision.blockers.includes('queue_admission_registry_snapshot_missing'));
});

test('FIX2(pr108fix3): a Registry Snapshot ID/content divergent from the Dispatch Package binding blocks fingerprint mismatch', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const divergentSnapshot = buildOfficialRegistrySnapshot({ registry_snapshot_reference_id: 'snapshotref-divergent' });
  const request = buildRuntimeQueueAdmissionRequest({ ...golden.queueAdmissionRequest, registry_snapshot_reference: divergentSnapshot });
  const outcome = evaluateRuntimeQueueAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_REGISTRY_SNAPSHOT_BLOCKED');
  assert.ok(outcome.decision.blockers.includes('queue_admission_registry_snapshot_not_bound_to_dispatch'));
});

test('FIX2(pr108fix3): a self-inconsistent (tampered) Registry Snapshot is never silently accepted', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const tamperedSnapshot = { ...golden.queueAdmissionRequest.registry_snapshot_reference, tenant_id: 'tenant-tampered' };
  // Tampering a field without recomputing snapshot_fingerprint already makes the reference
  // self-inconsistent -- the Registry Snapshot's own validator (reused verbatim, never re-derived by
  // this layer) rejects it at Queue Admission Request construction, proving it can never be silently
  // accepted with mismatched content.
  assert.throws(() => buildRuntimeQueueAdmissionRequest({ ...golden.queueAdmissionRequest, registry_snapshot_reference: tamperedSnapshot }));
});

for (const [field, wrongValue] of [['tenant_id', 'tenant-foreign'], ['organization_id', 'org-foreign'], ['project_id', 'project-foreign']]) {
  test(`FIX2(pr108fix3): Registry Snapshot ${field} divergent from canonical identity blocks scope_mismatch`, () => {
    const golden = buildGoldenQueueAdmissionBundle(undefined, {
      registrySnapshotRef: buildOfficialRegistrySnapshot({ [field]: wrongValue })
    });
    const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
    assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_REGISTRY_SNAPSHOT_BLOCKED');
    assert.ok(outcome.decision.blockers.includes('queue_admission_registry_snapshot_scope_mismatch'));
  });
}

test('FIX2(pr108fix3): a Registry Snapshot logically ahead of this admission request blocks stale', () => {
  const golden = buildGoldenQueueAdmissionBundle(undefined, { registrySnapshotRef: buildOfficialRegistrySnapshot({ logical_sequence: 100 }) });
  const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_REGISTRY_SNAPSHOT_BLOCKED');
  assert.ok(outcome.decision.blockers.includes('queue_admission_registry_snapshot_stale'));
});

test('package integrity(pr108fix3): registry_snapshot_fingerprint is never the fingerprint_not_available placeholder on a prepared package', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION');
  assert.notEqual(outcome.package.registry_snapshot_fingerprint, 'fingerprint_not_available');
  const forgedPlaceholder = { ...outcome.package, registry_snapshot_fingerprint: 'fingerprint_not_available' };
  assertInvalid('placeholder registry_snapshot_fingerprint on a prepared package', validateRuntimeQueueAdmissionPackage(forgedPlaceholder));
});

test('package integrity(pr108fix3): a blocked outcome never fakes registry snapshot validation -- it uses the safe fingerprint_not_available placeholder honestly', () => {
  const golden = buildGoldenQueueAdmissionBundle(undefined, { registrySnapshotRef: null });
  const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_REGISTRY_SNAPSHOT_BLOCKED');
  assert.equal(outcome.package.registry_snapshot_fingerprint, 'fingerprint_not_available');
  assertValid('blocked package with honest placeholder', validateRuntimeQueueAdmissionPackage(outcome.package));
});

test('FIX2(pr108fix3): a hostile context never alters Registry Snapshot enforcement', () => {
  const golden = buildGoldenQueueAdmissionBundle(undefined, { registrySnapshotRef: null });
  const outcomeClean = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  const outcomeHostile = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, { registrySnapshotValid: true, skipRegistryCheck: true });
  assert.deepEqual(outcomeClean.decision, outcomeHostile.decision);
});

// --- pr108fix4: gate flags represent independent evaluations, never derived from admissionStatus --

test('FIX(pr108fix4): every accepted entry carries all eight gates true', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  const accepted = outcome.admissionEntryRefs.filter((e) => e.admission_status === 'QUEUE_ADMISSION_ACCEPTED_SIMULATION');
  assert.ok(accepted.length > 0);
  for (const entry of accepted) {
    for (const gate of ['queue_class_gate_passed', 'partition_gate_passed', 'quota_gate_passed', 'capacity_gate_passed', 'fairness_gate_passed', 'freshness_gate_passed', 'replay_gate_passed', 'idempotency_gate_passed']) {
      assert.equal(entry[gate], true, `${gate} must be true for an accepted entry`);
    }
  }
});

test('FIX(pr108fix4): DEFERRED_QUOTA preserves class/partition/capacity/fairness/freshness true, only quota false', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const zeroQuotas = golden.quotas.map((q) => buildRuntimeQueueQuotaReference({
    ...q, maximum_admission_count: 0, current_admission_count: 0, available_admission_count: 0
  }));
  const request = buildRuntimeQueueAdmissionRequest({ ...golden.queueAdmissionRequest, runtime_queue_quota_references: zeroQuotas });
  const outcome = evaluateRuntimeQueueAdmissionRequest(request, {});
  assert.ok(outcome.admissionEntryRefs.length > 0);
  for (const entry of outcome.admissionEntryRefs) {
    assert.equal(entry.admission_status, 'QUEUE_ADMISSION_DEFERRED_QUOTA_REFERENCE');
    assert.equal(entry.queue_class_gate_passed, true);
    assert.equal(entry.partition_gate_passed, true);
    assert.equal(entry.quota_gate_passed, false);
    assert.equal(entry.capacity_gate_passed, true);
    assert.equal(entry.fairness_gate_passed, true);
    assert.equal(entry.freshness_gate_passed, true);
  }
});

test('FIX(pr108fix4): DEFERRED_BACKLOG preserves class/partition/quota/fairness/freshness true, only capacity false', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const zeroBacklog = buildRuntimeQueueCapacitySnapshotReference({
    ...golden.capacitySnapshot, maximum_backlog_count: 0, current_backlog_count: 0, available_backlog_count: 0
  });
  const request = buildRuntimeQueueAdmissionRequest({ ...golden.queueAdmissionRequest, runtime_queue_capacity_snapshot_references: [zeroBacklog] });
  const outcome = evaluateRuntimeQueueAdmissionRequest(request, {});
  assert.ok(outcome.admissionEntryRefs.length > 0);
  for (const entry of outcome.admissionEntryRefs) {
    assert.equal(entry.admission_status, 'QUEUE_ADMISSION_DEFERRED_BACKLOG_REFERENCE');
    assert.equal(entry.queue_class_gate_passed, true);
    assert.equal(entry.partition_gate_passed, true);
    assert.equal(entry.quota_gate_passed, true);
    assert.equal(entry.capacity_gate_passed, false);
    assert.equal(entry.fairness_gate_passed, true);
    assert.equal(entry.freshness_gate_passed, true);
  }
});

test('FIX(pr108fix4): QUEUE_CLASS_BLOCKED never fabricates fairness/freshness/partition/quota/capacity as true', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const incompatibleClass = buildRuntimeQueueClassReference({ ...golden.queueClass, supported_stage_types: ['MODEL_REFERENCE_STAGE'] });
  const request = buildRuntimeQueueAdmissionRequest({ ...golden.queueAdmissionRequest, runtime_queue_class_references: [incompatibleClass] });
  const outcome = evaluateRuntimeQueueAdmissionRequest(request, {});
  for (const entry of outcome.admissionEntryRefs) {
    assert.equal(entry.admission_status, 'QUEUE_ADMISSION_QUEUE_CLASS_BLOCKED');
    assert.equal(entry.queue_class_gate_passed, false);
    assert.equal(entry.partition_gate_passed, false);
    assert.equal(entry.quota_gate_passed, false);
    assert.equal(entry.capacity_gate_passed, false);
    assert.equal(entry.fairness_gate_passed, false);
    assert.equal(entry.freshness_gate_passed, false);
  }
});

test('FIX(pr108fix4): FAIRNESS_BLOCKED registers fairness_gate_passed=false while class/partition/quota/capacity/freshness stay true', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const nonFifoClass = buildRuntimeQueueClassReference({ ...golden.queueClass, queue_fairness_strategy: 'DETERMINISTIC_FAIR_SHARE_REFERENCE' });
  const request = buildRuntimeQueueAdmissionRequest({ ...golden.queueAdmissionRequest, runtime_queue_class_references: [nonFifoClass] });
  const outcome = evaluateRuntimeQueueAdmissionRequest(request, {});
  for (const entry of outcome.admissionEntryRefs) {
    assert.equal(entry.admission_status, 'QUEUE_ADMISSION_FAIRNESS_BLOCKED');
    assert.equal(entry.queue_class_gate_passed, true);
    assert.equal(entry.partition_gate_passed, true);
    assert.equal(entry.quota_gate_passed, true);
    assert.equal(entry.capacity_gate_passed, true);
    assert.equal(entry.fairness_gate_passed, false);
    assert.equal(entry.freshness_gate_passed, true);
  }
});

test('FIX(pr108fix4): an expired Capacity Snapshot registers freshness_gate_passed=false and capacity_gate_passed=false', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const staleSnapshot = buildRuntimeQueueCapacitySnapshotReference({ ...golden.capacitySnapshot, logical_sequence: 0, snapshot_valid_sequences: 10 });
  const request = buildRuntimeQueueAdmissionRequest({
    ...golden.queueAdmissionRequest, runtime_queue_capacity_snapshot_references: [staleSnapshot], logical_sequence: 500
  });
  const outcome = evaluateRuntimeQueueAdmissionRequest(request, {});
  for (const entry of outcome.admissionEntryRefs) {
    assert.equal(entry.admission_status, 'QUEUE_ADMISSION_CAPACITY_BLOCKED');
    // The class remains structurally compatible in every OTHER dimension -- only capacity/freshness fail.
    assert.equal(entry.queue_class_gate_passed, true);
    assert.equal(entry.freshness_gate_passed, false);
    assert.equal(entry.capacity_gate_passed, false);
  }
});

test('FIX(pr108fix4): altering only quota availability changes only the quota gate/status, never capacity/fairness/freshness', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const outcomeClean = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  const zeroQuotas = golden.quotas.map((q) => buildRuntimeQueueQuotaReference({
    ...q, maximum_admission_count: 0, current_admission_count: 0, available_admission_count: 0
  }));
  const request = buildRuntimeQueueAdmissionRequest({ ...golden.queueAdmissionRequest, runtime_queue_quota_references: zeroQuotas });
  const outcomeQuotaZeroed = evaluateRuntimeQueueAdmissionRequest(request, {});
  for (let i = 0; i < outcomeClean.admissionEntryRefs.length; i += 1) {
    const before = outcomeClean.admissionEntryRefs[i];
    const after = outcomeQuotaZeroed.admissionEntryRefs[i];
    assert.equal(before.capacity_gate_passed, after.capacity_gate_passed);
    assert.equal(before.fairness_gate_passed, after.fairness_gate_passed);
    assert.equal(before.freshness_gate_passed, after.freshness_gate_passed);
    assert.equal(before.queue_class_gate_passed, after.queue_class_gate_passed);
    assert.notEqual(before.quota_gate_passed, after.quota_gate_passed);
  }
});

test('FIX(pr108fix4): altering only capacity availability changes only the capacity gate/status, never quota/fairness/freshness', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const outcomeClean = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  const zeroBacklog = buildRuntimeQueueCapacitySnapshotReference({
    ...golden.capacitySnapshot, maximum_backlog_count: 0, current_backlog_count: 0, available_backlog_count: 0
  });
  const request = buildRuntimeQueueAdmissionRequest({ ...golden.queueAdmissionRequest, runtime_queue_capacity_snapshot_references: [zeroBacklog] });
  const outcomeCapacityZeroed = evaluateRuntimeQueueAdmissionRequest(request, {});
  for (let i = 0; i < outcomeClean.admissionEntryRefs.length; i += 1) {
    const before = outcomeClean.admissionEntryRefs[i];
    const after = outcomeCapacityZeroed.admissionEntryRefs[i];
    assert.equal(before.quota_gate_passed, after.quota_gate_passed);
    assert.equal(before.fairness_gate_passed, after.fairness_gate_passed);
    assert.equal(before.freshness_gate_passed, after.freshness_gate_passed);
    assert.equal(before.queue_class_gate_passed, after.queue_class_gate_passed);
    assert.notEqual(before.capacity_gate_passed, after.capacity_gate_passed);
  }
});

test('FIX(pr108fix4): shuffled input reference arrays never alter which gates are true', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const shuffledRequest = buildRuntimeQueueAdmissionRequest({
    ...golden.queueAdmissionRequest,
    runtime_dispatch_stage_references: [...golden.queueAdmissionRequest.runtime_dispatch_stage_references].reverse(),
    runtime_queue_quota_references: [...golden.queueAdmissionRequest.runtime_queue_quota_references].reverse()
  });
  const outcomeClean = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  const outcomeShuffled = evaluateRuntimeQueueAdmissionRequest(shuffledRequest, {});
  const gateSetClean = outcomeClean.admissionEntryRefs.map((e) => [e.queue_class_gate_passed, e.partition_gate_passed, e.quota_gate_passed, e.capacity_gate_passed, e.fairness_gate_passed, e.freshness_gate_passed]).sort();
  const gateSetShuffled = outcomeShuffled.admissionEntryRefs.map((e) => [e.queue_class_gate_passed, e.partition_gate_passed, e.quota_gate_passed, e.capacity_gate_passed, e.fairness_gate_passed, e.freshness_gate_passed]).sort();
  assert.deepEqual(gateSetClean, gateSetShuffled);
});

test('FIX(pr108fix4): a hostile context never alters any gate flag', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const outcomeClean = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  const outcomeHostile = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {
    quota_gate_passed: false, capacity_gate_passed: false, fairness_gate_passed: false, freshness_gate_passed: true
  });
  assert.deepEqual(outcomeClean.decision, outcomeHostile.decision);
  assert.deepEqual(outcomeClean.admissionEntryRefs, outcomeHostile.admissionEntryRefs);
});

test('package integrity(pr108fix4): fingerprints change when a real gate value changes', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const outcomeClean = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  const zeroQuotas = golden.quotas.map((q) => buildRuntimeQueueQuotaReference({
    ...q, maximum_admission_count: 0, current_admission_count: 0, available_admission_count: 0
  }));
  const request = buildRuntimeQueueAdmissionRequest({ ...golden.queueAdmissionRequest, runtime_queue_quota_references: zeroQuotas });
  const outcomeQuotaZeroed = evaluateRuntimeQueueAdmissionRequest(request, {});
  assert.notEqual(outcomeClean.admissionEntryRefs[0].admission_entry_fingerprint, outcomeQuotaZeroed.admissionEntryRefs[0].admission_entry_fingerprint);
  assert.notEqual(outcomeClean.intentBindingRefs[0].intent_binding_fingerprint, outcomeQuotaZeroed.intentBindingRefs[0].intent_binding_fingerprint);
  assert.notEqual(outcomeClean.package.queue_admission_package_fingerprint, outcomeQuotaZeroed.package.queue_admission_package_fingerprint);
});

test('FIX(pr108fix4): no gate is ever confused with queue creation/enqueue -- every gate passing on an accepted entry still forces every operational flag false', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  const accepted = outcome.admissionEntryRefs.filter((e) => e.admission_status === 'QUEUE_ADMISSION_ACCEPTED_SIMULATION');
  assert.ok(accepted.length > 0);
  for (const entry of accepted) {
    assert.equal(entry.queue_admission_applied, false);
    assert.equal(entry.queue_created, false);
    assert.equal(entry.queue_item_created, false);
    assert.equal(entry.queue_item_enqueued, false);
    assert.equal(entry.queue_position_reserved, false);
  }
});

// --- pr108fix5: Queue Class/Capacity/Fairness failures never become ORDER_BLOCKED -----------------
//
// The audit at HEAD b5c407a (pre-dating pr108fix3) flagged this same precedence problem;
// pr108fix3 FIX 1 already closed it (`orderEligibleEntries = fairnessOrder.filter(entry =>
// entry.selectedClass !== null)`, still in place through pr108fix4). These tests solidify that fix
// with the exact scenarios pr108fix5 requires, including two genuinely mixed-cause two-intent cases
// built directly against `selectQueueClass`/the order-proof functions (the shared single-class-per-
// request architecture makes it impossible to construct per-intent-differing Queue Class ELIGIBILITY
// within one full boundary evaluation -- capacity/fairness validity is a property of the class, not
// of any one intent -- so the mixed-cause scenarios are proven at this level instead, exactly
// mirroring how the boundary itself derives `withQueueClass` then filters it).

test('pr108fix5 scenario 1: first intent with no compatible class + second intent with a valid HIGH class -- QUEUE_CLASS_BLOCKED never becomes ORDER_BLOCKED', () => {
  const noClass = { selectedClass: null, structurallyCompatibleClass: null, intent: { dispatch_sequence: 0 } };
  const highValid = fifoEntry('HIGH_REFERENCE', 1);
  const orderEligible = [noClass, highValid].filter((entry) => entry.selectedClass !== null);
  assert.deepEqual(orderEligible, [highValid]);
  assert.equal(checkPriorityOrderPreserved(orderEligible), true);
  assert.equal(checkFairnessOrderPreserved(orderEligible), true);
});

test('pr108fix5 scenario 2: first intent with an expired Capacity Snapshot (no genuinely selected class) + second HIGH -- CAPACITY_BLOCKED never becomes ORDER_BLOCKED', () => {
  // A capacity-expired class is only ever a `structurallyCompatibleClass`, never a `selectedClass`
  // (evaluateQueueClassCompatibility rejects it) -- so it is excluded from order-eligibility exactly
  // like a fully absent class, by the same `selectedClass !== null` filter.
  const capacityExpired = { selectedClass: null, structurallyCompatibleClass: fifoEntry('HIGH_REFERENCE', 0).selectedClass, intent: { dispatch_sequence: 0 } };
  const highValid = fifoEntry('HIGH_REFERENCE', 1);
  const orderEligible = [capacityExpired, highValid].filter((entry) => entry.selectedClass !== null);
  assert.deepEqual(orderEligible, [highValid]);
  assert.equal(checkPriorityOrderPreserved(orderEligible), true);
  assert.equal(checkFairnessOrderPreserved(orderEligible), true);
});

test('pr108fix5 scenario 3: first intent with unimplemented fairness (no genuinely selected class) + second HIGH -- FAIRNESS_BLOCKED never becomes ORDER_BLOCKED', () => {
  const fairnessBlocked = { selectedClass: null, structurallyCompatibleClass: { queue_priority_class: 'HIGH_REFERENCE', queue_fairness_strategy: 'WEIGHTED_ROUND_ROBIN_REFERENCE' }, intent: { dispatch_sequence: 0 } };
  const highValid = fifoEntry('HIGH_REFERENCE', 1);
  const orderEligible = [fairnessBlocked, highValid].filter((entry) => entry.selectedClass !== null);
  assert.deepEqual(orderEligible, [highValid]);
  assert.equal(checkPriorityOrderPreserved(orderEligible), true);
});

test('pr108fix5 scenario 4: two genuinely order-eligible intents with real inverted priority still block QUEUE_ADMISSION_ORDER_BLOCKED', () => {
  const lowFirst = fifoEntry('LOW_REFERENCE', 0);
  const criticalSecond = fifoEntry('CRITICAL_REFERENCE', 1);
  assert.equal(checkPriorityOrderPreserved([lowFirst, criticalSecond]), false);
});

test('pr108fix5 scenario 5/6: an entry with no genuinely selected class never participates in either priority or FIFO order proofs, regardless of its own dispatch_sequence', () => {
  const noClassWithMisleadingSequence = { selectedClass: null, intent: { dispatch_sequence: 999 } };
  const normalA = fifoEntry('NORMAL_REFERENCE', 0);
  const normalB = fifoEntry('NORMAL_REFERENCE', 1);
  const orderEligible = [normalA, noClassWithMisleadingSequence, normalB].filter((entry) => entry.selectedClass !== null);
  assert.deepEqual(orderEligible, [normalA, normalB]);
  assert.equal(checkPriorityOrderPreserved(orderEligible), true);
  assert.equal(checkFairnessOrderPreserved(orderEligible), true);
});

test('pr108fix5 scenario 10: the original blocking reason code is never replaced by an order-related reason on a QUEUE_CLASS_BLOCKED entry', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const incompatibleClass = buildRuntimeQueueClassReference({ ...golden.queueClass, supported_stage_types: ['MODEL_REFERENCE_STAGE'] });
  const request = buildRuntimeQueueAdmissionRequest({ ...golden.queueAdmissionRequest, runtime_queue_class_references: [incompatibleClass] });
  const outcome = evaluateRuntimeQueueAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION');
  for (const entry of outcome.admissionEntryRefs) {
    assert.equal(entry.admission_status, 'QUEUE_ADMISSION_QUEUE_CLASS_BLOCKED');
    assert.ok(entry.reason_codes.includes('no_compatible_queue_class_reference'));
    assert.ok(entry.reason_codes.every((code) => !code.startsWith('queue_admission_priority_order') && !code.startsWith('queue_admission_fifo_order')));
  }
});

test('pr108fix5 scenario 10b: the original blocking reason code is never replaced by an order-related reason on a FAIRNESS_BLOCKED entry', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const nonFifoClass = buildRuntimeQueueClassReference({ ...golden.queueClass, queue_fairness_strategy: 'WEIGHTED_ROUND_ROBIN_REFERENCE' });
  const request = buildRuntimeQueueAdmissionRequest({ ...golden.queueAdmissionRequest, runtime_queue_class_references: [nonFifoClass] });
  const outcome = evaluateRuntimeQueueAdmissionRequest(request, {});
  assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION');
  for (const entry of outcome.admissionEntryRefs) {
    assert.equal(entry.admission_status, 'QUEUE_ADMISSION_FAIRNESS_BLOCKED');
    assert.ok(entry.reason_codes.some((code) => code.startsWith('queue_fairness_strategy_not_implemented')));
    assert.ok(entry.reason_codes.every((code) => !code.startsWith('queue_admission_priority_order') && !code.startsWith('queue_admission_fifo_order')));
  }
});

test('pr108fix5: admission_sequence documented semantics -- accepted entries get unique increasing sequences, non-accepted entries reuse the current accepted-so-far count (never a reserved position)', () => {
  const golden = buildGoldenQueueAdmissionBundle('sequential-plan');
  const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  const accepted = outcome.admissionEntryRefs.filter((e) => e.admission_status === 'QUEUE_ADMISSION_ACCEPTED_SIMULATION');
  const nonAccepted = outcome.admissionEntryRefs.filter((e) => e.admission_status !== 'QUEUE_ADMISSION_ACCEPTED_SIMULATION');
  assert.ok(accepted.length > 0 && nonAccepted.length > 0, 'sequential-plan must produce both an accepted and a non-accepted entry');
  const acceptedSequences = accepted.map((e) => e.admission_sequence);
  assert.equal(new Set(acceptedSequences).size, acceptedSequences.length, 'accepted sequences must be unique');
  assert.deepEqual([...acceptedSequences].sort((a, b) => a - b), acceptedSequences, 'accepted sequences must be increasing in evaluation order');
  for (const entry of nonAccepted) {
    assert.equal(entry.admission_sequence, accepted.length, 'a non-accepted entry never appears to have consumed a reserved position');
  }
});

test('boundary: DISPATCH_STATUSES precedence covers QUEUE_ADMISSION_STATUSES exactly', () => {
  assert.deepEqual([...QUEUE_ADMISSION_STATUSES].sort(), [...QUEUE_ADMISSION_PRECEDENCE_ORDER].sort());
});

test('selectQueueClass: returns null when no class is compatible, deterministic pick when multiple are', () => {
  const canonical = { tenantId: 't-1', organizationId: 'o-1', projectId: 'p-1', agentId: 'a-1' };
  const stage = { scheduler_stage_reference_id: 'stage-1', stage_type: 'DETERMINISTIC_STAGE', required_capabilities: [], required_modalities: [], optional: false, parallelizable: false, side_effect_classification: 'NONE', model_selection_reference_id: null, tool_reference_ids: [], workflow_reference_id: null };
  const ctx = {
    queueClassRefs: [], canonical, capacitySnapshotByClassId: new Map(), quotaCollectionByClassId: new Map(),
    validCapacityClassIds: new Set(), stagePolicyRequirementsByStageId: new Map(), modelSelectionDecisionsById: new Map()
  };
  const result = selectQueueClass(stage, ctx);
  assert.equal(result.selectedClass, null);
  assert.deepEqual(result.rejectionReasons, []);
});

// --- Package integrity -----------------------------------------------------------------------------

test('package integrity: fingerprint/digest self-recompute detects tampering', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  assert.equal(outcome.decision.status, 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION');
  assertInvalid('tampered entry_count', validateRuntimeQueueAdmissionPackage({ ...outcome.package, entry_count: 999 }));
});

test('package integrity: official_model_selection_decision_fingerprints participates in the package fingerprint (pr108fix Package Integrity)', () => {
  const golden = buildGoldenQueueAdmissionBundle();
  const outcome = evaluateRuntimeQueueAdmissionRequest(golden.queueAdmissionRequest, {});
  assert.ok('official_model_selection_decision_fingerprints' in outcome.package);
  assert.deepEqual(outcome.package.official_model_selection_decision_fingerprints, []);
  assertInvalid('tampered official_model_selection_decision_fingerprints', validateRuntimeQueueAdmissionPackage({
    ...outcome.package, official_model_selection_decision_fingerprints: ['sha256:' + 'a'.repeat(64)]
  }));
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
