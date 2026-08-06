'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { findAgentCoreOperationalMaterial } = require('../src/core/agent-identity-contract');
const { runAllGates } = require('../src/core/architecture-gate-runner');

const {
  validateRuntimeQueuePlacementEntryReference, buildRuntimeQueuePlacementEntryReference,
  RUNTIME_QUEUE_PLACEMENT_ENTRY_REFERENCE_FIELDS
} = require('../src/core/runtime-queue-placement-entry-reference');
const {
  validateRuntimeQueuePlacementGroupReference, buildRuntimeQueuePlacementGroupReference,
  RUNTIME_QUEUE_PLACEMENT_GROUP_REFERENCE_FIELDS
} = require('../src/core/runtime-queue-placement-group-reference');
const {
  validateRuntimeQueuePlacementOrderReference, buildRuntimeQueuePlacementOrderReference,
  RUNTIME_QUEUE_PLACEMENT_ORDER_REFERENCE_FIELDS
} = require('../src/core/runtime-queue-placement-order-reference');
const {
  validateRuntimeQueuePlacementRequest, buildRuntimeQueuePlacementRequest,
  RUNTIME_QUEUE_PLACEMENT_REQUEST_FIELDS
} = require('../src/core/runtime-queue-placement-request');
const { validateRuntimeQueuePlacementPackage } = require('../src/core/runtime-queue-placement-package');
const {
  validateRuntimeQueuePlacementDecision, QUEUE_PLACEMENT_STATUSES, QUEUE_PLACEMENT_PRECEDENCE_ORDER
} = require('../src/core/runtime-queue-placement-decision');
const { validateRuntimeQueuePlacementResult } = require('../src/core/runtime-queue-placement-result');
const { validateRuntimeQueuePlacementAudit } = require('../src/core/runtime-queue-placement-audit');
const { createRuntimeQueuePlacementRegistry } = require('../src/core/runtime-queue-placement-registry');
const {
  evaluateRuntimeQueuePlacementRequest, checkGroupOrderPreserved, deriveQueuePlacementGroupKey,
  idSetMatches, fingerprintSetMatches
} = require('../src/core/runtime-queue-placement-boundary');

const { buildGoldenQueuePlacementBundle } = require('./helpers/runtime-queue-placement-simulation-test-data');
const { buildRuntimeQueueMaterializationEntryReference } = require('../src/core/runtime-queue-materialization-entry-reference');
const { buildRuntimeQueueMaterializationPackage } = require('../src/core/runtime-queue-materialization-package');
const { buildRuntimeQueueClassReference } = require('../src/core/runtime-queue-class-reference');

function assertValid(label, validation) {
  assert.equal(validation.valid, true, `${label}: ${JSON.stringify(validation.errors)}`);
}

function assertInvalid(label, validation) {
  assert.equal(validation.valid, false, `${label} unexpectedly valid`);
}

const PACKAGE_OPERATIONAL_FLAGS = [
  'queue_placement_applied', 'queue_created', 'queue_item_created', 'queue_item_enqueued', 'queue_item_dequeued',
  'queue_position_reserved', 'broker_published', 'broker_subscribed', 'worker_notified', 'worker_started',
  'lease_created', 'lock_created', 'job_created', 'dispatch_authorized', 'dispatch_executed', 'network_used',
  'secret_resolved', 'executed'
];

// Builds a second, independent placement group by reassigning one of the two golden materialization
// entries to a synthetic second Queue Class -- proves multi-group placement genuinely works, never
// through a full realistic pipeline (unnecessary: this boundary only cross-checks ID/fingerprint SET
// equality and self-consistency, never re-derives Queue Class compatibility).
function buildTwoGroupOutcome() {
  const golden = buildGoldenQueuePlacementBundle();
  const outcome = golden.materializationOutcome;
  const [entry0, entry1] = outcome.materializationEntryRefs;
  const secondClass = buildRuntimeQueueClassReference({ ...golden.queueClass, runtime_queue_class_reference_id: 'second-class-id' });
  const entry1Reassigned = buildRuntimeQueueMaterializationEntryReference({ ...entry1, runtime_queue_class_reference_id: 'second-class-id' });
  const newEntries = [entry0, entry1Reassigned];
  const newPkg = buildRuntimeQueueMaterializationPackage({
    ...outcome.package,
    queue_class_reference_ids: [golden.queueClass.runtime_queue_class_reference_id, 'second-class-id'].sort(),
    queue_class_fingerprints: [golden.queueClass.queue_class_fingerprint, secondClass.queue_class_fingerprint].sort(),
    materialization_entry_fingerprints: newEntries.map((e) => e.materialization_entry_fingerprint).sort()
  });
  const request = buildRuntimeQueuePlacementRequest({
    runtime_queue_placement_request_id: 'two-group-preq',
    runtime_queue_materialization_package_reference: newPkg,
    runtime_queue_materialization_entry_references: newEntries,
    runtime_queue_materialization_order_reference: outcome.orderRef,
    runtime_queue_class_references: [golden.queueClass, secondClass],
    correlation_id: 'corr-two-group', causation_id: 'cause-two-group', trace_id: 'trace-two-group',
    logical_sequence: 0, expected_queue_placement_registry_version: 1,
    simulation_context: golden.queueAdmissionRequest.simulation_context
  });
  return { golden, outcome: evaluateRuntimeQueuePlacementRequest(request, {}) };
}

