'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHermesVpsBootstrapContract } = require('../src/core/hermes-vps-bootstrap-contract');
const { PHASE_IDS, PLAN_MODE, PLAN_VERSION, buildHermesVpsProvisioningPlan, hashPlan, validateHermesVpsProvisioningPlan } = require('../src/core/hermes-vps-provisioning-plan');

const provenance = {
  repository: 'instutodp-cpu/agente-grupo-erick',
  branch: 'agent/hermes-vps-bootstrap-contract-v1',
  commit_sha: 'a2fcff7dc2ded46600e8abbbdf523584216d8267'
};
const bootstrap = buildHermesVpsBootstrapContract({ provenance });

function plan() {
  return buildHermesVpsProvisioningPlan({ bootstrap_contract: bootstrap });
}

test('valid plan passes with the canonical bootstrap contract', () => assert.equal(validateHermesVpsProvisioningPlan(plan(), bootstrap).valid, true));
test('plan version is canonical', () => assert.equal(plan().plan_version, PLAN_VERSION));
test('mode is PLAN_ONLY', () => assert.equal(plan().mode, PLAN_MODE));
test('all phases are represented in order', () => assert.deepEqual(plan().phases.map((phase) => phase.phase_id), PHASE_IDS));
test('all steps are represented in phase order', () => assert.deepEqual(plan().ordered_steps.map((step) => step.phase), PHASE_IDS));
test('step IDs are unique', () => assert.equal(new Set(plan().ordered_steps.map((step) => step.id)).size, plan().ordered_steps.length));
test('same input produces same plan hash', () => assert.equal(hashPlan(plan()), plan().plan_hash));
test('step mutation changes plan hash', () => {
  const value = JSON.parse(JSON.stringify(plan()));
  value.ordered_steps[1].intended_effect = 'tampered';
  assert.notEqual(hashPlan(value), plan().plan_hash);
});
test('step order changes plan hash', () => {
  const value = JSON.parse(JSON.stringify(plan()));
  value.ordered_steps[1].order = 9;
  assert.notEqual(hashPlan(value), plan().plan_hash);
});
test('bootstrap contract change changes plan hash', () => {
  const changed = buildHermesVpsBootstrapContract({ provenance, architecture: 'arm64' });
  assert.notEqual(buildHermesVpsProvisioningPlan({ bootstrap_contract: changed }).plan_hash, plan().plan_hash);
});
test('duplicate step IDs are rejected', () => {
  const value = JSON.parse(JSON.stringify(plan()));
  value.ordered_steps[1].id = value.ordered_steps[0].id;
  value.plan_hash = hashPlan(value);
  assert.equal(validateHermesVpsProvisioningPlan(value, bootstrap).valid, false);
});
test('invalid phase is rejected', () => {
  const value = JSON.parse(JSON.stringify(plan()));
  value.phases[0].phase_id = 'P99_UNKNOWN';
  value.plan_hash = hashPlan(value);
  assert.equal(validateHermesVpsProvisioningPlan(value, bootstrap).valid, false);
});
test('mutating step without authorization is rejected', () => {
  const value = JSON.parse(JSON.stringify(plan()));
  value.ordered_steps[1].requires_authorization = false;
  value.plan_hash = hashPlan(value);
  assert.equal(validateHermesVpsProvisioningPlan(value, bootstrap).valid, false);
});
test('safe mode is the default', () => assert.equal(plan().safe_mode, true));
test('plan creation does not authorize execution', () => assert.equal(plan().execution_boundary.plan_created_execution_authorized, false));
test('no execution is performed by generation', () => assert.equal(plan().execution_boundary.execution_performed, false));
test('provider calls are forbidden', () => assert.ok(plan().ordered_steps.every((step) => step.provider_required === false)));
test('network is descriptive only', () => assert.equal(plan().network_requirements_descriptive_only, true));
test('shell is descriptive only', () => assert.equal(plan().shell_requirements_descriptive_only, true));
test('no secret material is embedded', () => assert.equal(plan().secret_material_embedded, false));
test('canonical serialization is stable under root key order changes', () => {
  const value = Object.fromEntries(Object.entries(plan()).reverse());
  assert.equal(hashPlan(value), plan().plan_hash);
});
test('valid provenance is accepted', () => assert.equal(validateHermesVpsProvisioningPlan(plan(), bootstrap).valid, true));
test('adulterated bootstrap provenance is rejected', () => {
  const value = JSON.parse(JSON.stringify(plan()));
  value.bootstrap_contract_reference.hash = 'sha256:' + 'f'.repeat(64);
  value.provenance.bootstrap_contract_hash = value.bootstrap_contract_reference.hash;
  value.plan_hash = hashPlan(value);
  assert.equal(validateHermesVpsProvisioningPlan(value, bootstrap).valid, false);
});
test('incompatible bootstrap contract is rejected', () => {
  const changed = buildHermesVpsBootstrapContract({ provenance, environment: 'production' });
  assert.equal(validateHermesVpsProvisioningPlan(plan(), changed).valid, false);
});
test('production effect remains ZERO', () => assert.equal(plan().execution_boundary.production_effect, 'ZERO'));
test('unknown plan fields fail closed', () => assert.equal(validateHermesVpsProvisioningPlan({ ...plan(), unsafe: true }, bootstrap).valid, false));
test('unknown plan mode fails closed', () => assert.equal(validateHermesVpsProvisioningPlan({ ...plan(), mode: 'EXECUTABLE' }, bootstrap).valid, false));
test('provider mode remains provider-neutral', () => assert.equal(plan().provider_mode, 'provider_neutral'));
test('all mutating steps require authorization', () => assert.ok(plan().ordered_steps.filter((step) => step.mutating).every((step) => step.requires_authorization === true)));
test('all steps have failure behavior', () => assert.ok(plan().ordered_steps.every((step) => step.failure_behavior === 'fail_closed_stop_preserve_evidence')));
test('all phases have verification criteria', () => assert.ok(plan().phases.every((phase) => phase.verification_criteria.length > 0)));
test('plan does not perform network access', () => assert.equal(plan().execution_boundary.network_execution_authorized, false));
test('plan does not perform shell access', () => assert.equal(plan().execution_boundary.shell_execution_authorized, false));
test('plan does not perform production execution', () => assert.equal(plan().execution_boundary.production_execution_authorized, false));
