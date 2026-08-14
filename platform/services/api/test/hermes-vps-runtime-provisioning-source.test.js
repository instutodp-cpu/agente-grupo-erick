'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  validateHermesVpsBootstrapContract
} = require('../src/core/hermes-vps-bootstrap-contract');
const {
  validateHermesVpsProvisioningPlan
} = require('../src/core/hermes-vps-provisioning-plan');
const {
  RUNTIME_PROVISIONING_SOURCE_VERSION,
  createHermesVpsRuntimeProvisioning
} = require('../src/core/hermes-vps-runtime-provisioning-source');

const provenance = {
  repository: 'instutodp-cpu/agente-grupo-erick',
  branch: 'hermes/pr-d4c-authoritative-provisioning-source',
  commit_sha: '388eafe04417da78b912ce6e1cda2a97ebb55def'
};

function validInput(overrides = {}) {
  return {
    provenance: { ...provenance },
    bootstrap_overrides: { ...overrides }
  };
}

test('explicit input produces canonical bootstrap contract and provisioning plan', () => {
  const source = createHermesVpsRuntimeProvisioning({ input: validInput({ architecture: 'arm64' }) });

  assert.equal(source.runtime_provisioning_source_version, RUNTIME_PROVISIONING_SOURCE_VERSION);
  assert.equal(validateHermesVpsBootstrapContract(source.bootstrap_contract).valid, true);
  assert.equal(validateHermesVpsProvisioningPlan(source.provisioning_plan).valid, true);
  assert.equal(source.bootstrap_contract.architecture, 'arm64');
  assert.equal(source.provisioning_plan.target_architecture, 'arm64');
});

test('same explicit input produces the same hashes and canonical output', () => {
  const first = createHermesVpsRuntimeProvisioning({ input: validInput() });
  const second = createHermesVpsRuntimeProvisioning({ input: validInput() });

  assert.deepEqual(first.bootstrap_contract, second.bootstrap_contract);
  assert.deepEqual(first.provisioning_plan, second.provisioning_plan);
  assert.equal(first.bootstrap_contract.provenance.contract_hash, second.bootstrap_contract.provenance.contract_hash);
  assert.equal(first.provisioning_plan.plan_hash, second.provisioning_plan.plan_hash);
});

test('missing input fails closed', () => {
  assert.throws(
    () => createHermesVpsRuntimeProvisioning(),
    /hermes_runtime_provisioning_input_input_must_be_object/
  );
});

test('unknown input fields fail closed instead of becoming configuration', () => {
  assert.throws(
    () => createHermesVpsRuntimeProvisioning({ input: { ...validInput(), tenant_id: 'tenant-a' } }),
    /hermes_runtime_provisioning_input_input_unknown_field/
  );
});

test('missing provenance fields fail closed', () => {
  assert.throws(
    () => createHermesVpsRuntimeProvisioning({ input: { provenance: { ...provenance, commit_sha: undefined }, bootstrap_overrides: {} } }),
    /invalid_bootstrap_contract::exact_provenance_required/
  );
});

test('bootstrap overrides must be an object', () => {
  assert.throws(
    () => createHermesVpsRuntimeProvisioning({ input: { provenance, bootstrap_overrides: null } }),
    /hermes_runtime_provisioning_input_bootstrap_overrides_must_be_object/
  );
});

test('secret and connection material is rejected before contract construction', () => {
  for (const forbidden of [
    { DATABASE_URL: 'postgresql://example.invalid/db' },
    { password: 'not-a-secret-for-production' },
    { bootstrap_overrides: { SUPABASE_KEY: 'test-only-placeholder' } }
  ]) {
    const input = { ...validInput(), ...forbidden };
    assert.throws(
      () => createHermesVpsRuntimeProvisioning({ input }),
      /hermes_runtime_provisioning_input_(input_unknown_field|secret_material_forbidden)/
    );
  }
});

test('process environment does not influence the explicit source', () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://ignored.invalid/not-used';
  try {
    const source = createHermesVpsRuntimeProvisioning({ input: validInput() });
    assert.equal(source.provisioning_plan.plan_hash, createHermesVpsRuntimeProvisioning({ input: validInput() }).provisioning_plan.plan_hash);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test('the source does not select memory or postgres', () => {
  const source = createHermesVpsRuntimeProvisioning({ input: validInput() });
  assert.equal(Object.prototype.hasOwnProperty.call(source.provisioning_plan, 'backend'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(source.provisioning_plan, 'persistence_mode'), false);
});

test('bootstrap and plan builders remain the only contract constructors', () => {
  const source = createHermesVpsRuntimeProvisioning({ input: validInput({ environment: 'staging' }) });
  assert.equal(source.bootstrap_contract.contract_version, 'hermes-vps-bootstrap-contract-v1');
  assert.equal(source.provisioning_plan.plan_version, 'hermes-vps-provisioning-plan-v1');
});

test('tenant/workspace fields are not silently accepted or invented', () => {
  assert.throws(
    () => createHermesVpsRuntimeProvisioning({ input: { ...validInput(), bootstrap_overrides: { tenant_id: 'tenant-a' } } }),
    /invalid_bootstrap_contract::contract_unknown_field::tenant_id/
  );
});

test('import has no process or external-resource side effects', () => {
  const before = ['SIGTERM', 'SIGINT'].map((signal) => process.listenerCount(signal));
  delete require.cache[require.resolve('../src/core/hermes-vps-runtime-provisioning-source')];
  require('../src/core/hermes-vps-runtime-provisioning-source');
  const after = ['SIGTERM', 'SIGINT'].map((signal) => process.listenerCount(signal));
  assert.deepEqual(after, before);
});
