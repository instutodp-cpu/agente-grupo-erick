'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildHermesVpsBootstrapContract } = require('../src/core/hermes-vps-bootstrap-contract');
const { buildHermesVpsProvisioningPlan } = require('../src/core/hermes-vps-provisioning-plan');
const { buildHermesVpsExecutionAuthorization } = require('../src/core/hermes-vps-execution-authorization-contract');
const {
  createDeterministicDurableLifecycleTestStore,
  createHermesVpsDurableAuthorizationLifecycleRegistry
} = require('../src/core/hermes-vps-durable-authorization-lifecycle-registry');

const provenance = { repository: 'instutodp-cpu/agente-grupo-erick', branch: 'hermes/vps-durable-authorization-lifecycle-registry-v1', commit_sha: 'a815b28f425de85bc9abbb518f458ab984b6310e' };
const bootstrap = buildHermesVpsBootstrapContract({ provenance });
const plan = buildHermesVpsProvisioningPlan({ bootstrap_contract: bootstrap });

function authorization(id = 'authorization-A', overrides = {}) {
  return buildHermesVpsExecutionAuthorization({
    provisioning_plan: plan, authorization_id: id, issued_at: '2026-08-12T10:00:00.000Z', expires_at: '2026-08-12T10:05:00.000Z',
    issued_by: { authority_id: 'owner-1', authority_type: 'human_owner' }, target_id: 'approved-staging-host-reference',
    phase_ids: ['P0_HOST_VALIDATION'], step_ids: ['validate_host'], provenance, ...overrides
  });
}
function context(overrides = {}) { return { execution_scope: { phase_id: 'P0_HOST_VALIDATION', step_id: 'validate_host' }, now: '2026-08-12T10:01:00.000Z', ...overrides }; }
function setup(id = 'authorization-A') {
  const store = createDeterministicDurableLifecycleTestStore();
  const registry = createHermesVpsDurableAuthorizationLifecycleRegistry({ provisioning_plan: plan, persistence: store });
  assert.equal(registry.registerAuthorization(authorization(id)).status, 'REGISTERED');
  return { store, registry };
}

