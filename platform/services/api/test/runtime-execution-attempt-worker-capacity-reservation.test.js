'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { stablePayload } = require('../src/core/agent-identity-contract');
const { computeCanonicalContentDigest } = require('../src/core/canonical-content-digest');
const { buildOperationalOwnerIdentity, planToInsertRow: ownerToInsertRow } = require('../src/core/runtime-operational-owner-identity');
const { buildWorkerRegistration } = require('../src/core/runtime-worker-registry-contract');
const { buildOwnershipPlan, planToInsertRow: ownershipToInsertRow } = require('../src/core/runtime-execution-attempt-worker-ownership');
const { buildLeasePlan, planToInsertRow: leaseToInsertRow } = require('../src/core/runtime-execution-attempt-worker-lease');
const {
  CAPACITY_DIMENSIONS,
  SAFE_FLAGS,
  buildCapacityResource,
  buildCapacityReservationPlan,
  classifyPersistedCapacityReservation,
  planToInsertRow,
  validatePersistedCapacityReservation,
  validatePersistedCapacityResource
} = require('../src/core/runtime-execution-attempt-worker-capacity-reservation');

function worker(overrides = {}) {
  return buildWorkerRegistration({
    worker_id: 'worker-capacity-a', tenant_id: 'tenant-capacity-1', organization_id: 'organization-capacity-1',
    project_id: 'project-capacity-1', worker_type: 'DEDICATED_REFERENCE', lifecycle_state: 'ACTIVE',
    worker_capability_reference_id: 'capability-capacity-1', worker_compatibility_reference_ids: [],
    supported_stage_types: ['MODEL_REFERENCE_STAGE'], supported_modalities: ['TEXT_INPUT'],
    supported_model_provider_ids: [], supported_model_ids: [], supported_tool_ids: [], supported_workflow_ids: [],
    ...overrides
  });
}

function owner(overrides = {}) {
  return ownerToInsertRow(buildOperationalOwnerIdentity({
    operational_owner_type: 'operational_owner', owner_reference_id: 'owner-capacity-1',
    tenant_id: 'tenant-capacity-1', organization_id: 'organization-capacity-1', project_id: 'project-capacity-1', ...overrides
  }));
}

function binding(canonicalWorker) {
  const identity = {
    contract_name: 'RUNTIME_EXECUTION_ATTEMPT_CLAIM_WORKER_BINDING_AUTHORITY',
    contract_version: 'runtime_execution_attempt_claim_worker_binding_authority_contract_v1',
    claim_id: 'claim-capacity-1', claim_digest: `sha256:${'1'.repeat(64)}`,
    attempt_durable_record_id: 'attempt-capacity-1', runtime_stage_reference_id: 'stage-capacity-1', runtime_stage_reference_version: 1,
    selection_id: 'selection-capacity-1', selection_digest: `sha256:${'2'.repeat(64)}`,
    selected_worker_id: canonicalWorker.worker_id, selected_worker_digest: canonicalWorker.canonical_digest, binding_ordinal: 1,
    tenant_id: canonicalWorker.tenant_id, organization_id: canonicalWorker.organization_id, project_id: canonicalWorker.project_id,
    session_reference_id: 'session-capacity-1', agent_id: 'agent-capacity-1', actor_id: 'actor-capacity-1'
  };
  const digest = computeCanonicalContentDigest(identity);
  const id = `runtime-execution-attempt-claim-worker-binding-${digest.slice('sha256:'.length)}`;
  return {
    ...identity, binding_id: id, binding_fingerprint: stablePayload(identity), binding_digest: digest,
    binding_artifact: {
      ...identity, binding_id: id, binding_digest: digest, worker_selected: true, worker_bound: true,
      worker_ownership_established: false, executor_bound: false, executor_ownership_established: false,
      capacity_reserved: false, lease_created: false, lease_granted: false, fencing_token_created: false,
      fencing_token_issued: false, execution_authorized: false, execution_started: false, execution_performed: false,
      binding_grants_ownership: false, binding_reserves_capacity: false, binding_creates_lease: false,
      binding_creates_fencing: false, binding_authorizes_execution: false, simulation: false, production_blocked: true
    }
  };
}

function lease() {
  const canonicalWorker = worker();
  const ownershipPlan = buildOwnershipPlan({ binding: binding(canonicalWorker), owner: owner(), worker: canonicalWorker, ownership_ordinal: 1 });
  assert.equal(ownershipPlan.outcome, 'READY');
  const plan = buildLeasePlan({
    ownership: { ...ownershipToInsertRow(ownershipPlan), created_at: '2026-09-02T00:00:00.000Z' },
    owner: owner(), worker: canonicalWorker, lease_ordinal: 1
  });
  assert.equal(plan.outcome, 'READY');
  return { ...leaseToInsertRow(plan), lease_expires_at: '2099-01-01T00:00:00.000Z', created_at: '2026-09-02T00:00:00.000Z', updated_at: '2026-09-02T00:00:00.000Z' };
}

function resource(overrides = {}) {
  return buildCapacityResource({
    capacity_resource_id: 'capacity-resource-1', capacity_dimension: 'worker_stage_assignments', worker_id: 'worker-capacity-a',
    tenant_id: 'tenant-capacity-1', organization_id: 'organization-capacity-1', project_id: 'project-capacity-1',
    session_reference_id: 'session-capacity-1', agent_id: 'agent-capacity-1', actor_id: 'actor-capacity-1', capacity_limit: 1, ...overrides
  });
}

