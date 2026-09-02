'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { stablePayload } = require('../src/core/agent-identity-contract');
const { computeCanonicalContentDigest } = require('../src/core/canonical-content-digest');
const { buildOperationalOwnerIdentity, planToInsertRow: ownerToInsertRow } = require('../src/core/runtime-operational-owner-identity');
const { buildWorkerRegistration } = require('../src/core/runtime-worker-registry-contract');
const {
  BINDING_ID_PREFIX,
  CONTRACT_NAME: BINDING_CONTRACT_NAME,
  CONTRACT_VERSION: BINDING_CONTRACT_VERSION,
  buildBindingPlan,
  planToInsertRow: bindingToInsertRow
} = require('../src/core/runtime-execution-attempt-claim-worker-binding');
const {
  CONTRACT_NAME,
  CONTRACT_VERSION,
  FIELDS,
  SAFE_FLAGS,
  buildOwnershipPlan,
  classifyPersistedOwnership,
  planToInsertRow,
  validatePersistedOwnership
} = require('../src/core/runtime-execution-attempt-worker-ownership');

function worker(overrides = {}) {
  return buildWorkerRegistration({
    worker_id: 'worker-ownership-a',
    tenant_id: 'tenant-ownership-1',
    organization_id: 'organization-ownership-1',
    project_id: 'project-ownership-1',
    worker_type: 'DEDICATED_REFERENCE',
    lifecycle_state: 'ACTIVE',
    worker_capability_reference_id: 'capability-ownership-1',
    worker_compatibility_reference_ids: [],
    supported_stage_types: ['MODEL_REFERENCE_STAGE'],
    supported_modalities: ['TEXT_INPUT'],
    supported_model_provider_ids: [],
    supported_model_ids: [],
    supported_tool_ids: [],
    supported_workflow_ids: [],
    ...overrides
  });
}

function owner(overrides = {}) {
  const plan = buildOperationalOwnerIdentity({
    operational_owner_type: 'operational_owner',
    owner_reference_id: 'owner-reference-1',
    tenant_id: 'tenant-ownership-1',
    organization_id: 'organization-ownership-1',
    project_id: 'project-ownership-1',
    ...overrides
  });
  return ownerToInsertRow(plan);
}

function bindingFor(selectedWorker) {
  const identity = {
    contract_name: BINDING_CONTRACT_NAME,
    contract_version: BINDING_CONTRACT_VERSION,
    claim_id: 'claim-ownership-1',
    claim_digest: `sha256:${'1'.repeat(64)}`,
    attempt_durable_record_id: 'attempt-ownership-1',
    runtime_stage_reference_id: 'stage-ownership-1',
    runtime_stage_reference_version: 1,
    selection_id: 'selection-ownership-1',
    selection_digest: `sha256:${'2'.repeat(64)}`,
    selected_worker_id: selectedWorker.worker_id,
    selected_worker_digest: selectedWorker.canonical_digest,
    binding_ordinal: 1,
    tenant_id: 'tenant-ownership-1',
    organization_id: 'organization-ownership-1',
    project_id: 'project-ownership-1',
    session_reference_id: 'session-ownership-1',
    agent_id: 'agent-ownership-1',
    actor_id: 'actor-ownership-1'
  };
  const fingerprint = stablePayload(identity);
  const digest = computeCanonicalContentDigest(identity);
  const bindingId = `${BINDING_ID_PREFIX}${digest.slice('sha256:'.length)}`;
  return {
    ...identity,
    binding_id: bindingId,
    binding_fingerprint: fingerprint,
    binding_digest: digest,
    binding_artifact: {
      contract_name: BINDING_CONTRACT_NAME,
      contract_version: BINDING_CONTRACT_VERSION,
      binding_id: bindingId,
      claim_id: identity.claim_id,
      selection_id: identity.selection_id,
      runtime_stage_reference_id: identity.runtime_stage_reference_id,
      selected_worker_id: identity.selected_worker_id,
      binding_digest: digest,
      worker_selected: true,
      worker_bound: true,
      worker_ownership_established: false,
      executor_bound: false,
      executor_ownership_established: false,
      capacity_reserved: false,
      lease_created: false,
      lease_granted: false,
      fencing_token_created: false,
      fencing_token_issued: false,
      execution_authorized: false,
      execution_started: false,
      execution_performed: false,
      binding_grants_ownership: false,
      binding_reserves_capacity: false,
      binding_creates_lease: false,
      binding_creates_fencing: false,
      binding_authorizes_execution: false,
      simulation: false,
      production_blocked: true
    },
    created_at: '2026-09-02T00:00:00.000Z'
  };
}

function inputs(overrides = {}) {
  const canonicalWorker = worker(overrides.worker);
  return {
    binding: bindingFor(canonicalWorker),
    owner: owner(overrides.owner),
    worker: canonicalWorker,
    ownership_ordinal: overrides.ownership_ordinal
  };
}

function persisted(plan, createdAt = '2026-09-02T00:00:00.000Z') {
  return { ...planToInsertRow(plan), created_at: createdAt };
}

