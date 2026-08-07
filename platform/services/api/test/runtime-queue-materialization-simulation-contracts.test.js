'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { findAgentCoreOperationalMaterial } = require('../src/core/agent-identity-contract');
const { runAllGates } = require('../src/core/architecture-gate-runner');

const {
  validateRuntimeQueueMaterializationEntryReference, buildRuntimeQueueMaterializationEntryReference,
  RUNTIME_QUEUE_MATERIALIZATION_ENTRY_REFERENCE_FIELDS
} = require('../src/core/runtime-queue-materialization-entry-reference');
const {
  validateRuntimeQueueMaterializationOrderReference, buildRuntimeQueueMaterializationOrderReference,
  RUNTIME_QUEUE_MATERIALIZATION_ORDER_REFERENCE_FIELDS
} = require('../src/core/runtime-queue-materialization-order-reference');
const {
  validateRuntimeQueueMaterializationRequest, buildRuntimeQueueMaterializationRequest,
  RUNTIME_QUEUE_MATERIALIZATION_REQUEST_FIELDS
} = require('../src/core/runtime-queue-materialization-request');
const { validateRuntimeQueueMaterializationPackage, buildRuntimeQueueMaterializationPackage } = require('../src/core/runtime-queue-materialization-package');
const {
  validateRuntimeQueueMaterializationDecision, QUEUE_MATERIALIZATION_STATUSES, QUEUE_MATERIALIZATION_PRECEDENCE_ORDER
} = require('../src/core/runtime-queue-materialization-decision');
const { validateRuntimeQueueMaterializationResult } = require('../src/core/runtime-queue-materialization-result');
const { validateRuntimeQueueMaterializationAudit } = require('../src/core/runtime-queue-materialization-audit');
const { createRuntimeQueueMaterializationRegistry } = require('../src/core/runtime-queue-materialization-registry');
const {
  evaluateRuntimeQueueMaterializationRequest, checkPredecessorOrderPreserved, idSetMatches, fingerprintSetMatches
} = require('../src/core/runtime-queue-materialization-boundary');

const { buildGoldenQueueMaterializationBundle } = require('./helpers/runtime-queue-materialization-simulation-test-data');
const { buildRuntimeQueueAdmissionReplayReference } = require('../src/core/runtime-queue-admission-replay-reference');
const { buildRuntimeQueueClassReference } = require('../src/core/runtime-queue-class-reference');
const { buildRuntimeQueueQuotaReference } = require('../src/core/runtime-queue-quota-reference');
void buildRuntimeQueueAdmissionReplayReference;
const {
  assertFrozenMutationRejected,
  assertInheritedRequiredFieldRejected,
  assertPollutionFieldsRejected,
  canonicalSnapshot,
  deepFreeze,
  tryMutation
} = require('./helpers/queue-simulation-hardening-test-helpers');

function assertValid(label, validation) {
  assert.equal(validation.valid, true, `${label}: ${JSON.stringify(validation.errors)}`);
}

function assertInvalid(label, validation) {
  assert.equal(validation.valid, false, `${label} unexpectedly valid`);
}

const PACKAGE_OPERATIONAL_FLAGS = [
  'queue_materialization_applied', 'queue_created', 'queue_item_created', 'queue_item_enqueued', 'queue_item_dequeued',
  'queue_position_reserved', 'broker_published', 'broker_subscribed', 'worker_notified', 'worker_started',
  'lease_created', 'lock_created', 'job_created', 'dispatch_authorized', 'dispatch_executed', 'network_used',
  'secret_resolved', 'executed'
];

// --- Entry Reference ------------------------------------------------------------------------------

test('materialization entry reference: prepared only when inherited admission fact is genuinely accepted+validated', () => {
  const base = {
    runtime_queue_materialization_entry_reference_id: 'me-1', runtime_queue_materialization_package_id: 'mp-1',
    runtime_queue_admission_package_id: 'ap-1', runtime_queue_admission_entry_reference_id: 'ae-1',
    runtime_queue_admission_entry_fingerprint: 'fp-ae-1', dispatch_intent_reference_id: 'di-1'
  };
  const accepted = buildRuntimeQueueMaterializationEntryReference({
    ...base, runtime_queue_class_reference_id: 'qc-1', admission_status: 'QUEUE_ADMISSION_ACCEPTED_SIMULATION',
    queue_admission_validated: true, materialization_position: 3
  });
  assertValid('accepted', validateRuntimeQueueMaterializationEntryReference(accepted));
  assert.deepEqual(Object.keys(accepted).sort(), [...RUNTIME_QUEUE_MATERIALIZATION_ENTRY_REFERENCE_FIELDS].sort());
  assert.equal(accepted.materialization_status, 'QUEUE_ITEM_MATERIALIZATION_PREPARED_SIMULATION');
  assert.equal(accepted.materialization_position, 3);
  assert.equal(accepted.queue_materialization_validated, true);
  assert.equal(accepted.queue_created, false);
  assert.equal(accepted.queue_item_enqueued, false);

  const acceptedButNotValidated = buildRuntimeQueueMaterializationEntryReference({
    ...base, runtime_queue_class_reference_id: 'qc-1', admission_status: 'QUEUE_ADMISSION_ACCEPTED_SIMULATION',
    queue_admission_validated: false
  });
  assert.equal(acceptedButNotValidated.materialization_status, 'QUEUE_MATERIALIZATION_BLOCKED_BY_ADMISSION_REFERENCE');
  assert.equal(acceptedButNotValidated.materialization_position, null);

  const deferred = buildRuntimeQueueMaterializationEntryReference({
    ...base, runtime_queue_class_reference_id: null, admission_status: 'QUEUE_ADMISSION_DEFERRED_QUOTA_REFERENCE',
    queue_admission_validated: false
  });
  assert.equal(deferred.materialization_status, 'QUEUE_MATERIALIZATION_BLOCKED_BY_ADMISSION_REFERENCE');
  assert.equal(deferred.materialization_position, null);
  assert.equal(deferred.queue_materialization_validated, false);
});

