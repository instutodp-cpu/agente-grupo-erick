'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildHermesMaintainerExecutionAttemptClaim}=require('../src/core/hermes-maintainer-execution-attempt-ownership');
const {buildHermesMaintainerDurableAdmissionHandoff}=require('../src/core/hermes-maintainer-durable-admission-handoff');
const {buildHermesMaintainerScmReadCapabilityGrant,validateHermesMaintainerScmReadCapabilityGrant}=require('../src/core/hermes-maintainer-scm-read-capability-grant');
const consumption={ok:true,status:'CONSUMED',authorization_id:'a1',fingerprint:'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'};
function handoff(operation='repository_read'){const input={attempt_id:'at1',mission_id:'m1',operation,repository:'instutodp-cpu/agente-grupo-erick',base_ref:'main',executor_id:'hermes-maintainer-staging',lease_id:'lease1',lease_expires_at:'2026-09-24T23:00:00.000Z',idempotency_key:'idem1'};return buildHermesMaintainerDurableAdmissionHandoff(buildHermesMaintainerExecutionAttemptClaim(consumption,input),{admission_id:'adm1'});}
test('grants read-only SCM capability without execution authority',()=>{const v=buildHermesMaintainerScmReadCapabilityGrant(handoff(),{capability_id:'cap1'});assert.equal(v.capability_granted,true);assert.equal(v.write_authorized,false);assert.equal(v.execution_performed,false);assert.equal(validateHermesMaintainerScmReadCapabilityGrant(v).valid,true);});
test('blocks write operation',()=>{assert.equal(buildHermesMaintainerScmReadCapabilityGrant(handoff('branch_prepare'),{capability_id:'cap1'}).capability_granted,false);});
test('fingerprint drift is rejected',()=>{const v={...buildHermesMaintainerScmReadCapabilityGrant(handoff(),{capability_id:'cap1'}),repository:'other'};assert.equal(validateHermesMaintainerScmReadCapabilityGrant(v).valid,false);});
test('validator rejects write authority',()=>{const v={...buildHermesMaintainerScmReadCapabilityGrant(handoff(),{capability_id:'cap1'}),write_authorized:true};assert.equal(validateHermesMaintainerScmReadCapabilityGrant(v).valid,false);});