test('P14A builds deterministic ownership identity and excludes timestamps', () => {
  const first = buildOwnershipPlan(inputs());
  const second = buildOwnershipPlan(inputs());
  assert.equal(first.outcome, 'READY');
  assert.equal(first.ownership_id, second.ownership_id);
  assert.equal(first.ownership_fingerprint, second.ownership_fingerprint);
  assert.equal(first.ownership_digest, second.ownership_digest);
  assert.equal(first.identity.created_at, undefined);
  assert.equal(buildOwnershipPlan({ ...inputs(), ownership_ordinal: 1 }).ownership_id, first.ownership_id);
  assert.notEqual(buildOwnershipPlan({ ...inputs(), ownership_ordinal: 2 }).ownership_id, first.ownership_id);
});

test('P14A creates immutable ownership artifact with explicit later-layer boundaries', () => {
  const plan = buildOwnershipPlan(inputs());
  assert.equal(plan.outcome, 'READY');
  assert.equal(validatePersistedOwnership(persisted(plan)).valid, true);
  assert.deepEqual(Object.keys(planToInsertRow(plan)).sort(), FIELDS.filter((field) => field !== 'created_at').sort());
  for (const [field, expected] of Object.entries(SAFE_FLAGS)) assert.equal(plan[field], expected, field);
  for (const forbidden of ['owner_id', 'lease_id', 'expires_at', 'heartbeat', 'fencing_token', 'capacity', 'execution_status', 'execution_authority']) {
    assert.equal(Object.hasOwn(plan.ownership_artifact, forbidden), false, forbidden);
  }
});

test('P14A fails closed for invalid predecessors, owner types, scope and ordinal', () => {
  const valid = inputs();
  for (const invalid of [
    { binding: null },
    { owner: null },
    { worker: null },
    { owner: { ...valid.owner, operational_owner_type: 'unknown' } },
    { owner: { ...valid.owner, owner_reference_id: '' } },
    { owner: { ...valid.owner, tenant_id: 'other-tenant' } },
    { owner: { ...valid.owner, organization_id: 'other-organization' } },
    { owner: { ...valid.owner, project_id: 'other-project' } },
    { worker: worker({ worker_id: 'other-worker' }) },
    { ownership_ordinal: 0 },
    { ownership_ordinal: 1.5 }
  ]) {
    const result = buildOwnershipPlan({ ...valid, ...invalid });
    assert.equal(result.outcome, 'INVALID');
  }
});

test('P14A rejects tampered binding, owner and worker identities', () => {
  const valid = inputs();
  const bindingTampered = { ...valid.binding, binding_digest: `sha256:${'f'.repeat(64)}` };
  assert.equal(buildOwnershipPlan({ ...valid, binding: bindingTampered }).outcome, 'INVALID');
  const ownerTampered = { ...valid.owner, owner_identity_digest: `sha256:${'f'.repeat(64)}` };
  assert.equal(buildOwnershipPlan({ ...valid, owner: ownerTampered }).outcome, 'INVALID');
  const workerTampered = { ...valid.worker, canonical_digest: `sha256:${'f'.repeat(64)}` };
  assert.equal(buildOwnershipPlan({ ...valid, worker: workerTampered }).outcome, 'INVALID');
});

test('P14A classifies replay and divergent owner in the same slot without overwrite', () => {
  const first = buildOwnershipPlan(inputs());
  const replay = classifyPersistedOwnership(persisted(first), first);
  assert.equal(replay.outcome, 'EXISTING_IDENTICAL');
  const divergent = buildOwnershipPlan({ ...inputs(), owner: owner({ owner_reference_id: 'owner-reference-2' }) });
  assert.equal(classifyPersistedOwnership(persisted(first), divergent).outcome, 'CONFLICT');
  assert.equal(first.ownership_id === divergent.ownership_id, false);
});

test('P14A detects persisted artifact, fingerprint and digest tampering', () => {
  const plan = buildOwnershipPlan(inputs());
  const artifact = JSON.parse(JSON.stringify(persisted(plan)));
  artifact.ownership_artifact.production_blocked = false;
  assert.equal(validatePersistedOwnership(artifact).valid, false);
  const fingerprint = JSON.parse(JSON.stringify(persisted(plan)));
  fingerprint.ownership_fingerprint = 'tampered';
  assert.equal(validatePersistedOwnership(fingerprint).valid, false);
  const digest = JSON.parse(JSON.stringify(persisted(plan)));
  digest.ownership_digest = `sha256:${'f'.repeat(64)}`;
  assert.equal(validatePersistedOwnership(digest).valid, false);
});

test('P14A does not mutate predecessor objects or establish later authority', () => {
  const valid = inputs();
  const before = JSON.stringify(valid);
  const plan = buildOwnershipPlan(valid);
  assert.equal(JSON.stringify(valid), before);
  assert.equal(plan.worker_ownership_established, true);
  assert.equal(plan.lease_created, false);
  assert.equal(plan.fencing_token_created, false);
  assert.equal(plan.capacity_reserved, false);
  assert.equal(plan.execution_authorized, false);
  assert.equal(plan.production_blocked, true);
});