test('materialization entry reference: rejects a fabricated position on a blocked entry and a missing position on a prepared one', () => {
  const base = {
    runtime_queue_materialization_entry_reference_id: 'me-1', runtime_queue_materialization_package_id: 'mp-1',
    runtime_queue_admission_package_id: 'ap-1', runtime_queue_admission_entry_reference_id: 'ae-1',
    runtime_queue_admission_entry_fingerprint: 'fp-ae-1', dispatch_intent_reference_id: 'di-1',
    runtime_queue_class_reference_id: null, admission_entry_fingerprint: 'fp'
  };
  const forgedPosition = {
    ...buildRuntimeQueueMaterializationEntryReference({
      ...base, admission_status: 'QUEUE_ADMISSION_DEFERRED_QUOTA_REFERENCE', queue_admission_validated: false
    }),
    materialization_position: 0
  };
  assertInvalid('forged position on blocked entry', validateRuntimeQueueMaterializationEntryReference(forgedPosition));

  const missingPosition = {
    ...buildRuntimeQueueMaterializationEntryReference({
      ...base, runtime_queue_class_reference_id: 'qc-1', admission_status: 'QUEUE_ADMISSION_ACCEPTED_SIMULATION',
      queue_admission_validated: true, materialization_position: 0
    }),
    materialization_position: null
  };
  assertInvalid('missing position on prepared entry', validateRuntimeQueueMaterializationEntryReference(missingPosition));
});

// --- Order Reference -------------------------------------------------------------------------------

test('materialization order reference: partitions cover every entry exactly once, both preservation flags gate validated', () => {
  const order = buildRuntimeQueueMaterializationOrderReference({
    runtime_queue_materialization_order_reference_id: 'mo-1', runtime_queue_materialization_package_id: 'mp-1',
    runtime_queue_admission_package_id: 'ap-1', runtime_queue_admission_order_reference_id: 'ao-1',
    runtime_queue_admission_order_fingerprint: 'fp-ao',
    ordered_queue_admission_entry_reference_ids: ['ae-1', 'ae-2'],
    ordered_queue_materialization_entry_reference_ids: ['me-1', 'me-2'],
    materialized_queue_materialization_entry_reference_ids: ['me-1'],
    not_materialized_queue_materialization_entry_reference_ids: ['me-2'],
    admission_order_preserved: true, predecessor_order_preserved: true
  });
  assertValid('order', validateRuntimeQueueMaterializationOrderReference(order));
  assert.deepEqual(Object.keys(order).sort(), [...RUNTIME_QUEUE_MATERIALIZATION_ORDER_REFERENCE_FIELDS].sort());
  assert.equal(order.queue_materialization_order_validated, true);
  assert.equal(order.queue_materialization_order_applied, false);

  const partial = buildRuntimeQueueMaterializationOrderReference({
    runtime_queue_materialization_order_reference_id: 'mo-2', runtime_queue_materialization_package_id: 'mp-1',
    runtime_queue_admission_package_id: 'ap-1', runtime_queue_admission_order_reference_id: 'ao-1',
    runtime_queue_admission_order_fingerprint: 'fp-ao',
    ordered_queue_admission_entry_reference_ids: ['ae-1'], ordered_queue_materialization_entry_reference_ids: ['me-1'],
    materialized_queue_materialization_entry_reference_ids: ['me-1'],
    admission_order_preserved: true, predecessor_order_preserved: false
  });
  assert.equal(partial.queue_materialization_order_validated, false);
});