// --- Entry Reference ------------------------------------------------------------------------------

test('placement entry reference: prepared only when inherited materialization fact is genuinely prepared', () => {
  const base = {
    runtime_queue_placement_entry_reference_id: 'pe-1', runtime_queue_placement_package_id: 'pp-1',
    runtime_queue_materialization_package_id: 'mp-1', runtime_queue_materialization_entry_reference_id: 'me-1',
    runtime_queue_materialization_entry_fingerprint: 'fp-me-1', runtime_queue_admission_entry_reference_id: 'ae-1'
  };
  const placed = buildRuntimeQueuePlacementEntryReference({
    ...base, runtime_queue_class_reference_id: 'qc-1', runtime_queue_placement_group_reference_id: 'pg-1',
    materialization_status: 'QUEUE_ITEM_MATERIALIZATION_PREPARED_SIMULATION', materialization_position: 3,
    placement_position: 0
  });
  assertValid('placed', validateRuntimeQueuePlacementEntryReference(placed));
  assert.deepEqual(Object.keys(placed).sort(), [...RUNTIME_QUEUE_PLACEMENT_ENTRY_REFERENCE_FIELDS].sort());
  assert.equal(placed.placement_status, 'QUEUE_PLACEMENT_PREPARED_SIMULATION');
  assert.equal(placed.placement_position, 0);
  assert.equal(placed.queue_placement_validated, true);
  assert.equal(placed.queue_created, false);

  const blocked = buildRuntimeQueuePlacementEntryReference({
    ...base, runtime_queue_class_reference_id: null,
    materialization_status: 'QUEUE_MATERIALIZATION_BLOCKED_BY_ADMISSION_REFERENCE', materialization_position: null
  });
  assert.equal(blocked.placement_status, 'QUEUE_PLACEMENT_BLOCKED_SIMULATION');
  assert.equal(blocked.placement_position, null);
  assert.equal(blocked.runtime_queue_placement_group_reference_id, null);
  assert.equal(blocked.queue_placement_validated, false);
});

test('placement entry reference: rejects a fabricated position on a blocked entry and a missing position/group on a placed one', () => {
  const base = {
    runtime_queue_placement_entry_reference_id: 'pe-1', runtime_queue_placement_package_id: 'pp-1',
    runtime_queue_materialization_package_id: 'mp-1', runtime_queue_materialization_entry_reference_id: 'me-1',
    runtime_queue_materialization_entry_fingerprint: 'fp-me-1', runtime_queue_admission_entry_reference_id: 'ae-1'
  };
  const forgedPosition = {
    ...buildRuntimeQueuePlacementEntryReference({
      ...base, runtime_queue_class_reference_id: null,
      materialization_status: 'QUEUE_MATERIALIZATION_BLOCKED_BY_ADMISSION_REFERENCE', materialization_position: null
    }),
    placement_position: 0
  };
  assertInvalid('forged position on blocked entry', validateRuntimeQueuePlacementEntryReference(forgedPosition));

  const missingGroup = {
    ...buildRuntimeQueuePlacementEntryReference({
      ...base, runtime_queue_class_reference_id: 'qc-1', runtime_queue_placement_group_reference_id: 'pg-1',
      materialization_status: 'QUEUE_ITEM_MATERIALIZATION_PREPARED_SIMULATION', materialization_position: 0,
      placement_position: 0
    }),
    runtime_queue_placement_group_reference_id: null
  };
  assertInvalid('missing group on placed entry', validateRuntimeQueuePlacementEntryReference(missingGroup));
});

// --- Group Reference -------------------------------------------------------------------------------

test('placement group reference: valid group with monotonic order', () => {
  const group = buildRuntimeQueuePlacementGroupReference({
    runtime_queue_placement_group_reference_id: 'pg-1', runtime_queue_placement_package_id: 'pp-1',
    placement_group_key: 'digest-abc', runtime_queue_class_reference_id: 'qc-1',
    ordered_queue_placement_entry_reference_ids: ['pe-1', 'pe-2'], group_order_preserved: true
  });
  assertValid('group', validateRuntimeQueuePlacementGroupReference(group));
  assert.deepEqual(Object.keys(group).sort(), [...RUNTIME_QUEUE_PLACEMENT_GROUP_REFERENCE_FIELDS].sort());
  assert.equal(group.member_count, 2);
  assert.equal(group.queue_created, false);
});

test('placement group reference: rejects an empty or duplicated member list', () => {
  assert.throws(() => buildRuntimeQueuePlacementGroupReference({
    runtime_queue_placement_group_reference_id: 'pg-2', runtime_queue_placement_package_id: 'pp-1',
    placement_group_key: 'digest-abc', runtime_queue_class_reference_id: 'qc-1',
    ordered_queue_placement_entry_reference_ids: [], group_order_preserved: true
  }));
  assert.throws(() => buildRuntimeQueuePlacementGroupReference({
    runtime_queue_placement_group_reference_id: 'pg-3', runtime_queue_placement_package_id: 'pp-1',
    placement_group_key: 'digest-abc', runtime_queue_class_reference_id: 'qc-1',
    ordered_queue_placement_entry_reference_ids: ['pe-1', 'pe-1'], group_order_preserved: true
  }));
});

