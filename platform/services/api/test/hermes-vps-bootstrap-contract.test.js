'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CONTRACT_VERSION,
  RECEIPT_VERSION,
  buildHermesVpsBootstrapContract,
  buildHermesVpsBootstrapPlan,
  buildHermesVpsBootstrapReceipt,
  hashContract,
  validateHermesVpsBootstrapContract,
  validateHermesVpsBootstrapPlan,
  validateHermesVpsBootstrapPreflight,
  validateHermesVpsBootstrapReceipt
} = require('../src/core/hermes-vps-bootstrap-contract');

const provenance = {
  repository: 'instutodp-cpu/agente-grupo-erick',
  branch: 'agent/hermes-execution-host-contract-v1',
  commit_sha: '08d77d5dd78e06952e488e64a6c5603c74f3c318'
};

function contract(overrides = {}) {
  return buildHermesVpsBootstrapContract({ provenance, ...overrides });
}

function validHost(value = {}) {
  return {
    operating_system: 'ubuntu_server_lts', architecture: 'x86_64', timezone: 'UTC',
    is_root: false, disk_free_bytes: 20 * 1024 * 1024 * 1024,
    memory_bytes: 4 * 1024 * 1024 * 1024, cpu_count: 4, open_tcp_ports: [443],
    container_runtime: 'docker_compatible', conflicting_paths: [],
    secrets_in_prohibited_paths: false, branch: provenance.branch,
    commit_sha: provenance.commit_sha, ...value
  };
}

