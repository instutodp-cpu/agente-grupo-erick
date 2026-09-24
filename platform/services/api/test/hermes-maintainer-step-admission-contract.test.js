'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CONTRACT_VERSION: REQUEST } = require('../src/core/hermes-maintainer-request-contract');
const { prepareHermesMaintainerPlan } = require('../src/core/hermes-maintainer-plan-contract');
const { buildHermesMaintainerPlanFingerprint } = require('../src/core/hermes-maintainer-plan-fingerprint');
const { prepareHermesMaintainerSteps } = require('../src/core/hermes-maintainer-step-contract');
const { admitHermesMaintainerSteps, validateHermesMaintainerStepAdmission } = require('../src/core/hermes-maintainer-step-admission-contract');

function request(id, action, target = null) { return { contract_version: REQUEST, request_id: id, action, repository: 'instutodp-cpu/agente-grupo-erick', base_ref: 'main', target_ref: target, simulation: true, production_blocked: true }; }
function fixture() { const plan = prepareHermesMaintainerPlan({ mission_id: 'm1', requests: [request('1','repository_read'),request('2','ci_read'),request('3','branch_prepare','feat/x'),request('4','code_edit_prepare','feat/x'),request('5','pull_request_prepare','feat/x')] }); return prepareHermesMaintainerSteps(plan, buildHermesMaintainerPlanFingerprint(plan).fingerprint); }

test('admits valid prepared steps and preserves order without side effects', () => { const out=admitHermesMaintainerSteps(fixture()); assert.equal(out.admitted,true); assert.deepEqual(out.admitted_steps.map(s=>s.step_kind),['READ_PREPARATION','CI_READ_PREPARATION','BRANCH_PREPARATION','CODE_EDIT_PREPARATION','PULL_REQUEST_PREPARATION']); assert.equal(validateHermesMaintainerStepAdmission(out).valid,true); for(const f of ['executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed']) assert.equal(out[f],false); assert.equal(out.production_allowed,false); });
test('fails closed for invalid source contract, readiness, blockers and simulation', () => { for (const patch of [{contract_version:'bad'},{ready:false},{blockers:['blocked']},{simulation:false},{production_allowed:true}]) assert.equal(admitHermesMaintainerSteps({...fixture(),...patch}).admitted,false); });
test('fails closed for any evidence of step execution or side effects', () => { for(const field of ['executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed']) { const source=fixture(); const steps=source.steps.map((s,i)=>i===0?{...s,[field]:true}:s); assert.equal(admitHermesMaintainerSteps({...source,steps}).admitted,false); } });
test('fails closed for count, order, unsupported kind or unprepared step', () => { const source=fixture(); const variants=[{...source,step_count:99},{...source,steps:source.steps.map((s,i)=>i===0?{...s,step_index:1}:s)},{...source,steps:source.steps.map((s,i)=>i===0?{...s,step_kind:'UNKNOWN'}:s)},{...source,steps:source.steps.map((s,i)=>i===0?{...s,prepared:false}:s)}]; for(const value of variants) assert.equal(admitHermesMaintainerSteps(value).admitted,false); });
