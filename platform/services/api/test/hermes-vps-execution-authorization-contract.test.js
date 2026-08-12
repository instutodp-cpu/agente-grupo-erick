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

function evaluationContext(overrides = {}) {
  return {
    provisioning_plan: provisioningPlan,
    execution_scope: { phase_id: 'P0_HOST_VALIDATION', step_id: 'validate_host' },
    now: '2026-08-12T10:01:00.000Z',
    ...overrides
  };
}

test('missing authorization denies', () => assert.equal(evaluateHermesVpsExecutionAuthorization(null).status, 'NOT_AUTHORIZED'));
test('explicitly valid authorization allows only at contract level', () => assert.deepEqual(evaluateHermesVpsExecutionAuthorization(authorization(), evaluationContext()), { status: 'AUTHORIZED', execution_authorized: true, reason: 'authorization_valid' }));
test('plan hash mismatch denies', () => assert.equal(evaluateHermesVpsExecutionAuthorization(authorization(), evaluationContext({ provisioning_plan: { plan_version: provisioningPlan.plan_version, plan_hash: 'sha256:' + 'f'.repeat(64) } })).status, 'INVALID'));
test('plan reference mismatch denies', () => {
  const value = { ...authorization(), provisioning_plan_reference: { ...authorization().provisioning_plan_reference, plan_version: 'other-plan' } };
  assert.equal(evaluateHermesVpsExecutionAuthorization(value, evaluationContext()).status, 'INVALID');
});
test('invalid authorization ID denies', () => assert.equal(validateHermesVpsExecutionAuthorizationContract({ ...authorization(), authorization_id: '' }).valid, false));
test('unknown state denies', () => assert.equal(validateHermesVpsExecutionAuthorizationContract({ ...authorization(), authorization_state: 'UNKNOWN' }).valid, false));
test('expired authorization denies', () => assert.equal(evaluateHermesVpsExecutionAuthorization(authorization(), evaluationContext({ now: '2026-08-12T10:06:00.000Z' })).status, 'EXPIRED'));
test('revoked authorization denies', () => {
  const value = authorization();
  const revoked = { ...value, revocation: { state: 'REVOKED', reference: { authorization_id: value.authorization_id, reference_id: 'revocation-1' } } };
  revoked.authorization_hash = computeAuthorizationHash(revoked);
  assert.equal(evaluateHermesVpsExecutionAuthorization(revoked, evaluationContext()).status, 'REVOKED');
});
test('consumed single-use authorization denies', () => {
  const value = authorization();
  const consumed = { ...value, consumption: { state: 'CONSUMED', reference: { authorization_id: value.authorization_id, reference_id: 'consumption-1' } } };
  consumed.authorization_hash = computeAuthorizationHash(consumed);
  assert.equal(evaluateHermesVpsExecutionAuthorization(consumed, evaluationContext()).status, 'ALREADY_CONSUMED');
});
test('authorization for plan A cannot authorize plan B', () => {
  const otherPlan = buildHermesVpsProvisioningPlan({ bootstrap_contract: buildHermesVpsBootstrapContract({ provenance, architecture: 'arm64' }) });
  assert.equal(evaluateHermesVpsExecutionAuthorization(authorization(), evaluationContext({ provisioning_plan: otherPlan })).status, 'INVALID');
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
test('replay reference denies without mutation', () => assert.equal(evaluateHermesVpsExecutionAuthorization(authorization(), evaluationContext({ consumption_records: [{ authorization_id: 'vps-auth-test-001', reference_id: 'replay-1' }] })).status, 'ALREADY_CONSUMED'));
test('missing current time denies closed', () => assert.equal(evaluateHermesVpsExecutionAuthorization(authorization(), evaluationContext({ now: undefined })).status, 'INVALID'));
test('phase A step 1 does not authorize phase A step 2', () => assert.equal(evaluateHermesVpsExecutionAuthorization(authorization(), evaluationContext({ execution_scope: { phase_id: 'P0_HOST_VALIDATION', step_id: 'prepare_os_baseline' } })).status, 'PLAN_MISMATCH'));
test('phase A does not authorize phase B', () => assert.equal(evaluateHermesVpsExecutionAuthorization(authorization({ phase_ids: ['P0_HOST_VALIDATION'], step_ids: ['validate_host'] }), evaluationContext({ execution_scope: { phase_id: 'P1_BASE_OS_PREPARATION', step_id: 'prepare_os_baseline' } })).status, 'PLAN_MISMATCH'));
test('missing execution scope denies', () => assert.equal(evaluateHermesVpsExecutionAuthorization(authorization(), evaluationContext({ execution_scope: undefined })).status, 'INVALID'));
test('unknown execution scope denies', () => assert.equal(evaluateHermesVpsExecutionAuthorization(authorization(), evaluationContext({ execution_scope: { phase_id: 'P999', step_id: 'unknown' } })).status, 'PLAN_MISMATCH'));
test('matching execution scope allows', () => assert.equal(evaluateHermesVpsExecutionAuthorization(authorization(), evaluationContext()).status, 'AUTHORIZED'));
test('consumption record for authorization B does not consume authorization A', () => assert.equal(evaluateHermesVpsExecutionAuthorization(authorization(), evaluationContext({ consumption_records: [{ authorization_id: 'authorization-B', reference_id: 'consume-B' }] })).status, 'AUTHORIZED'));
test('revocation record for authorization B does not revoke authorization A', () => assert.equal(evaluateHermesVpsExecutionAuthorization(authorization(), evaluationContext({ revocation_records: [{ authorization_id: 'authorization-B', reference_id: 'revoke-B' }] })).status, 'AUTHORIZED'));
test('matching consumption record consumes authorization A', () => assert.equal(evaluateHermesVpsExecutionAuthorization(authorization(), evaluationContext({ consumption_records: [{ authorization_id: 'vps-auth-test-001', reference_id: 'consume-A' }] })).status, 'ALREADY_CONSUMED'));
test('matching revocation record revokes authorization A', () => assert.equal(evaluateHermesVpsExecutionAuthorization(authorization(), evaluationContext({ revocation_records: [{ authorization_id: 'vps-auth-test-001', reference_id: 'revoke-A' }] })).status, 'REVOKED'));
test('malformed lifecycle record denies', () => assert.equal(evaluateHermesVpsExecutionAuthorization(authorization(), evaluationContext({ consumption_records: [{ authorization_id: 'vps-auth-test-001' }] })).status, 'INVALID'));
test('duplicate lifecycle identity denies', () => assert.equal(evaluateHermesVpsExecutionAuthorization(authorization(), evaluationContext({ revocation_records: [{ authorization_id: 'authorization-B', reference_id: 'r1' }, { authorization_id: 'authorization-B', reference_id: 'r2' }] })).status, 'INVALID'));
test('missing lifecycle identity denies', () => assert.equal(evaluateHermesVpsExecutionAuthorization(authorization(), evaluationContext({ consumption_records: [{ reference_id: 'r1' }] })).status, 'INVALID'));
test('production and real execution flags cannot be enabled', () => {
  const value = authorization();
  assert.equal(validateHermesVpsExecutionAuthorizationContract({ ...value, execution_scope: { ...value.execution_scope, production_allowed: true }, authorization_hash: 'pending' }).valid, false);
});