test('valid durable-contract consume persists and survives a new registry instance', () => {
  const { store, registry } = setup();
  assert.equal(registry.consumeAuthorization('authorization-A', context()).status, 'AUTHORIZED');
  const recovered = createHermesVpsDurableAuthorizationLifecycleRegistry({ provisioning_plan: plan, persistence: store });
  assert.equal(recovered.consumeAuthorization('authorization-A', context()).status, 'ALREADY_CONSUMED');
});
test('missing authorization denies', () => assert.equal(setup().registry.consumeAuthorization('missing', context()).status, 'NOT_AUTHORIZED'));
test('duplicate consume and replay are denied', () => { const { registry } = setup(); registry.consumeAuthorization('authorization-A', context()); assert.equal(registry.consumeAuthorization('authorization-A', context()).status, 'ALREADY_CONSUMED'); });
test('conflicting concurrency has exactly one winner', async () => { const { registry } = setup(); const results = await Promise.all([registry.consumeAuthorization('authorization-A', context()), registry.consumeAuthorization('authorization-A', context())]); assert.deepEqual(results.map((x) => x.status).sort(), ['ALREADY_CONSUMED', 'AUTHORIZED']); });
test('wrong authorization ID cannot consume another entry', () => { const { registry } = setup(); assert.equal(registry.consumeAuthorization('authorization-B', context({ authorization_id: 'authorization-A' })).status, 'NOT_AUTHORIZED'); });
test('expired authorization denies', () => assert.equal(setup().registry.consumeAuthorization('authorization-A', context({ now: '2026-08-12T10:06:00.000Z' })).status, 'EXPIRED'));
test('revocation is durable-contract and authorization-ID-bound', () => { const { store, registry } = setup(); assert.equal(registry.revokeAuthorization('authorization-A', 'revoke-A').status, 'REVOKED'); const recovered = createHermesVpsDurableAuthorizationLifecycleRegistry({ provisioning_plan: plan, persistence: store }); assert.equal(recovered.consumeAuthorization('authorization-A', context()).status, 'REVOKED'); });
test('revoking/consuming another authorization does not cross ownership', () => { const { registry } = setup('authorization-A'); assert.equal(registry.revokeAuthorization('authorization-B', 'revoke-B').status, 'NOT_AUTHORIZED'); assert.equal(registry.consumeAuthorization('authorization-A', context()).status, 'AUTHORIZED'); });
test('revoke after consume is denied', () => { const { registry } = setup(); registry.consumeAuthorization('authorization-A', context()); assert.equal(registry.revokeAuthorization('authorization-A', 'revoke-A').status, 'ALREADY_CONSUMED'); });
test('plan and scope mismatches deny', () => { const { registry } = setup(); assert.equal(registry.consumeAuthorization('authorization-A', context({ provisioning_plan_hash: 'sha256:' + 'f'.repeat(64) })).status, 'PLAN_MISMATCH'); assert.equal(registry.consumeAuthorization('authorization-A', context({ execution_scope: { phase_id: 'P1_BASE_OS_PREPARATION', step_id: 'prepare_os_baseline' } })).status, 'SCOPE_MISMATCH'); });
test('malformed and unknown persisted state deny', () => { const { store, registry } = setup(); const entry = store.inspect('authorization-A'); store.compareAndConsume('authorization-A', entry.fingerprint, { ...entry, state: 'UNKNOWN', fingerprint: entry.fingerprint }); assert.equal(registry.consumeAuthorization('authorization-A', context()).status, 'INVALID'); });
test('persistence read failure denies', () => { const { store, registry } = setup(); store.configureFailure('READ_FAILED'); assert.equal(registry.consumeAuthorization('authorization-A', context()).status, 'READ_FAILED'); });
test('persistence atomic write failure denies without claiming consume', () => { const { store, registry } = setup(); store.configureFailure('ATOMICITY_FAILED'); assert.equal(registry.consumeAuthorization('authorization-A', context()).status, 'ATOMICITY_FAILED'); assert.equal(store.inspect('authorization-A').state, 'REGISTERED'); });
test('acknowledged consume with lost response is recoverable and retry is denied', () => { const { store, registry } = setup(); store.configureLostResponseAfterCommit(); assert.equal(registry.consumeAuthorization('authorization-A', context({ reference_id: 'consume-A' })).status, 'WRITE_FAILED'); const retry = createHermesVpsDurableAuthorizationLifecycleRegistry({ provisioning_plan: plan, persistence: store }); assert.equal(retry.consumeAuthorization('authorization-A', context({ reference_id: 'consume-A' })).status, 'ALREADY_CONSUMED'); });
test('conflicting retry cannot create a second authorization', () => { const { registry } = setup(); assert.equal(registry.registerAuthorization(authorization('authorization-A')).status, 'REPLAY_ACCEPTED'); assert.equal(registry.registerAuthorization(authorization('authorization-A', { target_id: 'other' })).status, 'CONFLICT'); });
test('deterministic receipt is stable and states are not execution', () => { const a = setup().registry.consumeAuthorization('authorization-A', context({ reference_id: 'consume-A' })); const b = setup().registry.consumeAuthorization('authorization-A', context({ reference_id: 'consume-A' })); assert.deepEqual(a.receipt, b.receipt); assert.equal(a.receipt.execution_performed, false); assert.equal(a.receipt.production_effect, 'ZERO'); });
test('no secrets are persisted or exposed in receipts', () => { const { store, registry } = setup(); const consume = registry.consumeAuthorization('authorization-A', context()); const text = JSON.stringify({ entry: store.inspect('authorization-A'), receipt: consume.receipt }); assert.equal(/password|token|api[_-]?key|private[_-]?key|cookie/i.test(text), false); });
test('interface rejects incomplete persistence adapters', () => assert.throws(() => createHermesVpsDurableAuthorizationLifecycleRegistry({ provisioning_plan: plan, persistence: { interface_version: 'wrong' } }), /persistence_interface_invalid/));
test('registration write failure denies', () => { const store = createDeterministicDurableLifecycleTestStore(); store.configureFailure('WRITE_FAILED'); const registry = createHermesVpsDurableAuthorizationLifecycleRegistry({ provisioning_plan: plan, persistence: store }); assert.equal(registry.registerAuthorization(authorization()).status, 'WRITE_FAILED'); });
test('recovery from persisted registered state remains consumable exactly once', () => { const { store } = setup(); const recovered = createHermesVpsDurableAuthorizationLifecycleRegistry({ provisioning_plan: plan, persistence: store }); assert.equal(recovered.consumeAuthorization('authorization-A', context()).status, 'AUTHORIZED'); assert.equal(recovered.consumeAuthorization('authorization-A', context()).status, 'ALREADY_CONSUMED'); });