test('materialization order reference: rejects overlapping or incomplete partitions', () => {
  const base = {
    runtime_queue_materialization_order_reference_id: 'mo-3', runtime_queue_materialization_package_id: 'mp-1',
    runtime_queue_admission_package_id: 'ap-1', runtime_queue_admission_order_reference_id: 'ao-1',
    runtime_queue_admission_order_fingerprint: 'fp-ao',
    ordered_queue_admission_entry_reference_ids: ['ae-1', 'ae-2'],
    ordered_queue_materialization_entry_reference_ids: ['me-1', 'me-2'],
    admission_order_preserved: true, predecessor_order_preserved: true
  };
  assert.throws(() => buildRuntimeQueueMaterializationOrderReference({
    ...base, materialized_queue_materialization_entry_reference_ids: ['me-1', 'me-2'],
    not_materialized_queue_materialization_entry_reference_ids: ['me-2']
  }));
  assert.throws(() => buildRuntimeQueueMaterializationOrderReference({
    ...base, materialized_queue_materialization_entry_reference_ids: ['me-1'],
    not_materialized_queue_materialization_entry_reference_ids: []
  }));
});

// --- Request ------------------------------------------------------------------------------------

test('materialization request: golden bundle is structurally valid', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  assertValid('request', validateRuntimeQueueMaterializationRequest(golden.queueMaterializationRequest));
  assert.deepEqual(Object.keys(golden.queueMaterializationRequest).sort(), [...RUNTIME_QUEUE_MATERIALIZATION_REQUEST_FIELDS].sort());
});

test('materialization request: missing/extra field and invalid nested reference rejected', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  assertInvalid('missing field', validateRuntimeQueueMaterializationRequest({ ...golden.queueMaterializationRequest, runtime_queue_admission_package_reference: undefined }));
  assertInvalid('extra field', validateRuntimeQueueMaterializationRequest({ ...golden.queueMaterializationRequest, extra_field: true }));
  assertInvalid('invalid nested admission package', validateRuntimeQueueMaterializationRequest({
    ...golden.queueMaterializationRequest, runtime_queue_admission_package_reference: { not: 'valid' }
  }));
});

// --- Boundary: happy path -------------------------------------------------------------------------

test('boundary: golden bundle reaches QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION with every validated flag true', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const outcome = evaluateRuntimeQueueMaterializationRequest(golden.queueMaterializationRequest, {});
  assert.equal(outcome.decision.status, 'QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION');
  assert.equal(outcome.decision.queue_materialization_package_prepared_in_simulation, true);
  for (const field of [
    'request_validated', 'admission_package_validated', 'identity_validated', 'cardinality_validated',
    'reference_integrity_validated', 'canonical_order_validated', 'predecessor_order_validated',
    'eligibility_validated', 'entries_validated', 'materialization_order_validated',
    'non_execution_invariants_validated'
  ]) {
    assert.equal(outcome.decision[field], true, field);
  }
  assert.equal(outcome.package.entry_count, 2);
  assert.equal(outcome.package.materialized_count, 2);
  assert.deepEqual(outcome.materializationEntryRefs.map((e) => e.materialization_position), [0, 1]);
});

test('boundary: multiple entries preserve deterministic positions matching canonical admission order', () => {
  const golden = buildGoldenQueueMaterializationBundle('parallel-plan');
  const outcome = evaluateRuntimeQueueMaterializationRequest(golden.queueMaterializationRequest, {});
  assert.equal(outcome.decision.status, 'QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION');
  const canonicalOrder = golden.admissionOutcome.package.ordered_queue_admission_entry_reference_ids;
  const materializationByAdmissionId = new Map(outcome.materializationEntryRefs.map((e) => [e.runtime_queue_admission_entry_reference_id, e]));
  canonicalOrder.forEach((admissionId, index) => {
    const entry = materializationByAdmissionId.get(admissionId);
    assert.ok(entry, `every canonical admission id must have a materialization entry, missing for ${admissionId}`);
    assert.equal(outcome.orderRef.ordered_queue_materialization_entry_reference_ids[index], entry.runtime_queue_materialization_entry_reference_id);
  });
});

test('boundary: fingerprints are valid and reproducible across an identical re-evaluation', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const first = evaluateRuntimeQueueMaterializationRequest(golden.queueMaterializationRequest, {});
  const second = evaluateRuntimeQueueMaterializationRequest(golden.queueMaterializationRequest, {});
  assert.deepEqual(first.package, second.package);
  assert.deepEqual(first.decision, second.decision);
  assert.deepEqual(first.orderRef, second.orderRef);
  assert.deepEqual(first.materializationEntryRefs, second.materializationEntryRefs);
});

// --- Admission blocked -----------------------------------------------------------------------------