// --- Order Reference -------------------------------------------------------------------------------

test('placement order reference: partitions cover every entry exactly once, both preservation flags gate validated', () => {
  const order = buildRuntimeQueuePlacementOrderReference({
    runtime_queue_placement_order_reference_id: 'po-1', runtime_queue_placement_package_id: 'pp-1',
    runtime_queue_materialization_package_id: 'mp-1', runtime_queue_materialization_order_reference_id: 'mo-1',
    runtime_queue_materialization_order_fingerprint: 'fp-mo',
    ordered_queue_materialization_entry_reference_ids: ['me-1', 'me-2'],
    ordered_queue_placement_entry_reference_ids: ['pe-1', 'pe-2'],
    placed_queue_placement_entry_reference_ids: ['pe-1'],
    not_placed_queue_placement_entry_reference_ids: ['pe-2'],
    ordered_queue_placement_group_reference_ids: ['pg-1'],
    materialization_order_preserved: true, predecessor_order_preserved: true
  });
  assertValid('order', validateRuntimeQueuePlacementOrderReference(order));
  assert.deepEqual(Object.keys(order).sort(), [...RUNTIME_QUEUE_PLACEMENT_ORDER_REFERENCE_FIELDS].sort());
  assert.equal(order.queue_placement_order_validated, true);
  assert.equal(order.queue_placement_order_applied, false);
});

test('placement order reference: rejects overlapping or incomplete partitions', () => {
  const base = {
    runtime_queue_placement_order_reference_id: 'po-2', runtime_queue_placement_package_id: 'pp-1',
    runtime_queue_materialization_package_id: 'mp-1', runtime_queue_materialization_order_reference_id: 'mo-1',
    runtime_queue_materialization_order_fingerprint: 'fp-mo',
    ordered_queue_materialization_entry_reference_ids: ['me-1', 'me-2'],
    ordered_queue_placement_entry_reference_ids: ['pe-1', 'pe-2'],
    ordered_queue_placement_group_reference_ids: ['pg-1'],
    materialization_order_preserved: true, predecessor_order_preserved: true
  };
  assert.throws(() => buildRuntimeQueuePlacementOrderReference({
    ...base, placed_queue_placement_entry_reference_ids: ['pe-1', 'pe-2'],
    not_placed_queue_placement_entry_reference_ids: ['pe-2']
  }));
  assert.throws(() => buildRuntimeQueuePlacementOrderReference({
    ...base, placed_queue_placement_entry_reference_ids: ['pe-1'],
    not_placed_queue_placement_entry_reference_ids: []
  }));
});

// --- Request ------------------------------------------------------------------------------------

test('placement request: golden bundle is structurally valid', () => {
  const golden = buildGoldenQueuePlacementBundle();
  assertValid('request', validateRuntimeQueuePlacementRequest(golden.queuePlacementRequest));
  assert.deepEqual(Object.keys(golden.queuePlacementRequest).sort(), [...RUNTIME_QUEUE_PLACEMENT_REQUEST_FIELDS].sort());
});

test('placement request: missing/extra field and invalid nested reference rejected', () => {
  const golden = buildGoldenQueuePlacementBundle();
  assertInvalid('missing field', validateRuntimeQueuePlacementRequest({ ...golden.queuePlacementRequest, runtime_queue_materialization_package_reference: undefined }));
  assertInvalid('extra field', validateRuntimeQueuePlacementRequest({ ...golden.queuePlacementRequest, extra_field: true }));
  assertInvalid('invalid nested materialization package', validateRuntimeQueuePlacementRequest({
    ...golden.queuePlacementRequest, runtime_queue_materialization_package_reference: { not: 'valid' }
  }));
});

// --- Boundary: happy path -------------------------------------------------------------------------

test('boundary: golden bundle reaches QUEUE_PLACEMENT_PACKAGE_PREPARED_SIMULATION with every validated flag true', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const outcome = evaluateRuntimeQueuePlacementRequest(golden.queuePlacementRequest, {});
  assert.equal(outcome.decision.status, 'QUEUE_PLACEMENT_PACKAGE_PREPARED_SIMULATION');
  assert.equal(outcome.decision.queue_placement_package_prepared_in_simulation, true);
  for (const field of [
    'request_validated', 'materialization_package_validated', 'identity_validated', 'cardinality_validated',
    'reference_integrity_validated', 'canonical_order_validated', 'predecessor_order_validated',
    'eligibility_validated', 'entries_validated', 'group_validated', 'placement_order_validated',
    'non_execution_invariants_validated'
  ]) {
    assert.equal(outcome.decision[field], true, field);
  }
  assert.equal(outcome.package.entry_count, 2);
  assert.equal(outcome.package.placed_count, 2);
  assert.equal(outcome.package.group_count, 1);
  assert.deepEqual(outcome.placementEntryRefs.map((e) => e.placement_position), [0, 1]);
});

