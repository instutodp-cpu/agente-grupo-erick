'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildHermesVpsBootstrapContract } = require('../src/core/hermes-vps-bootstrap-contract');
const { buildHermesVpsProvisioningPlan } = require('../src/core/hermes-vps-provisioning-plan');
const { buildHermesVpsExecutionAuthorization } = require('../src/core/hermes-vps-execution-authorization-contract');
const {
  REGISTRY_MODE,
  REGISTRY_VERSION,
  computeLifecycleFingerprint,
  createHermesVpsAuthorizationLifecycleRegistry
} = require('../src/core/hermes-vps-authorization-lifecycle-registry');

const provenance = {
  repository: 'instutodp-cpu/agente-grupo-erick',
  branch: 'hermes/vps-authorization-lifecycle-registry-v1',
  commit_sha: 'f9fa5fe8bfc0ff47c70c8d8b3120a682ae5eef6e'
};
const bootstrap = buildHermesVpsBootstrapContract({ provenance });
const plan = buildHermesVpsProvisioningPlan({ bootstrap_contract: bootstrap });

function authorization(id = 'authorization-A', overrides = {}) {
  return buildHermesVpsExecutionAuthorization({
    provisioning_plan: plan,
    authorization_id: id,
    issued_at: '2026-08-12T10:00:00.000Z',
    expires_at: '2026-08-12T10:05:00.000Z',
    issued_by: { authority_id: 'owner-1', authority_type: 'human_owner' },
    target_id: 'approved-staging-host-reference',
    phase_ids: ['P0_HOST_VALIDATION'],
    step_ids: ['validate_host'],
    provenance,
    ...overrides
  });
}

function context(overrides = {}) {
  return {
    execution_scope: { phase_id: 'P0_HOST_VALIDATION', step_id: 'validate_host' },
    now: '2026-08-12T10:01:00.000Z',
    ...overrides
  };
}

function registered(id = 'authorization-A') {
  const registry = createHermesVpsAuthorizationLifecycleRegistry({ provisioning_plan: plan });
  assert.equal(registry.registerAuthorization(authorization(id)).status, 'REGISTERED');
  return registry;
}

