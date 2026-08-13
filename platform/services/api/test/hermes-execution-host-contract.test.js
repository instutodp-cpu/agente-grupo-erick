'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CAPABILITIES,
  buildHermesExecutionHostContract,
  hashContract,
  validateHermesExecutionHostContract
} = require('../src/core/hermes-execution-host-contract');
const { buildHermesVpsBootstrapContract } = require('../src/core/hermes-vps-bootstrap-contract');
const { buildHermesVpsProvisioningPlan } = require('../src/core/hermes-vps-provisioning-plan');
const { buildHermesVpsExecutionAuthorization } = require('../src/core/hermes-vps-execution-authorization-contract');

function valid() { return buildHermesExecutionHostContract(); }
function mutable() { return JSON.parse(JSON.stringify(valid())); }
function errors(value) { return validateHermesExecutionHostContract(value).errors; }

test('V1 is a valid deterministic staging host contract', () => {
  const a = valid();
  const b = valid();
  assert.equal(validateHermesExecutionHostContract(a).valid, true);
  assert.deepEqual(a, b);
  assert.equal(a.contract_fingerprint, hashContract(a));
  assert.equal(a.environment, 'staging');
  assert.equal(a.production_allowed, false);
});

test('production is fail-closed', () => {
  const value = mutable();
  value.environment = 'production';
  value.contract_fingerprint = hashContract(value);
  assert.ok(errors(value).includes('environment_blocked'));
});

test('network is deny by default and only HTTPS 443 is inbound', () => {
  const value = mutable();
  value.network.outbound.default = 'allow';
  value.contract_fingerprint = hashContract(value);
  assert.ok(errors(value).includes('outbound_not_deny_by_default'));
  const inbound = mutable();
  inbound.network.inbound.allowed = ['http_80'];
  inbound.contract_fingerprint = hashContract(inbound);
  assert.ok(errors(inbound).includes('inbound_not_deny_by_default'));
});

test('host presence grants no execution capability', () => {
  const value = mutable();
  assert.deepEqual(Object.keys(value.capabilities).sort(), [...CAPABILITIES].sort());
  assert.deepEqual(Object.values(value.capabilities), CAPABILITIES.map(() => false));
  assert.equal(value.execution.provider_without_authorization, 'forbidden');
  assert.equal(value.execution.shell_without_authorization, 'forbidden');
  assert.equal(value.execution.network_without_authorization, 'forbidden');
});

test('queue, scheduler, worker, and canary service presence does not authorize dispatch', () => {
  const value = mutable();
  assert.equal(value.services.queue, true);
  assert.equal(value.services.scheduler, true);
  assert.equal(value.services.hermes_worker, true);
  assert.equal(value.services.public_web_canary, true);
  assert.equal(value.capabilities.CAPABILITY_QUEUE_MUTATION, false);
  assert.equal(value.capabilities.CAPABILITY_SCHEDULER_MUTATION, false);
  assert.equal(value.capabilities.CAPABILITY_DISPATCH, false);
});

test('plaintext secret policy and explicit runtime injection are mandatory', () => {
  const value = mutable();
  value.secrets.plaintext_repository = 'allowed';
  value.contract_fingerprint = hashContract(value);
  assert.ok(errors(value).includes('secret_policy_invalid'));
});

test('receipts, correlation IDs, and exact authorization binding are mandatory', () => {
  const value = mutable();
  value.audit.correlation_id_required = false;
  value.contract_fingerprint = hashContract(value);
  assert.ok(errors(value).includes('audit_requirement_missing'));
});

test('Public Web Canary remains isolated and non-production', () => {
  const value = mutable();
  assert.equal(value.services.public_web_canary, true);
  assert.equal(value.environment, 'staging');
  assert.equal(value.production_allowed, false);
  assert.equal(value.capabilities.CAPABILITY_PROVIDER_CALL, false);
  assert.equal(value.capabilities.CAPABILITY_NETWORK_OUTBOUND, false);
  assert.equal(value.capabilities.CAPABILITY_PRODUCTION_EFFECT, false);
});

test('control and execution planes cannot silently collapse', () => {
  const value = mutable();
  value.execution_plane = value.control_plane;
  value.contract_fingerprint = hashContract(value);
  assert.ok(errors(value).includes('plane_identity_invalid'));
});

test('unknown relevant fields are rejected', () => {
  const value = { ...valid(), unexpected_policy: true };
  assert.ok(errors(value).some((error) => error.startsWith('host_contract_unknown_field::')));
});

test('contract fingerprint changes with relevant content', () => {
  const a = valid();
  const b = mutable();
  b.services.scheduler = false;
  b.contract_fingerprint = hashContract(b);
  assert.notEqual(a.contract_fingerprint, b.contract_fingerprint);
});

function canonicalEvidence() {
  const provenance = {
    repository: 'instutodp-cpu/agente-grupo-erick',
    branch: 'hermes/execution-host-contract-v1',
    commit_sha: 'e76a3d3a79196eb55e5d57e9ec97a7082b0bb869'
  };
  const bootstrap = buildHermesVpsBootstrapContract({ provenance });
  const plan = buildHermesVpsProvisioningPlan({ bootstrap_contract: bootstrap });
  const authorization = buildHermesVpsExecutionAuthorization({
    provisioning_plan: plan,
    authorization_id: 'host-auth-1',
    issued_at: '2026-08-12T10:00:00.000Z',
    expires_at: '2026-08-12T10:05:00.000Z',
    issued_by: { authority_id: 'owner-1', authority_type: 'human_owner' },
    target_id: 'staging-host-1',
    phase_ids: ['P0_HOST_VALIDATION'],
    step_ids: ['validate_host'],
    provenance
  });
  return { plan, authorization };
}

