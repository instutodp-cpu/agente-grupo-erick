'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CONTRACT_VERSION: REQUEST } = require('../src/core/hermes-maintainer-request-contract');
const { prepareHermesMaintainerPlan } = require('../src/core/hermes-maintainer-plan-contract');
const { buildHermesMaintainerPlanFingerprint } = require('../src/core/hermes-maintainer-plan-fingerprint');
const { prepareHermesMaintainerSteps } = require('../src/core/hermes-maintainer-step-contract');
const { admitHermesMaintainerSteps } = require('../src/core/hermes-maintainer-step-admission-contract');
const {
  buildHermesMaintainerStepAdmissionFingerprint,
  validateHermesMaintainerStepAdmissionFingerprint,
  verifyHermesMaintainerStepAdmissionFingerprint
} = require('../src/core/hermes-maintainer-step-admission-fingerprint');

function request(id, action) {
  return { contract_version: REQUEST, request_id: id, action, repository: 'instutodp-cpu/agente-grupo-erick', base_ref: 'main', target_ref: null, simulation: true, production_blocked: true };
}
function fixture() {
  const plan = prepareHermesMaintainerPlan({ mission_id: 'm1', requests: [request('1','repository_read'),request('2','ci_read')] });
  const steps = prepareHermesMaintainerSteps(plan, buildHermesMaintainerPlanFingerprint(plan).fingerprint);
  return admitHermesMaintainerSteps(steps);
}

test('fingerprints an admitted step sequence deterministically', () => {
  const admission = fixture();
  const first = buildHermesMaintainerStepAdmissionFingerprint(admission);
  const second = buildHermesMaintainerStepAdmissionFingerprint(admission);
  assert.equal(first.status,'MAINTAINER_STEP_ADMISSION_FINGERPRINT_PREPARED_SIMULATION');
  assert.deepEqual(first,second);
  assert.equal(validateHermesMaintainerStepAdmissionFingerprint(first.fingerprint).valid,true);
  assert.equal(verifyHermesMaintainerStepAdmissionFingerprint(admission,first.fingerprint).valid,true);
  for (const field of ['executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed','production_allowed']) assert.equal(first[field],false);
});

test('detects admitted-step drift fail closed', () => {
  const admission = fixture();
  const built = buildHermesMaintainerStepAdmissionFingerprint(admission);
  const drifted = { ...admission, admitted_steps: admission.admitted_steps.map((step,index)=>index===0?{...step,action:'ci_read'}:step) };
  const verification = verifyHermesMaintainerStepAdmissionFingerprint(drifted,built.fingerprint);
  assert.equal(verification.valid,false);
  assert.ok(verification.errors.includes('admission_digest_mismatch'));
});

test('blocks fingerprint creation for a non-admitted source', () => {
  const admission = { ...fixture(), admitted:false, status:'MAINTAINER_STEPS_ADMISSION_BLOCKED', blockers:['blocked'] };
  const built = buildHermesMaintainerStepAdmissionFingerprint(admission);
  assert.equal(built.status,'MAINTAINER_STEP_ADMISSION_FINGERPRINT_BLOCKED');
  assert.equal(built.fingerprint,null);
});

test('rejects fingerprint tampering', () => {
  const admission = fixture();
  const built = buildHermesMaintainerStepAdmissionFingerprint(admission);
  assert.equal(verifyHermesMaintainerStepAdmissionFingerprint(admission,{...built.fingerprint,step_count:99}).valid,false);
  assert.equal(verifyHermesMaintainerStepAdmissionFingerprint(admission,{...built.fingerprint,admission_digest:'sha256:bad'}).valid,false);
});