test('registry is in-memory, plan-bound, safe by default, and not durable', () => {
  const registry = createHermesVpsAuthorizationLifecycleRegistry({ provisioning_plan: plan });
  assert.equal(registry.registry_version, REGISTRY_VERSION);
  assert.equal(registry.mode, REGISTRY_MODE);
  assert.equal(registry.logical_atomicity, true);
  assert.equal(registry.durable_distributed_atomicity, false);
});
test('valid logical consume succeeds once', () => assert.equal(registered().consumeAuthorization('authorization-A', context()).status, 'AUTHORIZED'));
test('missing authorization denies', () => assert.equal(registered().consumeAuthorization('missing', context()).status, 'NOT_AUTHORIZED'));
test('duplicate consume and replay are denied', () => {
  const registry = registered();
  assert.equal(registry.consumeAuthorization('authorization-A', context()).status, 'AUTHORIZED');
  assert.equal(registry.consumeAuthorization('authorization-A', context()).status, 'ALREADY_CONSUMED');
});
test('conflicting concurrent consumes have one logical winner', async () => {
  const registry = registered();
  const results = await Promise.all([registry.consumeAuthorization('authorization-A', context()), registry.consumeAuthorization('authorization-A', context())]);
  assert.deepEqual(results.map((result) => result.status).sort(), ['ALREADY_CONSUMED', 'AUTHORIZED']);
});
test('authorization A cannot consume authorization B state', () => {
  const registry = registered('authorization-A');
  assert.equal(registry.consumeAuthorization('authorization-A', context({ authorization_id: 'authorization-B' })).status, 'INVALID');
});
test('revocation is authorization-ID-bound and blocks consume', () => {
  const registry = registered('authorization-A');
  assert.equal(registry.revokeAuthorization('authorization-A', 'revoke-A').status, 'REVOKED');
  assert.equal(registry.consumeAuthorization('authorization-A', context()).status, 'REVOKED');
});
test('revoking authorization B does not revoke authorization A', () => {
  const registry = registered('authorization-A');
  assert.equal(registry.revokeAuthorization('authorization-B').status, 'NOT_AUTHORIZED');
  assert.equal(registry.consumeAuthorization('authorization-A', context()).status, 'AUTHORIZED');
});
test('revoke already consumed authorization is denied', () => {
  const registry = registered();
  registry.consumeAuthorization('authorization-A', context());
  assert.equal(registry.revokeAuthorization('authorization-A').status, 'ALREADY_CONSUMED');
});
test('expired authorization denies', () => {
  const registry = registered();
  assert.equal(registry.consumeAuthorization('authorization-A', context({ now: '2026-08-12T10:06:00.000Z' })).status, 'EXPIRED');
});
test('malformed expiration is rejected at registration', () => {
  assert.equal(registered().consumeAuthorization('authorization-A', context({ now: 'not-a-time' })).status, 'INVALID');
});
test('plan version and hash mismatches deny', () => {
  const registry = registered();
  assert.equal(registry.consumeAuthorization('authorization-A', context({ provisioning_plan_hash: 'sha256:' + 'f'.repeat(64) })).status, 'PLAN_MISMATCH');
});
test('execution scope mismatches deny', () => {
  const registry = registered();
  assert.equal(registry.consumeAuthorization('authorization-A', context({ execution_scope: { phase_id: 'P1_BASE_OS_PREPARATION', step_id: 'prepare_os_baseline' } })).status, 'SCOPE_MISMATCH');
  assert.equal(registry.consumeAuthorization('authorization-A', context({ execution_scope: { phase_id: 'P0_HOST_VALIDATION', step_id: 'missing' } })).status, 'SCOPE_MISMATCH');
  assert.equal(registry.consumeAuthorization('authorization-A', context({ execution_scope: undefined })).status, 'INVALID');
});
test('unknown lifecycle state and malformed authorization are rejected', () => {
  const registry = createHermesVpsAuthorizationLifecycleRegistry({ provisioning_plan: plan });
  assert.equal(registry.registerAuthorization({ authorization_id: 'x', authorization_state: 'UNKNOWN' }).status, 'INVALID');
});
test('authorization ID reuse with different material is rejected', () => {
  const registry = registered();
  const changed = authorization('authorization-A', { target_id: 'other-host' });
  assert.equal(registry.registerAuthorization(changed).status, 'CONFLICT');
});
test('retry after simulated crash preserves consumed state only through explicit logical snapshot', () => {
  const registry = registered();
  registry.consumeAuthorization('authorization-A', context());
  const snapshot = registry.exportLogicalSnapshot();
  const recovered = createHermesVpsAuthorizationLifecycleRegistry({ provisioning_plan: plan });
  assert.equal(recovered.restoreLogicalSnapshot(snapshot).status, 'RESTORED_IN_MEMORY_SNAPSHOT');
  assert.equal(recovered.consumeAuthorization('authorization-A', context()).status, 'ALREADY_CONSUMED');
});
test('malformed or ambiguous snapshot fails closed', () => {
  const registry = registered();
  const snapshot = registry.exportLogicalSnapshot();
  assert.equal(registry.restoreLogicalSnapshot({ ...snapshot, snapshot_hash: 'sha256:' + '0'.repeat(64) }).status, 'INVALID');
  assert.equal(registry.restoreLogicalSnapshot({ ...snapshot, entries: [...snapshot.entries, snapshot.entries[0]] }).status, 'INVALID');
  const unknownState = { ...snapshot, entries: snapshot.entries.map((entry) => ({ ...entry, state: 'UNKNOWN' })) };
  assert.equal(registry.restoreLogicalSnapshot(unknownState).status, 'INVALID');
});
test('receipts and fingerprints are deterministic and mutation-sensitive', () => {
  const first = registered();
  const second = registered();
  const firstResult = first.consumeAuthorization('authorization-A', context({ reference_id: 'consume-A' }));
  const secondResult = second.consumeAuthorization('authorization-A', context({ reference_id: 'consume-A' }));
  assert.deepEqual(firstResult.receipt, secondResult.receipt);
  assert.notEqual(firstResult.receipt.receipt_hash, first.consumeAuthorization('authorization-A', context()).receipt?.receipt_hash);
  assert.notEqual(computeLifecycleFingerprint({
    ...first.exportLogicalSnapshot().entries[0],
    state: 'REGISTERED',
    fingerprint: 'pending'
  }), firstResult.receipt.fingerprint);
});
test('registry exposes no operational execution entry points', () => {
  const registry = registered();
  assert.equal(typeof registry.execute, 'undefined');
  assert.equal(typeof registry.provision, 'undefined');
  assert.equal(typeof registry.callProvider, 'undefined');
});
test('registry material contains no secret values', () => {
  const registry = registered();
  const text = JSON.stringify(registry.exportLogicalSnapshot());
  assert.equal(/password|token|api[_-]?key|private[_-]?key|cookie/i.test(text), false);
});