function readyEvidence() {
  const { plan, authorization } = canonicalEvidence();
  return {
    provisioning_plan: { state: 'VALIDATED', plan_version: plan.plan_version, plan_hash: plan.plan_hash },
    authorization: {
      state: 'AUTHORIZED', authorization_id: authorization.authorization_id,
      authorization_hash: authorization.authorization_hash, plan_version: authorization.provisioning_plan_reference.plan_version,
      plan_hash: authorization.provisioning_plan_hash
    },
    lifecycle: { state: 'CONSUMED', authorization_id: authorization.authorization_id, reference_id: 'consume-host-auth-1' },
    durable_lifecycle: { state: 'CONSUMED', authorization_id: authorization.authorization_id, reference_id: 'consume-host-auth-1', persistence_contract: 'hermes-vps-durable-authorization-lifecycle-registry-v1' },
    attempt_ownership: { state: 'CLAIMED', attempt_id: 'attempt-host-1', attempt_fingerprint: 'a'.repeat(64), owner_reference: { executor_id: 'executor-host-1', executor_type: 'synthetic_executor' } },
    admission: { state: 'ADMITTED', admission_id: 'admission-host-1', admission_fingerprint: 'b'.repeat(64), handoff_fingerprint: 'c'.repeat(64), authorization_id: authorization.authorization_id, lifecycle_reference_id: 'consume-host-auth-1', attempt_id: 'attempt-host-1', owner_reference: { executor_id: 'executor-host-1', executor_type: 'synthetic_executor' } }
  };
}

function readyContract() {
  return buildHermesExecutionHostContract({
    correlation_id: 'correlation-host-1',
    readiness: { host: 'READY', runtime: 'READY', admission: 'READY', durable_audit_observability: 'READY', production_execution_authorized: false },
    canonical_bindings: readyEvidence()
  });
}

test('readiness records the canonical post-135 dependencies without authorizing execution', () => {
  const value = readyContract();
  assert.equal(validateHermesExecutionHostContract(value).valid, true);
  assert.equal(value.readiness.production_execution_authorized, false);
  assert.equal(value.canonical_bindings.admission.attempt_id, 'attempt-host-1');
  assert.equal(value.canonical_bindings.durable_lifecycle.reference_id, 'consume-host-auth-1');
});

for (const [name, mutate, expected] of [
  ['missing authorization', (v) => { delete v.canonical_bindings.authorization; }, 'canonical_binding::authorization_must_be_object'],
  ['missing provisioning readiness', (v) => { v.canonical_bindings.provisioning_plan.state = 'NOT_ASSESSED'; v.readiness.runtime = 'READY'; }, 'runtime_readiness_dependency_missing'],
  ['missing lifecycle readiness', (v) => { v.canonical_bindings.lifecycle.state = 'NOT_ASSESSED'; v.readiness.admission = 'READY'; }, 'admission_readiness_dependency_missing'],
  ['missing durable lifecycle readiness', (v) => { v.canonical_bindings.durable_lifecycle.state = 'NOT_ASSESSED'; v.readiness.admission = 'READY'; }, 'admission_readiness_dependency_missing'],
  ['owner mismatch', (v) => { v.canonical_bindings.admission.owner_reference.executor_id = 'other-owner'; }, 'admission_ownership_binding_mismatch'],
  ['attempt mismatch', (v) => { v.canonical_bindings.admission.attempt_id = 'other-attempt'; }, 'admission_ownership_binding_mismatch'],
  ['admission mismatch', (v) => { v.canonical_bindings.admission.lifecycle_reference_id = 'other-consumption'; }, 'admission_lifecycle_binding_mismatch'],
  ['malformed evidence', (v) => { v.canonical_bindings.authorization.plan_hash = 'malformed'; }, 'canonical_digest_invalid']
]) {
  test(`fails closed for ${name}`, () => {
    const value = JSON.parse(JSON.stringify(readyContract()));
    mutate(value);
    value.contract_fingerprint = hashContract(value);
    assert.equal(validateHermesExecutionHostContract(value).valid, false);
    assert.ok(validateHermesExecutionHostContract(value).errors.includes(expected));
  });
}

test('replay identity remains deterministic across equivalent evidence', () => {
  const a = readyContract();
  const b = JSON.parse(JSON.stringify(readyContract()));
  assert.equal(a.contract_fingerprint, b.contract_fingerprint);
  b.canonical_bindings.admission.handoff_fingerprint = 'd'.repeat(64);
  b.contract_fingerprint = hashContract(b);
  assert.notEqual(a.contract_fingerprint, b.contract_fingerprint);
});

test('host contract has no execution side effects or operational capability', () => {
  const value = readyContract();
  assert.equal(value.production_allowed, false);
  assert.equal(value.readiness.production_execution_authorized, false);
  assert.deepEqual(Object.values(value.capabilities), CAPABILITIES.map(() => false));
});