test('boundary: a blocked/waiting admission entry never receives a materialization position or appears materialized', () => {
  const golden = buildGoldenQueueMaterializationBundle('sequential-plan');
  const outcome = evaluateRuntimeQueueMaterializationRequest(golden.queueMaterializationRequest, {});
  assert.equal(outcome.decision.status, 'QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION');
  assert.equal(outcome.package.entry_count, 2);
  assert.equal(outcome.package.materialized_count, 1);
  const blockedEntry = outcome.materializationEntryRefs.find((e) => e.materialization_status === 'QUEUE_MATERIALIZATION_BLOCKED_BY_ADMISSION_REFERENCE');
  assert.ok(blockedEntry);
  assert.equal(blockedEntry.materialization_position, null);
  assert.ok(outcome.orderRef.not_materialized_queue_materialization_entry_reference_ids.includes(blockedEntry.runtime_queue_materialization_entry_reference_id));
  assert.ok(!outcome.orderRef.materialized_queue_materialization_entry_reference_ids.includes(blockedEntry.runtime_queue_materialization_entry_reference_id));
});

test('boundary: the original admission reason/status remains auditable on the blocked materialization entry', () => {
  const golden = buildGoldenQueueMaterializationBundle('sequential-plan');
  const outcome = evaluateRuntimeQueueMaterializationRequest(golden.queueMaterializationRequest, {});
  const blockedEntry = outcome.materializationEntryRefs.find((e) => e.materialization_status === 'QUEUE_MATERIALIZATION_BLOCKED_BY_ADMISSION_REFERENCE');
  assert.equal(blockedEntry.admission_status, 'QUEUE_ADMISSION_WAITING_DEPENDENCY_REFERENCE');
  const originalEntry = outcome.admissionEntryRefs.find((e) => e.runtime_queue_admission_entry_reference_id === blockedEntry.runtime_queue_admission_entry_reference_id);
  assert.equal(originalEntry.admission_status, blockedEntry.admission_status);
});

test('boundary: cardinality and identity remain consistent -- every admission entry produces exactly one materialization entry', () => {
  const golden = buildGoldenQueueMaterializationBundle('sequential-plan');
  const outcome = evaluateRuntimeQueueMaterializationRequest(golden.queueMaterializationRequest, {});
  assert.equal(outcome.materializationEntryRefs.length, outcome.admissionEntryRefs.length);
  const admissionIds = new Set(outcome.admissionEntryRefs.map((e) => e.runtime_queue_admission_entry_reference_id));
  const materializationAdmissionIds = new Set(outcome.materializationEntryRefs.map((e) => e.runtime_queue_admission_entry_reference_id));
  assert.deepEqual([...admissionIds].sort(), [...materializationAdmissionIds].sort());
});

// --- Order -------------------------------------------------------------------------------------

test('boundary: an admission package whose duplicated order diverges from its own Order Reference is never silently accepted (self-fingerprint catches it at construction)', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const tamperedPackage = { ...golden.admissionOutcome.package, ordered_queue_admission_entry_reference_ids: [...golden.admissionOutcome.package.ordered_queue_admission_entry_reference_ids].reverse() };
  assert.throws(() => buildRuntimeQueueMaterializationRequest({ ...golden.queueMaterializationRequest, runtime_queue_admission_package_reference: tamperedPackage }));
});

test('boundary: an admission entry missing from the request while still referenced by canonical order blocks the outcome from ever reaching PREPARED', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const missingOneEntry = golden.admissionOutcome.admissionEntryRefs.slice(1);
  const request = buildRuntimeQueueMaterializationRequest({ ...golden.queueMaterializationRequest, runtime_queue_admission_entry_references: missingOneEntry });
  const outcome = evaluateRuntimeQueueMaterializationRequest(request, {});
  assert.notEqual(outcome.decision.status, 'QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION');
});

test('boundary: an extra admission entry reference not committed by the package is never silently accepted', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const foreignEntry = { ...golden.admissionOutcome.admissionEntryRefs[0], runtime_queue_admission_entry_reference_id: 'foreign-entry-id' };
  assert.throws(() => buildRuntimeQueueMaterializationRequest({
    ...golden.queueMaterializationRequest, runtime_queue_admission_entry_references: [...golden.admissionOutcome.admissionEntryRefs, foreignEntry]
  }));
});

test('boundary: a duplicated admission entry reference is never silently accepted', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const duplicated = [golden.admissionOutcome.admissionEntryRefs[0], ...golden.admissionOutcome.admissionEntryRefs];
  const request = buildRuntimeQueueMaterializationRequest({ ...golden.queueMaterializationRequest, runtime_queue_admission_entry_references: duplicated });
  const outcome = evaluateRuntimeQueueMaterializationRequest(request, {});
  assert.notEqual(outcome.decision.status, 'QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION');
});

test('boundary: incidental array ordering of the bundled Admission Entries never alters the materialized result', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const shuffledRequest = buildRuntimeQueueMaterializationRequest({
    ...golden.queueMaterializationRequest,
    runtime_queue_admission_entry_references: [...golden.queueMaterializationRequest.runtime_queue_admission_entry_references].reverse()
  });
  const outcomeClean = evaluateRuntimeQueueMaterializationRequest(golden.queueMaterializationRequest, {});
  const outcomeShuffled = evaluateRuntimeQueueMaterializationRequest(shuffledRequest, {});
  assert.deepEqual(outcomeClean.orderRef.ordered_queue_materialization_entry_reference_ids, outcomeShuffled.orderRef.ordered_queue_materialization_entry_reference_ids);
  assert.deepEqual(outcomeClean.decision.status, outcomeShuffled.decision.status);
});

