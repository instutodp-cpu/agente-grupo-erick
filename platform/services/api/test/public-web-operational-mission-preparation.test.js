'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const { prepareOperationalMissionReauth, bindOperationalMissionEvidence }=require('../src/core/public-web-operational-mission-preparation');

function inbox(initial='accepted') {
  let record={mission_id:'mission-1',mission_run_id:'run-1',contract_hash:`sha256:${'a'.repeat(64)}`,target_origin:'https://example.com',target_path:'/docs',trial_config:{environment:'staging',maximum_requests:1},status:initial};
  const transitions=[];
  return {transitions,get record(){return record;},async getByRun(id){return id==='run-1'?{ok:true,status:'FOUND',record}:{ok:false,status:'NOT_FOUND',reason:'mission_not_found'};},async transition(input){transitions.push(input);if(record.status!==input.expected_status)return {ok:false,status:'CONFLICT',reason:'mission_status_changed',current_status:record.status};record={...record,status:input.next_status,...input.patch};return {ok:true,status:'TRANSITIONED',record};}};
}
function challenge(overrides={}) {return {ok:true,status:'EMAIL_REAUTH_OPERATIONAL_CHALLENGE_READY',challenge_id:`sha256:${'b'.repeat(64)}`,action_digest:`sha256:${'c'.repeat(64)}`,delivery_reference:'delivery-1',identity_alias:'owner-primary-email',issued_at:'2026-10-14T22:00:00.000Z',ttl_seconds:600,execution_authorized:false,production_allowed:false,...overrides};}
function evidenceStore(overrides={}) {return {async readVerified(){return {ok:true,durable:true,single_use:true,challenge_id:challenge().challenge_id,action_digest:challenge().action_digest,subject_id:'human:owner',verified_at:'2026-10-14T22:00:30.000Z',...overrides};}};}

test('accepted mission creates a fresh challenge and moves durably to awaiting human reauth',async()=>{
  const store=inbox(); let calls=0;
  const result=await prepareOperationalMissionReauth({inbox:store,mission_run_id:'run-1',challengeFactory:async input=>{calls+=1;assert.equal(input.target_origin,'https://example.com');assert.equal(input.target_path,'/docs');return challenge();}});
  assert.equal(result.ok,true);assert.equal(result.status,'PUBLIC_WEB_OPERATIONAL_MISSION_AWAITING_HUMAN_REAUTH');assert.equal(calls,1);assert.equal(store.record.status,'awaiting_human_reauth');assert.equal(store.record.reauth_challenge_id,challenge().challenge_id);assert.equal(result.execution_authorized,false);assert.equal(result.external_network_called,false);
  assert.deepEqual(store.transitions.map(x=>[x.expected_status,x.next_status]),[['accepted','preparing'],['preparing','awaiting_human_reauth']]);
});

test('non-accepted mission does not mint another reauth challenge',async()=>{
  const store=inbox('awaiting_human_reauth');let calls=0;
  const result=await prepareOperationalMissionReauth({inbox:store,mission_run_id:'run-1',challengeFactory:async()=>{calls+=1;return challenge();}});
  assert.equal(result.ok,false);assert.equal(result.reason,'mission_must_be_accepted');assert.equal(calls,0);assert.equal(store.transitions.length,0);
});

test('challenge failure consumes preparation state into failed_safe instead of retrying implicitly',async()=>{
  const store=inbox();
  const result=await prepareOperationalMissionReauth({inbox:store,mission_run_id:'run-1',challengeFactory:async()=>{throw new Error('provider unavailable');},clock:()=> '2026-10-14T22:01:00.000Z'});
  assert.equal(result.ok,false);assert.equal(result.reason,'reauth_challenge_preparation_failed');assert.equal(store.record.status,'failed_safe');assert.equal(store.record.error_code,'reauth_challenge_preparation_failed');
});

test('invalid challenge shape fails closed and never reaches awaiting state',async()=>{
  const store=inbox();
  const result=await prepareOperationalMissionReauth({inbox:store,mission_run_id:'run-1',challengeFactory:async()=>challenge({production_allowed:true}),clock:()=> '2026-10-14T22:02:00.000Z'});
  assert.equal(result.ok,false);assert.equal(result.reason,'reauth_challenge_invalid');assert.equal(store.record.status,'failed_safe');
});

test('fresh durable evidence bound to the same challenge moves mission to ready_for_tty',async()=>{
  const store=inbox('awaiting_human_reauth');
  store.record.reauth_challenge_id=challenge().challenge_id;store.record.reauth_action_digest=challenge().action_digest;
  const key=`sha256:${'d'.repeat(64)}`;
  const result=await bindOperationalMissionEvidence({inbox:store,evidenceStore:evidenceStore(),mission_run_id:'run-1',evidence_key:key});
  assert.equal(result.ok,true);assert.equal(result.status,'PUBLIC_WEB_OPERATIONAL_MISSION_READY_FOR_TTY');assert.equal(store.record.status,'ready_for_tty');assert.equal(store.record.evidence_key,key);assert.equal(result.execution_authorized,false);assert.equal(result.external_network_called,false);
});

test('evidence from another challenge cannot be rebound to a mission',async()=>{
  const store=inbox('awaiting_human_reauth');store.record.reauth_challenge_id=challenge().challenge_id;store.record.reauth_action_digest=challenge().action_digest;
  const result=await bindOperationalMissionEvidence({inbox:store,evidenceStore:evidenceStore({challenge_id:`sha256:${'e'.repeat(64)}`}),mission_run_id:'run-1',evidence_key:`sha256:${'d'.repeat(64)}`});
  assert.equal(result.ok,false);assert.equal(result.reason,'mission_reauth_evidence_binding_mismatch');assert.equal(store.record.status,'awaiting_human_reauth');
});

test('ready mission cannot consume or replace evidence again',async()=>{
  const store=inbox('ready_for_tty');store.record.reauth_challenge_id=challenge().challenge_id;store.record.reauth_action_digest=challenge().action_digest;
  const result=await bindOperationalMissionEvidence({inbox:store,evidenceStore:evidenceStore(),mission_run_id:'run-1',evidence_key:`sha256:${'d'.repeat(64)}`});
  assert.equal(result.ok,false);assert.equal(result.reason,'mission_must_be_awaiting_human_reauth');
});