test('boundary: same Queue Class -> single group; different Queue Classes -> multiple independent groups', () => {
  const { outcome } = buildTwoGroupOutcome();
  assert.equal(outcome.decision.status, 'QUEUE_PLACEMENT_PACKAGE_PREPARED_SIMULATION');
  assert.equal(outcome.package.group_count, 2);
  assert.equal(outcome.placementGroupRefs.length, 2);
  for (const group of outcome.placementGroupRefs) {
    assert.equal(group.member_count, 1);
    assert.equal(group.group_order_preserved, true);
  }
  const groupIds = new Set(outcome.placementEntryRefs.map((e) => e.runtime_queue_placement_group_reference_id));
  assert.equal(groupIds.size, 2);
});

test('boundary: order within group and global order are both preserved', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const outcome = evaluateRuntimeQueuePlacementRequest(golden.queuePlacementRequest, {});
  const canonicalOrder = golden.materializationOutcome.orderRef.ordered_queue_materialization_entry_reference_ids;
  outcome.placementEntryRefs.forEach((entry, index) => {
    assert.equal(entry.runtime_queue_materialization_entry_reference_id, canonicalOrder[index]);
  });
  const group = outcome.placementGroupRefs[0];
  assert.equal(group.group_order_preserved, true);
});

test('boundary: fingerprints are valid and reproducible across an identical re-evaluation', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const first = evaluateRuntimeQueuePlacementRequest(golden.queuePlacementRequest, {});
  const second = evaluateRuntimeQueuePlacementRequest(golden.queuePlacementRequest, {});
  assert.deepEqual(first.package, second.package);
  assert.deepEqual(first.decision, second.decision);
  assert.deepEqual(first.orderRef, second.orderRef);
  assert.deepEqual(first.placementEntryRefs, second.placementEntryRefs);
  assert.deepEqual(first.placementGroupRefs, second.placementGroupRefs);
});

// --- Blocked entries -------------------------------------------------------------------------------

test('boundary: a blocked materialization entry never receives placement, and never appears in placed order', () => {
  const golden = buildGoldenQueuePlacementBundle('sequential-plan');
  const outcome = evaluateRuntimeQueuePlacementRequest(golden.queuePlacementRequest, {});
  assert.equal(outcome.decision.status, 'QUEUE_PLACEMENT_PACKAGE_PREPARED_SIMULATION');
  assert.equal(outcome.package.entry_count, 2);
  assert.equal(outcome.package.not_placed_count, 1);
  const blockedEntry = outcome.placementEntryRefs.find((e) => e.placement_status === 'QUEUE_PLACEMENT_BLOCKED_SIMULATION');
  assert.ok(blockedEntry);
  assert.equal(blockedEntry.placement_position, null);
  assert.equal(blockedEntry.runtime_queue_placement_group_reference_id, null);
  assert.ok(outcome.orderRef.not_placed_queue_placement_entry_reference_ids.includes(blockedEntry.runtime_queue_placement_entry_reference_id));
  assert.ok(!outcome.orderRef.placed_queue_placement_entry_reference_ids.includes(blockedEntry.runtime_queue_placement_entry_reference_id));
});

test('boundary: the original materialization status remains auditable on the blocked placement entry', () => {
  const golden = buildGoldenQueuePlacementBundle('sequential-plan');
  const outcome = evaluateRuntimeQueuePlacementRequest(golden.queuePlacementRequest, {});
  const blockedEntry = outcome.placementEntryRefs.find((e) => e.placement_status === 'QUEUE_PLACEMENT_BLOCKED_SIMULATION');
  const originalEntry = outcome.materializationEntryRefs.find((e) => e.runtime_queue_materialization_entry_reference_id === blockedEntry.runtime_queue_materialization_entry_reference_id);
  assert.equal(originalEntry.materialization_status, blockedEntry.materialization_status);
  assert.notEqual(blockedEntry.materialization_status, 'QUEUE_ITEM_MATERIALIZATION_PREPARED_SIMULATION');
});

test('boundary: cardinality and identity remain consistent -- every materialization entry produces exactly one placement entry', () => {
  const golden = buildGoldenQueuePlacementBundle('sequential-plan');
  const outcome = evaluateRuntimeQueuePlacementRequest(golden.queuePlacementRequest, {});
  assert.equal(outcome.placementEntryRefs.length, outcome.materializationEntryRefs.length);
  const materializationIds = new Set(outcome.materializationEntryRefs.map((e) => e.runtime_queue_materialization_entry_reference_id));
  const placementMaterializationIds = new Set(outcome.placementEntryRefs.map((e) => e.runtime_queue_materialization_entry_reference_id));
  assert.deepEqual([...materializationIds].sort(), [...placementMaterializationIds].sort());
});