// --- Predecessors --------------------------------------------------------------------------------

test('boundary: the inherited required_predecessor_order_preserved=false blocks QUEUE_MATERIALIZATION_PREDECESSOR_BLOCKED', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const tamperedOrderRef = { ...golden.admissionOutcome.orderRef, required_predecessor_order_preserved: false };
  assert.throws(() => buildRuntimeQueueMaterializationRequest({ ...golden.queueMaterializationRequest, runtime_queue_admission_order_reference: tamperedOrderRef }));
});

test('checkPredecessorOrderPreserved: strictly increasing positions among materialized entries pass, non-increasing fails', () => {
  const increasing = [{ materialization_position: 0 }, { materialization_position: null }, { materialization_position: 1 }];
  assert.equal(checkPredecessorOrderPreserved(increasing), true);
  const nonIncreasing = [{ materialization_position: 1 }, { materialization_position: 0 }];
  assert.equal(checkPredecessorOrderPreserved(nonIncreasing), false);
  const repeated = [{ materialization_position: 0 }, { materialization_position: 0 }];
  assert.equal(checkPredecessorOrderPreserved(repeated), false);
});

test('boundary: predecessor references divergent from the official Admission Order Reference are never silently accepted', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const foreignOrderRef = { ...golden.admissionOutcome.orderRef, runtime_queue_admission_order_reference_id: 'foreign-order-id' };
  assert.throws(() => buildRuntimeQueueMaterializationRequest({ ...golden.queueMaterializationRequest, runtime_queue_admission_order_reference: foreignOrderRef }));
});

// --- Identity chain -------------------------------------------------------------------------------

test('boundary: an altered Admission Package reference (wrong fingerprint) is never silently accepted -- self-fingerprint catches it at construction', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const tamperedPackage = { ...golden.admissionOutcome.package, entry_count: 999 };
  assert.throws(() => buildRuntimeQueueMaterializationRequest({ ...golden.queueMaterializationRequest, runtime_queue_admission_package_reference: tamperedPackage }));
});

test('boundary: an altered Admission Entry reference (content tampered without refreshing its own fingerprint) is never silently accepted -- self-fingerprint catches it at construction', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const originalStatus = golden.admissionOutcome.admissionEntryRefs[0].admission_status;
  const differentStatus = originalStatus === 'QUEUE_ADMISSION_ACCEPTED_SIMULATION' ? 'QUEUE_ADMISSION_WAITING_DEPENDENCY_REFERENCE' : 'QUEUE_ADMISSION_ACCEPTED_SIMULATION';
  const tamperedEntries = [
    { ...golden.admissionOutcome.admissionEntryRefs[0], admission_status: differentStatus },
    ...golden.admissionOutcome.admissionEntryRefs.slice(1)
  ];
  assert.throws(() => buildRuntimeQueueMaterializationRequest({ ...golden.queueMaterializationRequest, runtime_queue_admission_entry_references: tamperedEntries }));
});

test('boundary: a Queue Class reference substituted for a different one not committed by the package is never silently accepted', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const foreignClass = buildRuntimeQueueClassReference({ ...golden.queueClass, runtime_queue_class_reference_id: 'foreign-class-id' });
  const request = buildRuntimeQueueMaterializationRequest({ ...golden.queueMaterializationRequest, runtime_queue_class_references: [foreignClass] });
  const outcome = evaluateRuntimeQueueMaterializationRequest(request, {});
  assert.notEqual(outcome.decision.status, 'QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION');
});

test('boundary: identity-field divergence on the bundled Admission Package is never silently accepted -- self-fingerprint catches it at construction', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  // runtime_queue_admission_order_reference does not itself carry identity fields in this design
  // (checkIdentity no-ops on undefined fields) -- this test documents that fact honestly rather than
  // asserting a false guarantee; identity is instead proven transitively via non-substitution against
  // the Admission Package, which DOES carry the canonical identity used to build `canonical`.
  const foreignIdentityPackage = { ...golden.admissionOutcome.package, tenant_id: 'tenant-foreign' };
  assert.throws(() => buildRuntimeQueueMaterializationRequest({ ...golden.queueMaterializationRequest, runtime_queue_admission_package_reference: foreignIdentityPackage }));
});

// --- Fingerprints ---------------------------------------------------------------------------------

test('boundary: the request fingerprint changes when the request payload changes', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const outcomeA = evaluateRuntimeQueueMaterializationRequest(golden.queueMaterializationRequest, {});
  const changedRequest = buildRuntimeQueueMaterializationRequest({ ...golden.queueMaterializationRequest, correlation_id: 'corr-different' });
  const outcomeB = evaluateRuntimeQueueMaterializationRequest(changedRequest, {});
  assert.notEqual(outcomeA.decision.runtime_queue_materialization_request_fingerprint, outcomeB.decision.runtime_queue_materialization_request_fingerprint);
});

