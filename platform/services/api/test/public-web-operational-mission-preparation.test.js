'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const { prepareOperationalMissionReauth, refreshOperationalMissionReauth, bindOperationalMissionEvidence, MAX_REAUTH_EVIDENCE_AGE_MS }=require('../src/core/public-web-operational-mission-preparation');

function inbox(initial='accepted') {
  let record={mission_id:'mission-1',mission_run_id:'run-1',contract_hash:`sha256:${'a'.repeat(64)}`,target_origin:'https://example.com',target_path:'/docs',trial_config:{environment:'staging',maximum_requests:1,operator_id:'human:owner'},status:initial};
  const transitions=[];
  return {transitions,get record(){return record;},async getByRun(id){return id===record.mission_run_id?{ok:true,status:'FOUND',record}:{ok:false,status:'NOT_FOUND',reason:'mission_not_found'};},async transition(input){transitions.push(input);if(record.status!==input.expected_status)return {ok:false,status:'CONFLICT',reason:'mission_status_changed',current_status:record.status};record={...record,status:input.next_status,...input.patch};return {ok:true,status:'TRANSITIONED',record};}};
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

test('evidence subject must match the mission operator before ready_for_tty',async()=>{
  const store=inbox('awaiting_human_reauth');store.record.reauth_challenge_id=challenge().challenge_id;store.record.reauth_action_digest=challenge().action_digest;store.record.trial_config.operator_id='external-user-id';
  const result=await bindOperationalMissionEvidence({inbox:store,evidenceStore:evidenceStore(),mission_run_id:'run-1',evidence_key:`sha256:${'d'.repeat(64)}`});
  assert.equal(result.ok,false);assert.equal(result.reason,'mission_reauth_evidence_binding_mismatch');assert.equal(store.record.status,'awaiting_human_reauth');
});

test('ready mission cannot consume or replace evidence again',async()=>{
  const store=inbox('ready_for_tty');store.record.reauth_challenge_id=challenge().challenge_id;store.record.reauth_action_digest=challenge().action_digest;
  const result=await bindOperationalMissionEvidence({inbox:store,evidenceStore:evidenceStore(),mission_run_id:'run-1',evidence_key:`sha256:${'d'.repeat(64)}`});
  assert.equal(result.ok,false);assert.equal(result.reason,'mission_must_be_awaiting_human_reauth');
});

function readyGithubMission() {
  const store=inbox('ready_for_tty');
  const oldChallenge=`sha256:${'b'.repeat(64)}`;
  const oldAction=`sha256:${'c'.repeat(64)}`;
  const evidenceKey=`sha256:${'d'.repeat(64)}`;
  store.record.mission_id='6ad02b16cdd1db9ef55927ca';
  store.record.mission_run_id='6ad02b2e45e512d3aeb9199a';
  store.record.contract_hash='sha256:3b159a5d39a035aa2f0668e073c1e26175ebfbe99389b7a417c01581a5557dd2';
  store.record.target_origin='https://api.github.com';
  store.record.target_path='/';
  store.record.reauth_challenge_id=oldChallenge;
  store.record.reauth_action_digest=oldAction;
  store.record.evidence_key=evidenceKey;
  store.record.execution_id=null;
  store.record.request_id=null;
  store.record.result_digest=null;
  store.record.result_summary=null;
  store.record.cost_units=0;
  store.record.callback_state='not_ready';
  store.record.callback_attempts=0;
  store.record.completed_at=null;
  store.record.acknowledged_at=null;
  store.record.trial_config={
    environment:'staging', maximum_requests:1, operator_id:'human:owner', workspace_type:'corporate',
    operation:'fetch_public_metadata', source_type:'public_documentation_page', requested_content_types:['application/json'],
    timeout_ms:5000, maximum_response_bytes:100000, target_origin:'https://api.github.com', target_path:'/'
  };
  return {store,evidenceKey,oldChallenge,oldAction};
}

function githubEvidence({evidenceKey,oldChallenge,oldAction,verified_at='2026-10-15T16:14:51.000Z',overrides={}}={}) {
  let reads=0;
  return {
    get reads(){return reads;},
    async readVerified(key){
      reads+=1;
      assert.equal(key,evidenceKey);
      return {ok:true,durable:true,single_use:true,evidence_key:evidenceKey,challenge_id:oldChallenge,action_digest:oldAction,subject_id:'human:owner',verified_at,...overrides};
    }
  };
}

test('stale reauth for the exact GitHub metadata MissionRun refreshes the same mission without execution side effects',async()=>{
  const {store,evidenceKey,oldChallenge,oldAction}=readyGithubMission();
  const evidence=githubEvidence({evidenceKey,oldChallenge,oldAction});
  let challenges=0;
  const freshChallenge=challenge({
    challenge_id:`sha256:${'e'.repeat(64)}`,
    action_digest:`sha256:${'f'.repeat(64)}`,
    delivery_reference:'delivery-refresh-1',
    issued_at:'2026-10-15T16:25:00.001Z'
  });
  const result=await refreshOperationalMissionReauth({
    inbox:store,evidenceStore:evidence,mission_run_id:'6ad02b2e45e512d3aeb9199a',clock:()=> '2026-10-15T16:25:00.001Z',
    challengeFactory:async input=>{
      challenges+=1;
      assert.equal(input.target_origin,'https://api.github.com');
      assert.equal(input.target_path,'/');
      assert.equal(input.mission_id,'6ad02b16cdd1db9ef55927ca');
      assert.equal(input.contract_hash,'sha256:3b159a5d39a035aa2f0668e073c1e26175ebfbe99389b7a417c01581a5557dd2');
      return freshChallenge;
    }
  });
  assert.equal(result.ok,true);
  assert.equal(result.status,'PUBLIC_WEB_OPERATIONAL_MISSION_REAUTH_REFRESHED_AWAITING_HUMAN_REAUTH');
  assert.equal(challenges,1);
  assert.equal(evidence.reads,1);
  assert.equal(store.record.status,'awaiting_human_reauth');
  assert.equal(store.record.evidence_key,null);
  assert.equal(store.record.reauth_challenge_id,freshChallenge.challenge_id);
  assert.equal(store.record.reauth_action_digest,freshChallenge.action_digest);
  assert.equal(store.record.execution_id,null);
  assert.equal(store.record.request_id,null);
  assert.equal(result.execution_started,false);
  assert.equal(result.external_network_called,false);
  assert.equal(result.production_allowed,false);
  assert.deepEqual(store.transitions.map(x=>[x.expected_status,x.next_status]),[['ready_for_tty','preparing'],['preparing','awaiting_human_reauth']]);
});

test('fresh reauth cannot be refreshed early and mints no challenge',async()=>{
  const {store,evidenceKey,oldChallenge,oldAction}=readyGithubMission();
  const evidence=githubEvidence({evidenceKey,oldChallenge,oldAction,verified_at:'2026-10-15T16:20:00.000Z'});
  let challenges=0;
  const result=await refreshOperationalMissionReauth({inbox:store,evidenceStore:evidence,mission_run_id:store.record.mission_run_id,clock:()=> '2026-10-15T16:30:00.000Z',challengeFactory:async()=>{challenges+=1;return challenge();}});
  assert.equal(result.ok,false);
  assert.equal(result.reason,'mission_reauth_evidence_still_fresh');
  assert.equal(result.evidence_age_ms,MAX_REAUTH_EVIDENCE_AGE_MS);
  assert.equal(challenges,0);
  assert.equal(store.record.status,'ready_for_tty');
  assert.equal(store.transitions.length,0);
});

test('reauth refresh fails closed when execution identity already exists',async()=>{
  const {store,evidenceKey,oldChallenge,oldAction}=readyGithubMission();
  store.record.execution_id='execution-already-materialized';
  const evidence=githubEvidence({evidenceKey,oldChallenge,oldAction});
  let challenges=0;
  const result=await refreshOperationalMissionReauth({inbox:store,evidenceStore:evidence,mission_run_id:store.record.mission_run_id,clock:()=> '2026-10-15T16:30:00.000Z',challengeFactory:async()=>{challenges+=1;return challenge();}});
  assert.equal(result.ok,false);
  assert.equal(result.reason,'mission_execution_artifacts_present');
  assert.equal(evidence.reads,0);
  assert.equal(challenges,0);
  assert.equal(store.transitions.length,0);
});

test('reauth refresh rejects stale evidence that is not bound to the same durable mission',async()=>{
  const {store,evidenceKey,oldChallenge,oldAction}=readyGithubMission();
  const evidence=githubEvidence({evidenceKey,oldChallenge,oldAction,overrides:{action_digest:`sha256:${'9'.repeat(64)}`}});
  let challenges=0;
  const result=await refreshOperationalMissionReauth({inbox:store,evidenceStore:evidence,mission_run_id:store.record.mission_run_id,clock:()=> '2026-10-15T16:30:00.000Z',challengeFactory:async()=>{challenges+=1;return challenge();}});
  assert.equal(result.ok,false);
  assert.equal(result.reason,'mission_reauth_evidence_binding_mismatch');
  assert.equal(challenges,0);
  assert.equal(store.transitions.length,0);
});

test('refresh challenge failure restores ready_for_tty with the old stale binding and no execution',async()=>{
  const {store,evidenceKey,oldChallenge,oldAction}=readyGithubMission();
  const evidence=githubEvidence({evidenceKey,oldChallenge,oldAction});
  const result=await refreshOperationalMissionReauth({inbox:store,evidenceStore:evidence,mission_run_id:store.record.mission_run_id,clock:()=> '2026-10-15T16:30:00.000Z',challengeFactory:async()=>{throw new Error('provider unavailable');}});
  assert.equal(result.ok,false);
  assert.equal(result.reason,'reauth_refresh_challenge_preparation_failed');
  assert.equal(store.record.status,'ready_for_tty');
  assert.equal(store.record.evidence_key,evidenceKey);
  assert.equal(store.record.reauth_challenge_id,oldChallenge);
  assert.equal(store.record.execution_id,null);
  assert.equal(store.record.request_id,null);
  assert.equal(result.external_network_called,false);
  assert.deepEqual(store.transitions.map(x=>[x.expected_status,x.next_status]),[['ready_for_tty','preparing'],['preparing','ready_for_tty']]);
});