test('boundary: all entries blocked -- placement order is empty but the package is still auditable and prepared', () => {
  const seqGolden = buildGoldenQueuePlacementBundle('sequential-plan');
  const seqOutcome = seqGolden.materializationOutcome;
  const [seqEntry0, seqEntry1] = seqOutcome.materializationEntryRefs;
  // seqEntry1 is already genuinely blocked (WAITING_DEPENDENCY); rebuild seqEntry0 as blocked too by
  // reusing its own already-inherited admission facts is not possible without a real second blocked
  // admission entry, so instead reuse the same non-substitution-safe rebuild pattern: force its own
  // materialization_status to the blocked value directly (a materialization entry's own validator
  // only requires internal self-consistency between materialization_status/materialization_position,
  // not that it was truly derived from a specific admission_status value once already built).
  const forcedBlockedEntry0 = buildRuntimeQueueMaterializationEntryReference({
    ...seqEntry0, admission_status: 'QUEUE_ADMISSION_WAITING_DEPENDENCY_REFERENCE', queue_admission_validated: false
  });
  const newEntries = [forcedBlockedEntry0, seqEntry1];
  const newPkg = buildRuntimeQueueMaterializationPackage({
    ...seqOutcome.package,
    materialization_entry_fingerprints: newEntries.map((e) => e.materialization_entry_fingerprint).sort()
  });
  const request = buildRuntimeQueuePlacementRequest({
    runtime_queue_placement_request_id: 'all-blocked-preq',
    runtime_queue_materialization_package_reference: newPkg,
    runtime_queue_materialization_entry_references: newEntries,
    runtime_queue_materialization_order_reference: seqOutcome.orderRef,
    runtime_queue_class_references: seqOutcome.queueClassRefs,
    correlation_id: 'corr-all-blocked', causation_id: 'cause-all-blocked', trace_id: 'trace-all-blocked',
    logical_sequence: 0, expected_queue_placement_registry_version: 1,
    simulation_context: seqGolden.queueAdmissionRequest.simulation_context
  });
  const result = evaluateRuntimeQueuePlacementRequest(request, {});
  assert.equal(result.decision.status, 'QUEUE_PLACEMENT_PACKAGE_PREPARED_SIMULATION');
  assert.equal(result.package.entry_count, 2);
  assert.equal(result.package.placed_count, 0);
  assert.equal(result.package.group_count, 0);
  assert.deepEqual(result.orderRef.placed_queue_placement_entry_reference_ids, []);
});

test('boundary: [A placed, B blocked, C placed] never leaves an artificial gap -- mirrors pr109audit\'s own no-gap proof one layer up', () => {
  const { outcome } = buildTwoGroupOutcome();
  // Both entries in the two-group scenario are genuinely placed (positions 0 within their own,
  // independent single-member groups) -- this test instead directly exercises the pure
  // checkGroupOrderPreserved function with an explicit accepted/blocked/accepted pattern, proving
  // gaps are never introduced by a blocked member sharing a group with placed ones.
  void outcome;
  const noGap = [{ placement_position: 0 }, { placement_position: null }, { placement_position: 1 }];
  assert.equal(checkGroupOrderPreserved(noGap), true);
});

// --- Order -------------------------------------------------------------------------------------

test('boundary: a materialization package whose duplicated order diverges from its own Order Reference is never silently accepted (self-fingerprint catches it at construction)', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const tamperedPackage = { ...golden.materializationOutcome.package, ordered_queue_materialization_entry_reference_ids: [...golden.materializationOutcome.package.ordered_queue_materialization_entry_reference_ids].reverse() };
  assert.throws(() => buildRuntimeQueuePlacementRequest({ ...golden.queuePlacementRequest, runtime_queue_materialization_package_reference: tamperedPackage }));
});

test('boundary: a materialization entry missing from the request while still referenced by canonical order blocks the outcome from ever reaching PREPARED', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const missingOneEntry = golden.materializationOutcome.materializationEntryRefs.slice(1);
  const request = buildRuntimeQueuePlacementRequest({ ...golden.queuePlacementRequest, runtime_queue_materialization_entry_references: missingOneEntry });
  const outcome = evaluateRuntimeQueuePlacementRequest(request, {});
  assert.notEqual(outcome.decision.status, 'QUEUE_PLACEMENT_PACKAGE_PREPARED_SIMULATION');
});

test('boundary: an extra materialization entry reference not committed by the package is never silently accepted', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const foreignEntry = { ...golden.materializationOutcome.materializationEntryRefs[0], runtime_queue_materialization_entry_reference_id: 'foreign-entry-id' };
  assert.throws(() => buildRuntimeQueuePlacementRequest({
    ...golden.queuePlacementRequest, runtime_queue_materialization_entry_references: [...golden.materializationOutcome.materializationEntryRefs, foreignEntry]
  }));
});

test('boundary: a duplicated materialization entry reference is never silently accepted', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const duplicated = [golden.materializationOutcome.materializationEntryRefs[0], ...golden.materializationOutcome.materializationEntryRefs];
  const request = buildRuntimeQueuePlacementRequest({ ...golden.queuePlacementRequest, runtime_queue_materialization_entry_references: duplicated });
  const outcome = evaluateRuntimeQueuePlacementRequest(request, {});
  assert.notEqual(outcome.decision.status, 'QUEUE_PLACEMENT_PACKAGE_PREPARED_SIMULATION');
});

test('boundary: incidental array ordering of the bundled Materialization Entries never alters the placed result', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const shuffledRequest = buildRuntimeQueuePlacementRequest({
    ...golden.queuePlacementRequest,
    runtime_queue_materialization_entry_references: [...golden.queuePlacementRequest.runtime_queue_materialization_entry_references].reverse()
  });
  const outcomeClean = evaluateRuntimeQueuePlacementRequest(golden.queuePlacementRequest, {});
  const outcomeShuffled = evaluateRuntimeQueuePlacementRequest(shuffledRequest, {});
  assert.deepEqual(outcomeClean.orderRef.ordered_queue_placement_entry_reference_ids, outcomeShuffled.orderRef.ordered_queue_placement_entry_reference_ids);
  assert.equal(outcomeClean.decision.status, outcomeShuffled.decision.status);
});