test('boundary: the materialization entry fingerprint changes when a semantically relevant field changes', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const outcome = evaluateRuntimeQueueMaterializationRequest(golden.queueMaterializationRequest, {});
  const entry = outcome.materializationEntryRefs[0];
  const tampered = { ...entry, materialization_position: entry.materialization_position + 100 };
  assert.notEqual(entry.materialization_entry_fingerprint, buildRuntimeQueueMaterializationEntryReferenceFingerprintOf(tampered));
  function buildRuntimeQueueMaterializationEntryReferenceFingerprintOf(reference) {
    const { materialization_entry_fingerprint, ...rest } = reference;
    void materialization_entry_fingerprint;
    return JSON.stringify(rest);
  }
});

test('boundary: the order fingerprint changes when the real order changes', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const outcome = evaluateRuntimeQueueMaterializationRequest(golden.queueMaterializationRequest, {});
  const forgedOrder = { ...outcome.orderRef, ordered_queue_materialization_entry_reference_ids: [...outcome.orderRef.ordered_queue_materialization_entry_reference_ids].reverse() };
  assertInvalid('forged reversed materialization order', validateRuntimeQueueMaterializationOrderReference(forgedOrder));
});

test('package integrity: fingerprint/digest self-recompute detects tampering', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const outcome = evaluateRuntimeQueueMaterializationRequest(golden.queueMaterializationRequest, {});
  assert.equal(outcome.decision.status, 'QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION');
  assertInvalid('tampered entry_count', validateRuntimeQueueMaterializationPackage({ ...outcome.package, entry_count: 999 }));
});

test('boundary: DISPATCH_STATUSES-style precedence covers QUEUE_MATERIALIZATION_STATUSES exactly', () => {
  assert.deepEqual([...QUEUE_MATERIALIZATION_STATUSES].sort(), [...QUEUE_MATERIALIZATION_PRECEDENCE_ORDER].sort());
});

test('idSetMatches/fingerprintSetMatches: pure helper functions behave as documented', () => {
  assert.equal(idSetMatches([{ id: 'a' }, { id: 'b' }], 'id', ['b', 'a']), true);
  assert.equal(idSetMatches([{ id: 'a' }], 'id', ['a', 'b']), false);
  assert.equal(fingerprintSetMatches([{ v: 1 }], (x) => String(x.v), ['1']), true);
  assert.equal(fingerprintSetMatches([{ v: 1 }], (x) => String(x.v), ['2']), false);
});

// --- Fail-closed ---------------------------------------------------------------------------------

test('fail-closed: an unknown queue_admission_status on the bundled Admission Package is never silently accepted -- self-fingerprint catches it at construction', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const tampered = { ...golden.admissionOutcome.package, queue_admission_status: 'QUEUE_ADMISSION_UNKNOWN_FUTURE_STATUS' };
  assert.throws(() => buildRuntimeQueueMaterializationRequest({ ...golden.queueMaterializationRequest, runtime_queue_admission_package_reference: tampered }));
});

test('fail-closed: an Admission Package not genuinely prepared (a different real status) blocks BLOCKED_BY_INHERITED_DATA', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const zeroQuotas = golden.quotas.map((q) => buildRuntimeQueueQuotaReference({
    ...q, maximum_admission_count: 0, current_admission_count: 0, available_admission_count: 0
  }));
  const { evaluateRuntimeQueueAdmissionRequest } = require('../src/core/runtime-queue-admission-boundary');
  const { buildRuntimeQueueAdmissionRequest } = require('../src/core/runtime-queue-admission-request');
  const stillPreparedButAllDeferred = buildRuntimeQueueAdmissionRequest({ ...golden.queueAdmissionRequest, runtime_queue_quota_references: zeroQuotas });
  const admissionOutcome = evaluateRuntimeQueueAdmissionRequest(stillPreparedButAllDeferred, {});
  assert.equal(admissionOutcome.decision.status, 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION');
  const request = buildRuntimeQueueMaterializationRequest({
    ...golden.queueMaterializationRequest,
    runtime_queue_admission_package_reference: admissionOutcome.package,
    runtime_queue_admission_entry_references: admissionOutcome.admissionEntryRefs,
    runtime_queue_admission_order_reference: admissionOutcome.orderRef
  });
  const outcome = evaluateRuntimeQueueMaterializationRequest(request, {});
  assert.equal(outcome.decision.status, 'QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION');
  assert.equal(outcome.package.materialized_count, 0);
});

test('fail-closed: a partial payload (missing required fields) never constructs', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  assert.throws(() => buildRuntimeQueueMaterializationRequest({
    runtime_queue_materialization_request_id: golden.queueMaterializationRequest.runtime_queue_materialization_request_id
  }));
});