test('accepts the valid staging baseline', () => assert.equal(validateHermesVpsBootstrapContract(contract()).valid, true));
test('rejects root SSH login', () => assert.equal(validateHermesVpsBootstrapContract(contract({ ssh: { root_login: true } })).valid, false));
test('rejects password SSH authentication', () => assert.equal(validateHermesVpsBootstrapContract(contract({ ssh: { password_authentication: true } })).valid, false));
test('requires inbound deny-by-default', () => assert.equal(validateHermesVpsBootstrapContract(contract({ network: { inbound_policy: 'allow' } })).valid, false));
test('rejects plaintext secret policy', () => assert.equal(validateHermesVpsBootstrapContract(contract({ secrets: { plaintext_forbidden: false } })).valid, false));
test('rejects repository secret storage', () => assert.equal(validateHermesVpsBootstrapContract(contract({ secrets: { repository_forbidden: false } })).valid, false));
test('safe mode is enabled', () => assert.equal(contract().execution_safety.safe_mode, true));
test('safe mode blocks provider execution', () => assert.equal(contract().execution_safety.provider_execution_default, false));
test('safe mode blocks shell execution', () => assert.equal(contract().execution_safety.shell_execution_default, false));
test('safe mode blocks network execution', () => assert.equal(contract().execution_safety.network_execution_default, false));
test('safe mode blocks scheduler execution', () => assert.equal(contract().execution_safety.scheduler_execution_default, false));
test('safe mode blocks queue execution', () => assert.equal(contract().execution_safety.queue_execution_default, false));
test('safe mode blocks worker execution', () => assert.equal(contract().execution_safety.worker_execution_default, false));
test('production effect remains ZERO', () => assert.equal(contract().execution_safety.production_effect, 'ZERO'));
test('bootstrap plan is declarative and does not execute mutations', () => {
  const plan = buildHermesVpsBootstrapPlan(contract(), { target_host_fingerprint: 'fixture-host' });
  assert.equal(plan.execution_mode, 'plan_only');
  assert.equal(plan.mutations_executed, false);
});
test('bootstrap plan is deterministic', () => {
  const a = buildHermesVpsBootstrapPlan(contract(), { target_host_fingerprint: 'fixture-host' });
  const b = buildHermesVpsBootstrapPlan(contract(), { target_host_fingerprint: 'fixture-host' });
  assert.deepEqual(a, b);
});
test('plan steps have unique idempotency keys', () => {
  const plan = buildHermesVpsBootstrapPlan(contract());
  assert.equal(new Set(plan.steps.map((step) => step.idempotency_key)).size, plan.steps.length);
});
test('plan does not duplicate firewall configuration', () => {
  const plan = buildHermesVpsBootstrapPlan(contract());
  assert.equal(plan.steps.filter((step) => step.mutation_class === 'FIREWALL_CONFIG').length, 1);
});
test('plan does not duplicate service configuration', () => {
  const plan = buildHermesVpsBootstrapPlan(contract());
  assert.equal(plan.steps.filter((step) => step.mutation_class === 'SERVICE_CONFIG').length, 1);
});
test('rollback contract preserves audit and persistent resources', () => {
  const plan = buildHermesVpsBootstrapPlan(contract());
  assert.ok(plan.rollback_steps.every((step) => step.preserves.includes('audit_trail') && step.preserves.includes('persistent_data')));
});
test('receipt schema excludes secret values', () => {
  const receipt = buildHermesVpsBootstrapReceipt({ plan_hash: 'sha256:' + 'a'.repeat(64) });
  assert.equal(validateHermesVpsBootstrapReceipt(receipt).valid, true);
  assert.equal(Object.keys(receipt).some((key) => /secret|token|password/i.test(key)), false);
});
test('allowed port changes the contract hash', () => {
  assert.notEqual(hashContract(contract()), hashContract(contract({ network: { allowed_tcp_ports: [443, 80] } })));
});
test('OS changes the contract hash', () => {
  assert.notEqual(hashContract(contract()), hashContract(contract({ operating_system: 'debian_stable' })));
});
test('safe mode changes the contract hash', () => {
  assert.notEqual(hashContract(contract()), hashContract(contract({ execution_safety: { safe_mode: false } })));
});
test('secret policy changes the contract hash', () => {
  assert.notEqual(hashContract(contract()), hashContract(contract({ secrets: { rotation_supported: false } })));
});
test('execution safety changes the contract hash', () => {
  assert.notEqual(hashContract(contract()), hashContract(contract({ execution_safety: { provider_execution_default: true } })));
});
test('equivalent material has a stable hash despite key order', () => {
  const a = contract();
  const b = Object.fromEntries(Object.entries(a).reverse());
  assert.equal(hashContract(a), hashContract(b));
});
test('resource limits are mandatory', () => assert.equal(validateHermesVpsBootstrapContract(contract({ runtime: { resource_limits_required: false } })).valid, false));
test('health checks are mandatory', () => assert.equal(validateHermesVpsBootstrapContract(contract({ runtime: { healthcheck_required: false } })).valid, false));
test('public endpoints require TLS', () => assert.equal(validateHermesVpsBootstrapContract(contract({ reverse_proxy: { tls_required: false } })).valid, false));
test('logs require redaction', () => assert.equal(validateHermesVpsBootstrapContract(contract({ logging: { secret_redaction: false } })).valid, false));
test('backup restore testing is mandatory', () => assert.equal(validateHermesVpsBootstrapContract(contract({ backups: { restore_test_required: false } })).valid, false));
test('exact revision provenance is mandatory', () => assert.equal(validateHermesVpsBootstrapContract(contract({ provenance: { commit_sha: null } })).valid, false));
test('preflight accepts a complete staging fixture', () => {
  const result = validateHermesVpsBootstrapPreflight({ contract: contract(), observed_host: validHost() });
  assert.equal(result.status, 'READY');
  assert.equal(result.valid, true);
});
test('preflight rejects production', () => assert.equal(validateHermesVpsBootstrapPreflight({ contract: contract({ environment: 'production' }), observed_host: validHost() }).valid, false));
test('preflight rejects an unexpected open port', () => assert.equal(validateHermesVpsBootstrapPreflight({ contract: contract(), observed_host: validHost({ open_tcp_ports: [443, 22] }) }).valid, false));
test('preflight rejects revision mismatch', () => assert.equal(validateHermesVpsBootstrapPreflight({ contract: contract(), observed_host: validHost({ commit_sha: 'f'.repeat(40) }) }).valid, false));
test('preflight rejects prohibited secret paths', () => assert.equal(validateHermesVpsBootstrapPreflight({ contract: contract(), observed_host: validHost({ secrets_in_prohibited_paths: true }) }).valid, false));
test('unknown contract fields fail closed', () => assert.equal(validateHermesVpsBootstrapContract({ ...contract(), unsafe_unknown: true }).valid, false));
test('receipt has the canonical receipt version', () => assert.equal(buildHermesVpsBootstrapReceipt().contract_version, RECEIPT_VERSION));
test('receipt rejects real execution', () => assert.equal(validateHermesVpsBootstrapReceipt({ ...buildHermesVpsBootstrapReceipt({ plan_hash: 'sha256:' + 'b'.repeat(64) }), real_execution_performed: true }).valid, false));
test('plan validation rejects an executed plan', () => {
  const plan = buildHermesVpsBootstrapPlan(contract());
  assert.equal(validateHermesVpsBootstrapPlan({ ...plan, mutations_executed: true }).valid, false);
});
test('contract version is canonical', () => assert.equal(contract().contract_version, CONTRACT_VERSION));