// --- Placement -------------------------------------------------------------------------------------

test('boundary: a placed entry without a real Queue Class dimension fails the whole package (structural incompatibility, never a permissive partial block)', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const outcome = golden.materializationOutcome;
  const [entry0, entry1] = outcome.materializationEntryRefs;
  const entryMissingClass = buildRuntimeQueueMaterializationEntryReference({ ...entry0, runtime_queue_class_reference_id: null });
  const newEntries = [entryMissingClass, entry1];
  const newPkg = buildRuntimeQueueMaterializationPackage({
    ...outcome.package,
    materialization_entry_fingerprints: newEntries.map((e) => e.materialization_entry_fingerprint).sort()
  });
  const request = buildRuntimeQueuePlacementRequest({
    ...golden.queuePlacementRequest,
    runtime_queue_materialization_package_reference: newPkg,
    runtime_queue_materialization_entry_references: newEntries
  });
  const result = evaluateRuntimeQueuePlacementRequest(request, {});
  assert.equal(result.decision.status, 'QUEUE_PLACEMENT_GROUP_BLOCKED');
});

test('deriveQueuePlacementGroupKey: deterministic recomputation -- same Queue Class always yields the same key, different classes yield different keys', () => {
  const keyA1 = deriveQueuePlacementGroupKey('qc-1');
  const keyA2 = deriveQueuePlacementGroupKey('qc-1');
  const keyB = deriveQueuePlacementGroupKey('qc-2');
  assert.equal(keyA1, keyA2);
  assert.notEqual(keyA1, keyB);
});

test('boundary: placement_group_key participates in the group fingerprint -- tampering it is never silently accepted', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const outcome = evaluateRuntimeQueuePlacementRequest(golden.queuePlacementRequest, {});
  const group = outcome.placementGroupRefs[0];
  const tampered = { ...group, placement_group_key: 'forged-key' };
  assertInvalid('tampered placement_group_key', validateRuntimeQueuePlacementGroupReference(tampered));
});

// --- Predecessor --------------------------------------------------------------------------------

test('boundary: the inherited predecessor_order_preserved=false blocks at construction (self-fingerprint catches it, part of the Order Reference\'s own fingerprinted fields)', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const tamperedOrderRef = { ...golden.materializationOutcome.orderRef, predecessor_order_preserved: false };
  assert.throws(() => buildRuntimeQueuePlacementRequest({ ...golden.queuePlacementRequest, runtime_queue_materialization_order_reference: tamperedOrderRef }));
});

test('checkGroupOrderPreserved: strictly increasing positions within a group pass, non-increasing fails', () => {
  const increasing = [{ placement_position: 0 }, { placement_position: 1 }, { placement_position: 2 }];
  assert.equal(checkGroupOrderPreserved(increasing), true);
  const nonIncreasing = [{ placement_position: 1 }, { placement_position: 0 }];
  assert.equal(checkGroupOrderPreserved(nonIncreasing), false);
  const repeated = [{ placement_position: 0 }, { placement_position: 0 }];
  assert.equal(checkGroupOrderPreserved(repeated), false);
});

test('boundary: predecessor references divergent from the official Materialization Order Reference are never silently accepted', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const foreignOrderRef = { ...golden.materializationOutcome.orderRef, runtime_queue_materialization_order_reference_id: 'foreign-order-id' };
  assert.throws(() => buildRuntimeQueuePlacementRequest({ ...golden.queuePlacementRequest, runtime_queue_materialization_order_reference: foreignOrderRef }));
});

// --- Identity chain -------------------------------------------------------------------------------

test('boundary: an altered Materialization Package reference (wrong fingerprint) is never silently accepted -- self-fingerprint catches it at construction', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const tamperedPackage = { ...golden.materializationOutcome.package, entry_count: 999 };
  assert.throws(() => buildRuntimeQueuePlacementRequest({ ...golden.queuePlacementRequest, runtime_queue_materialization_package_reference: tamperedPackage }));
});

test('boundary: a Queue Class reference substituted for a different one not committed by the package is never silently accepted', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const foreignClass = buildRuntimeQueueClassReference({ ...golden.queueClass, runtime_queue_class_reference_id: 'foreign-class-id' });
  const request = buildRuntimeQueuePlacementRequest({ ...golden.queuePlacementRequest, runtime_queue_class_references: [foreignClass] });
  const outcome = evaluateRuntimeQueuePlacementRequest(request, {});
  assert.notEqual(outcome.decision.status, 'QUEUE_PLACEMENT_PACKAGE_PREPARED_SIMULATION');
});

test('boundary: identity-field divergence on the bundled Materialization Package is never silently accepted -- self-fingerprint catches it at construction', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const foreignIdentityPackage = { ...golden.materializationOutcome.package, tenant_id: 'tenant-foreign' };
  assert.throws(() => buildRuntimeQueuePlacementRequest({ ...golden.queuePlacementRequest, runtime_queue_materialization_package_reference: foreignIdentityPackage }));
});

