'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildHermesMaintainerExecutionAttemptClaim,validateHermesMaintainerExecutionAttemptClaim}=require('../src/core/hermes-maintainer-execution-attempt-ownership');
const consumption={ok:true,status:'CONSUMED',authorization_id:'a1',fingerprint:'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'};
const input={attempt_id:'at1',mission_id:'m1',operation:'repository_read',repository:'instutodp-cpu/agente-grupo-erick',base_ref:'main',executor_id:'hermes-maintainer-staging',lease_id:'lease1',lease_expires_at:'2026-09-24T20:00:00.000Z',idempotency_key:'idem1'};
test('claims staging attempt without execution',()=>{const v=buildHermesMaintainerExecutionAttemptClaim(consumption,input);assert.equal(v.status,'MAINTAINER_EXECUTION_ATTEMPT_CLAIMED_STAGING');assert.equal(v.claimed,true);assert.equal(v.execution_performed,false);assert.equal(validateHermesMaintainerExecutionAttemptClaim(v).valid,true);});
test('blocks missing consumed lifecycle',()=>{const v=buildHermesMaintainerExecutionAttemptClaim({ok:false,status:'INVALID'},input);assert.equal(v.claimed,false);});
test('fingerprint drift is rejected',()=>{const v={...buildHermesMaintainerExecutionAttemptClaim(consumption,input),repository:'other'};assert.equal(validateHermesMaintainerExecutionAttemptClaim(v).valid,false);});
test('claimed attempt cannot imply side effects',()=>{const v={...buildHermesMaintainerExecutionAttemptClaim(consumption,input),network_used:true};assert.equal(validateHermesMaintainerExecutionAttemptClaim(v).valid,false);});