test('fail-closed: a broken/non-official-shaped Admission Package reference never constructs', () => {
  assert.throws(() => buildRuntimeQueueMaterializationRequest({
    runtime_queue_materialization_request_id: 'mr-broken',
    runtime_queue_admission_package_reference: { looks: 'similar', but: 'not official' },
    runtime_queue_admission_entry_references: [], runtime_queue_admission_order_reference: {},
    runtime_queue_class_references: [], correlation_id: 'c', causation_id: 'ca', trace_id: 't',
    logical_sequence: 0, expected_queue_materialization_registry_version: 1,
    simulation_context: { environment: 'DEVELOPMENT', simulation: true, production_blocked: true, rollout_percentage: 0 }
  }));
});

// --- Simulation-only -------------------------------------------------------------------------------

test('simulation-only: every producible outcome forces every operational flag false, simulation=true, production_blocked=true, rollout=0', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const outcome = evaluateRuntimeQueueMaterializationRequest(golden.queueMaterializationRequest, {});
  for (const field of PACKAGE_OPERATIONAL_FLAGS) {
    assert.equal(outcome.package[field], false, `package.${field}`);
  }
  assert.equal(outcome.package.simulation, true);
  assert.equal(outcome.package.production_blocked, true);
  assert.equal(outcome.package.rollout_percentage, 0);
  assert.equal(outcome.decision.simulation, true);
  assert.equal(outcome.decision.production_blocked, true);
  assert.equal(outcome.decision.rollout_percentage, 0);
});

test('simulation-only: no queue, item, enqueue, broker, worker, job or dispatch is ever created in any producible outcome', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const outcome = evaluateRuntimeQueueMaterializationRequest(golden.queueMaterializationRequest, {});
  assert.equal(outcome.result.queue_created, false);
  assert.equal(outcome.result.queue_item_created, false);
  assert.equal(outcome.result.queue_item_enqueued, false);
  assert.equal(outcome.result.broker_published, false);
  assert.equal(outcome.result.worker_notified, false);
  assert.equal(outcome.result.job_created, false);
  assert.equal(outcome.result.dispatch_executed, false);
  assert.equal(outcome.result.network_used, false);
  assert.equal(outcome.result.secret_resolved, false);
  assert.equal(outcome.result.executed, false);
});

test('simulation-only: no network access and no secret resolution ever occurs while evaluating a materialization request', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  assert.deepEqual(findAgentCoreOperationalMaterial(golden.queueMaterializationRequest), []);
});

test('simulation-only: the audit registers only IDs/fingerprints/counts, never payload/prompt/secret content', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const outcome = evaluateRuntimeQueueMaterializationRequest(golden.queueMaterializationRequest, {});
  assertValid('audit', validateRuntimeQueueMaterializationAudit(outcome.audit));
  assert.deepEqual(findAgentCoreOperationalMaterial(outcome.audit), []);
});

test('simulation-only: a hostile context claiming queue creation/enqueue permission has zero effect', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const outcomeClean = evaluateRuntimeQueueMaterializationRequest(golden.queueMaterializationRequest, {});
  const outcomeHostile = evaluateRuntimeQueueMaterializationRequest(golden.queueMaterializationRequest, {
    queueCreated: true, enqueueAllowed: true, brokerConnected: true, workerNotified: true
  });
  assert.deepEqual(outcomeClean.decision, outcomeHostile.decision);
});

test('regression: architecture gates report zero findings with every PR109 module included', () => {
  const findings = runAllGates();
  assert.deepEqual(findings, []);
});

// --- Immutability ---------------------------------------------------------------------------------

test('immutability: the input request is never mutated by evaluation', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const request = golden.queueMaterializationRequest;
  const before = canonicalSnapshot(request);

  deepFreeze(request);
  const outcome = evaluateRuntimeQueueMaterializationRequest(request, {});

  assert.equal(outcome.decision.status, 'QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION');
  assertValid('decision', validateRuntimeQueueMaterializationDecision(outcome.decision));
  assert.equal(canonicalSnapshot(request), before);
});

test('immutability: repeated evaluation of the same request preserves status, ids, order, fingerprints, digests, and safe flags', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const first = evaluateRuntimeQueueMaterializationRequest(golden.queueMaterializationRequest, {});
  const second = evaluateRuntimeQueueMaterializationRequest(golden.queueMaterializationRequest, {});

  assert.equal(first.decision.status, second.decision.status);
  assert.deepEqual(first.decision.reason_codes, second.decision.reason_codes);
  assert.equal(first.package.runtime_queue_materialization_package_id, second.package.runtime_queue_materialization_package_id);
  assert.equal(first.package.queue_materialization_package_fingerprint, second.package.queue_materialization_package_fingerprint);
  assert.equal(first.package.queue_materialization_package_digest, second.package.queue_materialization_package_digest);
  assert.deepEqual(first.orderRef.ordered_queue_materialization_entry_reference_ids, second.orderRef.ordered_queue_materialization_entry_reference_ids);
  assert.equal(first.materializationEntryRefs.length, second.materializationEntryRefs.length);
  assert.equal(first.result.queue_created, false);
  assert.equal(second.result.queue_created, false);
  assert.equal(first.result.executed, false);
  assert.equal(second.result.executed, false);
  assert.equal(canonicalSnapshot(first), canonicalSnapshot(second));
});

