'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { stablePayload } = require('../src/core/agent-identity-contract');
const { computeCanonicalContentDigest } = require('../src/core/canonical-content-digest');
const { buildOperationalOwnerIdentity, planToInsertRow: ownerToInsertRow } = require('../src/core/runtime-operational-owner-identity');
const { buildWorkerRegistration } = require('../src/core/runtime-worker-registry-contract');
const {
  CONTRACT_NAME: OWNERSHIP_CONTRACT_NAME,
  CONTRACT_VERSION: OWNERSHIP_CONTRACT_VERSION,
  buildOwnershipPlan,
  planToInsertRow: ownershipToInsertRow
} = require('../src/core/runtime-execution-attempt-worker-ownership');
const {
  CONTRACT_NAME,
  CONTRACT_VERSION,
  FIELDS,
  SAFE_FLAGS,
  buildLeasePlan,
  classifyPersistedLease,
  planToInsertRow,
  validatePersistedLease,
  validDuration
} = require('../src/core/runtime-execution-attempt-worker-lease');

function worker(overrides = {}) {
  return buildWorkerRegistration({
    worker_id: 'worker-lease-a',
    tenant_id: 'tenant-lease-1',
    organization_id: 'organization-lease-1',
    project_id: 'project-lease-1',
    worker_type: 'DEDICATED_REFERENCE',
    lifecycle_state: 'ACTIVE',
    worker_capability_reference_id: 'capability-lease-1',
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
  return ownerToInsertRow(buildOperationalOwnerIdentity({
    operational_owner_type: 'operational_owner',
    owner_reference_id: 'owner-lease-1',
    tenant_id: 'tenant-lease-1',
    organization_id: 'organization-lease-1',
    project_id: 'project-lease-1',
    ...overrides
  }));
}

function bindingFor(selectedWorker) {
  const identity = {
    contract_name: 'RUNTIME_EXECUTION_ATTEMPT_CLAIM_WORKER_BINDING_AUTHORITY',
    contract_version: 'runtime_execution_attempt_claim_worker_binding_authority_contract_v1',
    claim_id: 'claim-lease-1',
    claim_digest: `sha256:${'1'.repeat(64)}`,
    attempt_durable_record_id: 'attempt-lease-1',
    runtime_stage_reference_id: 'stage-lease-1',
    runtime_stage_reference_version: 1,
    selection_id: 'selection-lease-1',
    selection_digest: `sha256:${'2'.repeat(64)}`,
    selected_worker_id: selectedWorker.worker_id,
    selected_worker_digest: selectedWorker.canonical_digest,
    binding_ordinal: 1,
    tenant_id: 'tenant-lease-1',
    organization_id: 'organization-lease-1',
    project_id: 'project-lease-1',
    session_reference_id: 'session-lease-1',
    agent_id: 'agent-lease-1',
    actor_id: 'actor-lease-1'
  };
  const fingerprint = stablePayload(identity);
  const digest = computeCanonicalContentDigest(identity);
  const bindingId = `runtime-execution-attempt-claim-worker-binding-${digest.slice('sha256:'.length)}`;
  return {
    ...identity,
    binding_id: bindingId,
    binding_fingerprint: fingerprint,
    binding_digest: digest,
    binding_artifact: {
      contract_name: identity.contract_name,
      contract_version: identity.contract_version,
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
    }
  };
}

function inputs(overrides = {}) {
  const canonicalWorker = worker(overrides.worker);
  const binding = bindingFor(canonicalWorker);
  const ownershipPlan = buildOwnershipPlan({
    binding,
    owner: owner(overrides.owner),
    worker: canonicalWorker,
    ownership_ordinal: 1
  });
  assert.equal(ownershipPlan.outcome, 'READY');
  return {
    ownership: { ...ownershipToInsertRow(ownershipPlan), created_at: '2026-09-02T00:00:00.000Z' },
    owner: owner(overrides.owner),
    worker: canonicalWorker,
    lease_ordinal: overrides.lease_ordinal
  };
}

function persisted(plan, overrides = {}) {
  return {
    ...planToInsertRow(plan),
    lease_expires_at: '2099-01-01T00:00:00.000Z',
    created_at: '2026-09-02T00:00:00.000Z',
    updated_at: '2026-09-02T00:00:00.000Z',
    ...overrides
  };
}

test('P14B builds deterministic lease identity and excludes lifecycle timestamps', () => {
  const first = buildLeasePlan(inputs());
  const second = buildLeasePlan(inputs());
  assert.equal(first.outcome, 'READY');
  assert.equal(first.lease_id, second.lease_id);
  assert.equal(first.lease_fingerprint, second.lease_fingerprint);
  assert.equal(first.lease_digest, second.lease_digest);
  assert.equal(first.fencing_token, 1);
  assert.equal(first.identity.lease_expires_at, undefined);
  assert.notEqual(buildLeasePlan({ ...inputs(), lease_ordinal: 2 }).lease_id, first.lease_id);
});

test('P14B creates lease/fencing artifact without execution authority', () => {
  const plan = buildLeasePlan(inputs());
  assert.equal(plan.outcome, 'READY');
  assert.equal(validatePersistedLease(persisted(plan)).valid, true);
  assert.deepEqual(Object.keys(planToInsertRow(plan)).sort(), FIELDS.filter((field) => ![
    'lease_expires_at', 'last_renewed_at', 'released_at', 'created_at', 'updated_at'
  ].includes(field)).sort());
  for (const [field, expected] of Object.entries(SAFE_FLAGS)) assert.equal(plan[field], expected, field);
  for (const forbidden of ['executor_id', 'capacity', 'quota', 'execution_status', 'execution_authority']) {
    assert.equal(Object.hasOwn(plan.lease_artifact, forbidden), false, forbidden);
  }
});

test('P14B validates ownership, owner, worker, scope, ordinal and duration fail-closed', () => {
  const valid = inputs();
  for (const invalid of [
    { ownership: null },
    { owner: null },
    { worker: null },
    { owner: owner({ tenant_id: 'other-tenant' }) },
    { worker: worker({ worker_id: 'other-worker' }) },
    { lease_ordinal: 0 },
    { lease_ordinal: 1.5 }
  ]) {
    assert.equal(buildLeasePlan({ ...valid, ...invalid }).outcome, 'INVALID');
  }
  assert.equal(validDuration(1), true);
  assert.equal(validDuration(0), false);
  assert.equal(validDuration(86_400_001), false);
});

test('P14B rejects tampered ownership, owner and worker identities', () => {
  const valid = inputs();
  assert.equal(buildLeasePlan({ ...valid, ownership: { ...valid.ownership, ownership_digest: `sha256:${'f'.repeat(64)}` } }).outcome, 'INVALID');
  assert.equal(buildLeasePlan({ ...valid, owner: { ...valid.owner, owner_identity_digest: `sha256:${'f'.repeat(64)}` } }).outcome, 'INVALID');
  assert.equal(buildLeasePlan({ ...valid, worker: { ...valid.worker, canonical_digest: `sha256:${'f'.repeat(64)}` } }).outcome, 'INVALID');
});

test('P14B classifies identical replay and divergent owner in one lease slot', () => {
  const first = buildLeasePlan(inputs());
  assert.equal(classifyPersistedLease(persisted(first), first).outcome, 'EXISTING_IDENTICAL');
  const divergent = buildLeasePlan({ ...inputs(), owner: owner({ owner_reference_id: 'owner-lease-2' }) });
  assert.equal(classifyPersistedLease(persisted(first), divergent).outcome, 'CONFLICT');
});

test('P14B detects persisted lease artifact, fingerprint and digest tampering', () => {
  const plan = buildLeasePlan(inputs());
  const artifact = persisted(plan, {
    lease_artifact: { ...plan.lease_artifact, production_blocked: false }
  });
  assert.equal(validatePersistedLease(artifact).valid, false);
  const fingerprint = persisted(plan, { lease_fingerprint: 'tampered' });
  assert.equal(validatePersistedLease(fingerprint).valid, false);
  const digest = persisted(plan, { lease_digest: `sha256:${'f'.repeat(64)}` });
  assert.equal(validatePersistedLease(digest).valid, false);
});

test('P14B keeps stale-token and execution boundaries explicit', () => {
  const plan = buildLeasePlan(inputs());
  assert.equal(plan.lease_created, true);
  assert.equal(plan.lease_granted, true);
  assert.equal(plan.liveness_established, true);
  assert.equal(plan.fencing_token_created, true);
  assert.equal(plan.fencing_token_issued, true);
  assert.equal(plan.execution_authorized, false);
  assert.equal(plan.execution_started, false);
  assert.equal(plan.execution_performed, false);
  assert.equal(plan.production_blocked, true);
  assert.equal(Object.hasOwn(plan, 'takeover'), false);
  assert.equal(Object.hasOwn(plan, 'reclaim'), false);
});

test('P14B does not mutate the P14A predecessor', () => {
  const valid = inputs();
  const before = JSON.stringify(valid.ownership);
  buildLeasePlan(valid);
  assert.equal(JSON.stringify(valid.ownership), before);
  assert.equal(OWNERSHIP_CONTRACT_NAME, 'RUNTIME_EXECUTION_ATTEMPT_WORKER_OWNERSHIP_AUTHORITY');
  assert.equal(OWNERSHIP_CONTRACT_VERSION, 'runtime_execution_attempt_worker_ownership_authority_contract_v1');
  assert.equal(fs.existsSync(path.resolve(__dirname, '../../../migrations/hermes/013_create_runtime_execution_attempt_worker_ownerships.sql')), true);
});