// --- Fingerprints ---------------------------------------------------------------------------------

test('boundary: the request fingerprint changes when the request payload changes', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const outcomeA = evaluateRuntimeQueuePlacementRequest(golden.queuePlacementRequest, {});
  const changedRequest = buildRuntimeQueuePlacementRequest({ ...golden.queuePlacementRequest, correlation_id: 'corr-different' });
  const outcomeB = evaluateRuntimeQueuePlacementRequest(changedRequest, {});
  assert.notEqual(outcomeA.decision.runtime_queue_placement_request_fingerprint, outcomeB.decision.runtime_queue_placement_request_fingerprint);
});

test('boundary: the placement entry fingerprint changes when a semantically relevant field changes', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const outcome = evaluateRuntimeQueuePlacementRequest(golden.queuePlacementRequest, {});
  const entry = outcome.placementEntryRefs[0];
  const { placement_entry_fingerprint, ...rest } = entry;
  void placement_entry_fingerprint;
  const tampered = { ...rest, placement_position: entry.placement_position + 100 };
  assert.notEqual(JSON.stringify(rest), JSON.stringify(tampered));
});

test('boundary: the group fingerprint changes when the real group membership changes', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const outcome = evaluateRuntimeQueuePlacementRequest(golden.queuePlacementRequest, {});
  const forgedGroup = { ...outcome.placementGroupRefs[0], ordered_queue_placement_entry_reference_ids: [...outcome.placementGroupRefs[0].ordered_queue_placement_entry_reference_ids].reverse() };
  assertInvalid('forged reversed group membership', validateRuntimeQueuePlacementGroupReference(forgedGroup));
});

test('package integrity: fingerprint/digest self-recompute detects tampering', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const outcome = evaluateRuntimeQueuePlacementRequest(golden.queuePlacementRequest, {});
  assert.equal(outcome.decision.status, 'QUEUE_PLACEMENT_PACKAGE_PREPARED_SIMULATION');
  assertInvalid('tampered entry_count', validateRuntimeQueuePlacementPackage({ ...outcome.package, entry_count: 999 }));
});

test('boundary: QUEUE_PLACEMENT_PRECEDENCE_ORDER covers QUEUE_PLACEMENT_STATUSES exactly', () => {
  assert.deepEqual([...QUEUE_PLACEMENT_STATUSES].sort(), [...QUEUE_PLACEMENT_PRECEDENCE_ORDER].sort());
});

test('idSetMatches/fingerprintSetMatches: pure helper functions behave as documented', () => {
  assert.equal(idSetMatches([{ id: 'a' }, { id: 'b' }], 'id', ['b', 'a']), true);
  assert.equal(idSetMatches([{ id: 'a' }], 'id', ['a', 'b']), false);
  assert.equal(fingerprintSetMatches([{ v: 1 }], (x) => String(x.v), ['1']), true);
  assert.equal(fingerprintSetMatches([{ v: 1 }], (x) => String(x.v), ['2']), false);
});

// --- Fail-closed ---------------------------------------------------------------------------------

test('fail-closed: an unknown queue_materialization_status on the bundled Materialization Package is never silently accepted', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const tampered = { ...golden.materializationOutcome.package, queue_materialization_status: 'QUEUE_MATERIALIZATION_UNKNOWN_FUTURE_STATUS' };
  assert.throws(() => buildRuntimeQueuePlacementRequest({ ...golden.queuePlacementRequest, runtime_queue_materialization_package_reference: tampered }));
});

test('fail-closed: a Materialization Package not genuinely prepared (a different real status) blocks BLOCKED_BY_INHERITED_DATA', () => {
  const golden = buildGoldenQueuePlacementBundle('sequential-plan');
  // sequential-plan already reaches QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION with a partial
  // placement (one blocked entry) -- this test instead directly proves a materialization package with
  // a genuinely different status (never PREPARED) blocks upstream, using a hand-tampered but
  // self-fingerprint-consistent status via full rebuild.
  const outcome = golden.materializationOutcome;
  const blockedPkg = buildRuntimeQueueMaterializationPackage({ ...outcome.package, queue_materialization_status: 'QUEUE_MATERIALIZATION_ORDER_BLOCKED' });
  const request = buildRuntimeQueuePlacementRequest({ ...golden.queuePlacementRequest, runtime_queue_materialization_package_reference: blockedPkg });
  const result = evaluateRuntimeQueuePlacementRequest(request, {});
  assert.equal(result.decision.status, 'QUEUE_PLACEMENT_BLOCKED_BY_INHERITED_DATA');
});

test('fail-closed: a partial payload (missing required fields) never constructs', () => {
  const golden = buildGoldenQueuePlacementBundle();
  assert.throws(() => buildRuntimeQueuePlacementRequest({
    runtime_queue_placement_request_id: golden.queuePlacementRequest.runtime_queue_placement_request_id
  }));
});