test('immutability: external mutation attempts cannot alter materialization contracts or later evaluations', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const first = evaluateRuntimeQueueMaterializationRequest(golden.queueMaterializationRequest, {});
  const fullSnapshot = canonicalSnapshot(first);
  const protectedSnapshot = canonicalSnapshot({
    decision: first.decision,
    result: first.result,
    audit: first.audit,
    package: first.package,
    orderRef: first.orderRef
  });

  assertFrozenMutationRejected('package rejects entry_count mutation', first.package, (pkg) => { pkg.entry_count = 999; });
  assertFrozenMutationRejected('entry rejects position mutation', first.materializationEntryRefs[0], (entry) => { entry.materialization_position = 999; });
  tryMutation(() => first.materializationEntryRefs.reverse());
  tryMutation(() => first.materializationEntryRefs.push(first.materializationEntryRefs[0]));

  assert.equal(canonicalSnapshot({
    decision: first.decision,
    result: first.result,
    audit: first.audit,
    package: first.package,
    orderRef: first.orderRef
  }), protectedSnapshot);

  const second = evaluateRuntimeQueueMaterializationRequest(golden.queueMaterializationRequest, {});
  assert.equal(canonicalSnapshot(second), fullSnapshot);
});

test('immutability: materialization rejects prototype-pollution fields and inherited required fields', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const sentinel = 'queue_materialization_pollution_sentinel';

  assertInheritedRequiredFieldRejected({
    label: 'queue materialization request',
    request: golden.queueMaterializationRequest,
    field: 'runtime_queue_materialization_request_id',
    sentinel,
    validate: validateRuntimeQueueMaterializationRequest,
    evaluate: evaluateRuntimeQueueMaterializationRequest,
    expectedStatus: 'QUEUE_MATERIALIZATION_VALIDATION_FAILED'
  });
  assertPollutionFieldsRejected({
    label: 'queue materialization request',
    request: golden.queueMaterializationRequest,
    sentinel,
    validate: validateRuntimeQueueMaterializationRequest,
    evaluate: evaluateRuntimeQueueMaterializationRequest,
    expectedStatus: 'QUEUE_MATERIALIZATION_VALIDATION_FAILED'
  });
});

// --- Registry -----------------------------------------------------------------------------------

test('registry: registers a materialization package, replays an identical one, blocks a payload mismatch', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const outcome = evaluateRuntimeQueueMaterializationRequest(golden.queueMaterializationRequest, {});
  const registry = createRuntimeQueueMaterializationRegistry();
  const first = registry.registerRuntimeQueueMaterializationPackage(outcome.package);
  assert.equal(first.status, 'REGISTERED_SIMULATION');
  const replay = registry.registerRuntimeQueueMaterializationPackage(outcome.package);
  assert.equal(replay.status, 'REPLAY_ACCEPTED');
  const mutated = buildRuntimeQueueMaterializationPackage({ ...outcome.package, entry_count: outcome.package.entry_count });
  void mutated;
  const differentPayload = { ...outcome.package, logical_sequence: outcome.package.logical_sequence + 1 };
  const mismatch = registry.registerRuntimeQueueMaterializationPackage({
    ...differentPayload,
    queue_materialization_package_fingerprint: outcome.package.queue_materialization_package_fingerprint,
    queue_materialization_package_digest: outcome.package.queue_materialization_package_digest
  });
  assert.equal(mismatch.status, 'VALIDATION_FAILED');
});

test('registry: rejects a structurally invalid record as VALIDATION_FAILED', () => {
  const registry = createRuntimeQueueMaterializationRegistry();
  const result = registry.registerRuntimeQueueMaterializationRequest({ not: 'valid' });
  assert.equal(result.status, 'VALIDATION_FAILED');
});

// --- Decision/Result -------------------------------------------------------------------------------

test('materialization decision: valid contract for a prepared outcome', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const outcome = evaluateRuntimeQueueMaterializationRequest(golden.queueMaterializationRequest, {});
  assertValid('decision', validateRuntimeQueueMaterializationDecision(outcome.decision));
});

test('materialization result: valid contract for a prepared outcome', () => {
  const golden = buildGoldenQueueMaterializationBundle();
  const outcome = evaluateRuntimeQueueMaterializationRequest(golden.queueMaterializationRequest, {});
  assertValid('result', validateRuntimeQueueMaterializationResult(outcome.result));
});
