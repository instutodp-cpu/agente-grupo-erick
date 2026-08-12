'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildHermesVpsBootstrapContract } = require('../src/core/hermes-vps-bootstrap-contract');
const { buildHermesVpsProvisioningPlan } = require('../src/core/hermes-vps-provisioning-plan');
const {
  AUTHORIZATION_STATES,
  buildHermesVpsExecutionAuthorization,
  computeAuthorizationBindingHash,
  computeAuthorizationHash,
  evaluateHermesVpsExecutionAuthorization,
  validateHermesVpsExecutionAuthorizationContract
} = require('../src/core/hermes-vps-execution-authorization-contract');

const provenance = {
  repository: 'instutodp-cpu/agente-grupo-erick',
  branch: 'hermes/vps-execution-authorization-contract-v1',
  commit_sha: 'dd19e79c01a6360f154c622fdb6b21ee1eb5667a'
};
const bootstrap = buildHermesVpsBootstrapContract({ provenance });
const provisioningPlan = buildHermesVpsProvisioningPlan({ bootstrap_contract: bootstrap });

function authorization(overrides = {}) {
  return buildHermesVpsExecutionAuthorization({
    provisioning_plan: provisioningPlan,
    authorization_id: 'vps-auth-test-001',
    issued_at: '2026-08-12T10:00:00.000Z',
    expires_at: '2026-08-12T10:05:00.000Z',
    issued_by: { authority_id: 'owner-1', authority_type: 'human_owner' },
    target_id: 'approved-staging-host-reference',
    phase_ids: ['P0_HOST_VALIDATION', 'P1_BASE_OS_PREPARATION'],
    step_ids: ['validate_host', 'prepare_os_baseline'],
    provenance,
    ...overrides
  });
}

test('missing authorization denies', () => assert.equal(evaluateHermesVpsExecutionAuthorization(null).status, 'NOT_AUTHORIZED'));
test('explicitly valid authorization allows only at contract level', () => assert.deepEqual(evaluateHermesVpsExecutionAuthorization(authorization(), { provisioning_plan: provisioningPlan, now: '2026-08-12T10:01:00.000Z' }), { status: 'AUTHORIZED', execution_authorized: true, reason: 'authorization_valid' }));
test('plan hash mismatch denies', () => assert.equal(evaluateHermesVpsExecutionAuthorization(authorization(), { provisioning_plan: { plan_version: provisioningPlan.plan_version, plan_hash: 'sha256:' + 'f'.repeat(64) }, now: '2026-08-12T10:01:00.000Z' }).status, 'PLAN_MISMATCH'));
test('plan reference mismatch denies', () => {
  const value = { ...authorization(), provisioning_plan_reference: { ...authorization().provisioning_plan_reference, plan_version: 'other-plan' } };
  assert.equal(evaluateHermesVpsExecutionAuthorization(value, { provisioning_plan: provisioningPlan, now: '2026-08-12T10:01:00.000Z' }).status, 'INVALID');
});
test('invalid authorization ID denies', () => assert.equal(validateHermesVpsExecutionAuthorizationContract({ ...authorization(), authorization_id: '' }).valid, false));
test('unknown state denies', () => assert.equal(validateHermesVpsExecutionAuthorizationContract({ ...authorization(), authorization_state: 'UNKNOWN' }).valid, false));
test('expired authorization denies', () => assert.equal(evaluateHermesVpsExecutionAuthorization(authorization(), { provisioning_plan: provisioningPlan, now: '2026-08-12T10:06:00.000Z' }).status, 'EXPIRED'));
test('revoked authorization denies', () => {
  const value = authorization();
  const revoked = { ...value, revocation: { state: 'REVOKED', reference: 'revocation-1' } };
  revoked.authorization_hash = computeAuthorizationHash(revoked);
  assert.equal(evaluateHermesVpsExecutionAuthorization(revoked, { now: '2026-08-12T10:01:00.000Z' }).status, 'REVOKED');
});
test('consumed single-use authorization denies', () => {
  const value = authorization();
  const consumed = { ...value, consumption: { state: 'CONSUMED', reference: 'consumption-1' } };
  consumed.authorization_hash = computeAuthorizationHash(consumed);
  assert.equal(evaluateHermesVpsExecutionAuthorization(consumed, { now: '2026-08-12T10:01:00.000Z' }).status, 'ALREADY_CONSUMED');
});
test('authorization for plan A cannot authorize plan B', () => {
  const otherPlan = buildHermesVpsProvisioningPlan({ bootstrap_contract: buildHermesVpsBootstrapContract({ provenance, architecture: 'arm64' }) });
  assert.equal(evaluateHermesVpsExecutionAuthorization(authorization(), { provisioning_plan: otherPlan, now: '2026-08-12T10:01:00.000Z' }).status, 'PLAN_MISMATCH');
});
test('canonical binding is deterministic', () => assert.equal(computeAuthorizationBindingHash(authorization()), computeAuthorizationBindingHash(JSON.parse(JSON.stringify(authorization())))));
test('material scope change alters binding hash', () => {
  const value = authorization();
  const changed = { ...value, target_reference: { ...value.target_reference, target_id: 'other-host' } };
  assert.notEqual(computeAuthorizationBindingHash(changed), computeAuthorizationBindingHash(value));
});
test('lifecycle state does not change immutable plan binding', () => {
  const value = authorization();
  assert.equal(computeAuthorizationBindingHash({ ...value, authorization_state: 'EXPIRED' }), computeAuthorizationBindingHash(value));
});
test('secrets are absent from canonical material', () => assert.equal(JSON.stringify(authorization()).match(/secret|token|password|private_key|api_key/i), null));
test('authorization contract does not expose operational execution calls', () => assert.equal(typeof require('../src/core/hermes-vps-execution-authorization-contract').execute, 'undefined'));
test('provider/network/shell/production scope is always denied', () => {
  const value = authorization();
  assert.equal(value.execution_scope.provider_allowed, false);
  assert.equal(value.execution_scope.network_allowed, false);
  assert.equal(value.execution_scope.shell_allowed, false);
  assert.equal(value.execution_scope.production_allowed, false);
});
test('all authorization states are explicit and finite', () => assert.deepEqual(AUTHORIZATION_STATES, ['NOT_AUTHORIZED', 'AUTHORIZED', 'EXPIRED', 'REVOKED', 'ALREADY_CONSUMED', 'PLAN_MISMATCH', 'INVALID']));
test('replay reference denies without mutation', () => assert.equal(evaluateHermesVpsExecutionAuthorization(authorization(), { provisioning_plan: provisioningPlan, now: '2026-08-12T10:01:00.000Z', consumed_authorization_ids: ['vps-auth-test-001'] }).status, 'ALREADY_CONSUMED'));
test('missing current time denies closed', () => assert.equal(evaluateHermesVpsExecutionAuthorization(authorization()).status, 'INVALID'));
test('production and real execution flags cannot be enabled', () => {
  const value = authorization();
  assert.equal(validateHermesVpsExecutionAuthorizationContract({ ...value, execution_scope: { ...value.execution_scope, production_allowed: true }, authorization_hash: 'pending' }).valid, false);
});