function plan(overrides = {}) {
  return buildCapacityReservationPlan({ lease: lease(), resource: resource(), operational_owner_id: 'runtime-operational-owner-identity-placeholder', fencing_token: 1, requested_amount: 1, ...overrides });
}

function validPlan() {
  const currentLease = lease();
  return buildCapacityReservationPlan({ lease: currentLease, resource: resource(), operational_owner_id: currentLease.operational_owner_id, fencing_token: 1, requested_amount: 1 });
}

test('P14C capacity dimensions and deterministic resource identity are canonical', () => {
  const first = resource();
  const second = resource();
  assert.equal(first.outcome, 'READY');
  assert.deepEqual(first.capacity_dimension, CAPACITY_DIMENSIONS[0]);
  assert.equal(first.capacity_digest, second.capacity_digest);
  assert.equal(first.capacity_fingerprint, second.capacity_fingerprint);
  assert.equal(validatePersistedCapacityResource({ ...first, reserved_amount: 0 }).valid, true);
});

test('P14C builds deterministic reservation identity without timestamp input', () => {
  const first = validPlan();
  const second = validPlan();
  assert.equal(first.outcome, 'READY');
  assert.equal(first.reservation_id, second.reservation_id);
  assert.equal(first.reservation_fingerprint, second.reservation_fingerprint);
  assert.equal(first.reservation_digest, second.reservation_digest);
  assert.equal(first.identity.created_at, undefined);
});

test('P14C rejects invalid lease, owner, fencing, amount, scope and worker', () => {
  const currentLease = lease();
  const currentResource = resource();
  for (const input of [
    { lease: null },
    { resource: null },
    { operational_owner_id: 'wrong-owner' },
    { fencing_token: 2 },
    { requested_amount: 0 },
    { resource: resource({ worker_id: 'worker-capacity-b' }) },
    { resource: resource({ tenant_id: 'other-tenant' }) },
    { reservation_ordinal: 0 }
  ]) {
    const result = buildCapacityReservationPlan({ lease: currentLease, resource: currentResource, operational_owner_id: currentLease.operational_owner_id, fencing_token: 1, requested_amount: 1, ...input });
    assert.equal(result.outcome, 'INVALID');
  }
});

test('P14C classifies identical replay and divergent slot content fail-closed', () => {
  const first = validPlan();
  const persisted = { ...planToInsertRow(first), created_at: '2026-09-02T00:00:00.000Z' };
  assert.equal(validatePersistedCapacityReservation(persisted).valid, true);
  assert.equal(classifyPersistedCapacityReservation(persisted, first).outcome, 'EXISTING_IDENTICAL');
  const divergent = buildCapacityReservationPlan({ lease: lease(), resource: resource({ capacity_resource_id: 'capacity-resource-2' }), operational_owner_id: first.identity.operational_owner_id, fencing_token: 1, requested_amount: 1 });
  assert.equal(classifyPersistedCapacityReservation(persisted, divergent).outcome, 'CONFLICT');
});

test('P14C detects artifact, fingerprint and digest tampering', () => {
  const first = validPlan();
  const persisted = planToInsertRow(first);
  assert.equal(validatePersistedCapacityReservation({ ...persisted, reservation_fingerprint: 'tampered' }).valid, false);
  assert.equal(validatePersistedCapacityReservation({ ...persisted, reservation_digest: `sha256:${'f'.repeat(64)}` }).valid, false);
  assert.equal(validatePersistedCapacityReservation({ ...persisted, reservation_artifact: { ...persisted.reservation_artifact, production_blocked: false } }).valid, false);
});

test('P14C requires active current fencing and never grants execution', () => {
  const currentLease = lease();
  const first = buildCapacityReservationPlan({ lease: currentLease, resource: resource(), operational_owner_id: currentLease.operational_owner_id, fencing_token: 1, requested_amount: 1 });
  assert.equal(first.outcome, 'READY');
  for (const [field, expected] of Object.entries(SAFE_FLAGS)) assert.equal(first[field], expected, field);
  assert.equal(first.execution_authorized, false);
  assert.equal(first.capacity_reserved, true);
  assert.equal(first.reservation_creates_lease, false);
  assert.equal(first.reservation_creates_fencing, false);
});

test('P14C treats expired or released leases as stale and preserves predecessor immutability', () => {
  const currentLease = lease();
  const before = JSON.stringify(currentLease);
  assert.equal(buildCapacityReservationPlan({ lease: { ...currentLease, lease_state: 'EXPIRED' }, resource: resource(), operational_owner_id: currentLease.operational_owner_id, fencing_token: 1, requested_amount: 1 }).outcome, 'INVALID');
  assert.equal(buildCapacityReservationPlan({ lease: { ...currentLease, lease_state: 'RELEASED' }, resource: resource(), operational_owner_id: currentLease.operational_owner_id, fencing_token: 1, requested_amount: 1 }).outcome, 'INVALID');
  assert.equal(JSON.stringify(currentLease), before);
});

test('P14C preserves the boundary against quota, lease takeover and execution', () => {
  const first = validPlan();
  for (const forbidden of ['owner_id', 'lease_takeover', 'reclaim', 'execution_authority', 'provider', 'network', 'secret']) {
    assert.equal(Object.hasOwn(first, forbidden), false, forbidden);
    assert.equal(Object.hasOwn(first.reservation_artifact, forbidden), false, forbidden);
  }
  assert.equal(first.quota_reserved, false);
  assert.equal(first.execution_started, false);
  assert.equal(first.execution_performed, false);
  assert.equal(first.production_blocked, true);
});