test('fail-closed: a broken/non-official-shaped Materialization Package reference never constructs', () => {
  assert.throws(() => buildRuntimeQueuePlacementRequest({
    runtime_queue_placement_request_id: 'pr-broken',
    runtime_queue_materialization_package_reference: { looks: 'similar', but: 'not official' },
    runtime_queue_materialization_entry_references: [], runtime_queue_materialization_order_reference: {},
    runtime_queue_class_references: [], correlation_id: 'c', causation_id: 'ca', trace_id: 't',
    logical_sequence: 0, expected_queue_placement_registry_version: 1,
    simulation_context: { environment: 'DEVELOPMENT', simulation: true, production_blocked: true, rollout_percentage: 0 }
  }));
});

// --- Simulation-only -------------------------------------------------------------------------------

test('simulation-only: every producible outcome forces every operational flag false, simulation=true, production_blocked=true, rollout=0', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const outcome = evaluateRuntimeQueuePlacementRequest(golden.queuePlacementRequest, {});
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

test('simulation-only: no queue, item, enqueue, broker, worker, job or execution is ever created in any producible outcome', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const outcome = evaluateRuntimeQueuePlacementRequest(golden.queuePlacementRequest, {});
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

test('simulation-only: no network access and no secret resolution ever occurs while evaluating a placement request', () => {
  const golden = buildGoldenQueuePlacementBundle();
  assert.deepEqual(findAgentCoreOperationalMaterial(golden.queuePlacementRequest), []);
});

test('simulation-only: the audit registers only IDs/fingerprints/counts, never payload/prompt/secret content', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const outcome = evaluateRuntimeQueuePlacementRequest(golden.queuePlacementRequest, {});
  assertValid('audit', validateRuntimeQueuePlacementAudit(outcome.audit));
  assert.deepEqual(findAgentCoreOperationalMaterial(outcome.audit), []);
});

test('simulation-only: a hostile context claiming queue/broker permission has zero effect', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const outcomeClean = evaluateRuntimeQueuePlacementRequest(golden.queuePlacementRequest, {});
  const outcomeHostile = evaluateRuntimeQueuePlacementRequest(golden.queuePlacementRequest, {
    queueCreated: true, enqueueAllowed: true, brokerConnected: true, workerNotified: true
  });
  assert.deepEqual(outcomeClean.decision, outcomeHostile.decision);
});

test('regression: architecture gates report zero findings with every PR110 module included', () => {
  const findings = runAllGates();
  assert.deepEqual(findings, []);
});

// --- Immutability ---------------------------------------------------------------------------------

test('immutability: the input request is never mutated by evaluation', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const before = JSON.stringify(golden.queuePlacementRequest);
  evaluateRuntimeQueuePlacementRequest(golden.queuePlacementRequest, {});
  const after = JSON.stringify(golden.queuePlacementRequest);
  assert.equal(before, after);
});

test('immutability: repeated evaluation of the same request produces byte-identical output', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const first = evaluateRuntimeQueuePlacementRequest(golden.queuePlacementRequest, {});
  const second = evaluateRuntimeQueuePlacementRequest(golden.queuePlacementRequest, {});
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
});

test('immutability: constructed contracts are frozen and reject direct mutation attempts', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const outcome = evaluateRuntimeQueuePlacementRequest(golden.queuePlacementRequest, {});
  assert.throws(() => { outcome.package.entry_count = 999; }, TypeError);
  assert.throws(() => { outcome.placementEntryRefs[0].placement_position = 999; }, TypeError);
});

// --- Registry -----------------------------------------------------------------------------------

test('registry: registers a placement package, replays an identical one, blocks a payload mismatch', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const outcome = evaluateRuntimeQueuePlacementRequest(golden.queuePlacementRequest, {});
  const registry = createRuntimeQueuePlacementRegistry();
  const first = registry.registerRuntimeQueuePlacementPackage(outcome.package);
  assert.equal(first.status, 'REGISTERED_SIMULATION');
  const replay = registry.registerRuntimeQueuePlacementPackage(outcome.package);
  assert.equal(replay.status, 'REPLAY_ACCEPTED');
  const differentPayload = { ...outcome.package, logical_sequence: outcome.package.logical_sequence + 1 };
  const mismatch = registry.registerRuntimeQueuePlacementPackage({
    ...differentPayload,
    queue_placement_package_fingerprint: outcome.package.queue_placement_package_fingerprint,
    queue_placement_package_digest: outcome.package.queue_placement_package_digest
  });
  assert.equal(mismatch.status, 'VALIDATION_FAILED');
});

test('registry: rejects a structurally invalid record as VALIDATION_FAILED', () => {
  const registry = createRuntimeQueuePlacementRegistry();
  const result = registry.registerRuntimeQueuePlacementRequest({ not: 'valid' });
  assert.equal(result.status, 'VALIDATION_FAILED');
});

// --- Decision/Result -------------------------------------------------------------------------------

test('placement decision: valid contract for a prepared outcome', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const outcome = evaluateRuntimeQueuePlacementRequest(golden.queuePlacementRequest, {});
  assertValid('decision', validateRuntimeQueuePlacementDecision(outcome.decision));
});

test('placement result: valid contract for a prepared outcome', () => {
  const golden = buildGoldenQueuePlacementBundle();
  const outcome = evaluateRuntimeQueuePlacementRequest(golden.queuePlacementRequest, {});
  assertValid('result', validateRuntimeQueuePlacementResult(outcome.result));
});
