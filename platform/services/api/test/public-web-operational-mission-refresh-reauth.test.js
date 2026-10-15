'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {main}=require('../scripts/public-web-operational-mission-refresh-reauth');

function runtime(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hermes-refresh-reauth-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const ca=path.join(dir,'ca.pem');
  fs.writeFileSync(ca,'-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n');
  return {
    HERMES_OPERATIONAL_MISSION_RUN_ID:'6ad02b2e45e512d3aeb9199a',
    POSTGRES_HOST:'db.vvzvqinbzdqzcwrfoomd.supabase.co',POSTGRES_PORT:'5432',POSTGRES_USER:'postgres',POSTGRES_PASSWORD:'not-a-real-secret',POSTGRES_DB:'postgres',HERMES_STAGING_CA_FILE:ca
  };
}

function durableInbox(){
  let record={
    mission_id:'6ad02b16cdd1db9ef55927ca',mission_run_id:'6ad02b2e45e512d3aeb9199a',contract_hash:'sha256:3b159a5d39a035aa2f0668e073c1e26175ebfbe99389b7a417c01581a5557dd2',
    target_origin:'https://api.github.com',target_path:'/',status:'ready_for_tty',
    reauth_challenge_id:`sha256:${'b'.repeat(64)}`,reauth_action_digest:`sha256:${'c'.repeat(64)}`,evidence_key:`sha256:${'d'.repeat(64)}`,
    execution_id:null,request_id:null,result_digest:null,result_summary:null,cost_units:0,callback_state:'not_ready',callback_attempts:0,completed_at:null,acknowledged_at:null,
    trial_config:{environment:'staging',maximum_requests:1,operator_id:'human:owner',workspace_type:'corporate',operation:'fetch_public_metadata',source_type:'public_documentation_page',requested_content_types:['application/json'],timeout_ms:5000,maximum_response_bytes:100000}
  };
  return {
    get record(){return record;},
    async getByRun(id){return id===record.mission_run_id?{ok:true,record}:{ok:false,reason:'mission_not_found'};},
    async transition(input){if(record.status!==input.expected_status)return {ok:false,reason:'mission_status_changed',current_status:record.status};record={...record,status:input.next_status,...input.patch};return {ok:true,record};}
  };
}

test('refresh CLI wires the exact durable GitHub mission to a fresh challenge without DNS/HTTP execution',async t=>{
  const store=durableInbox();
  let poolEnded=0,challengeCalls=0,networkCalls=0;
  class Pool { constructor(config){assert.equal(config.ssl.rejectUnauthorized,true);} async end(){poolEnded+=1;} }
  const result=await main({
    environment:runtime(t),PoolClass:Pool,argv:[],clock:()=> '2026-10-15T16:30:00.000Z',
    inboxFactory:()=>store,
    evidenceStoreFactory:()=>({async readVerified(key){assert.equal(key,`sha256:${'d'.repeat(64)}`);return {ok:true,durable:true,single_use:true,evidence_key:key,challenge_id:`sha256:${'b'.repeat(64)}`,action_digest:`sha256:${'c'.repeat(64)}`,subject_id:'human:owner',verified_at:'2026-10-15T16:14:51.000Z'};}}),
    challengeFactory:async({env})=>{challengeCalls+=1;assert.equal(env.HERMES_REAUTH_TARGET_ORIGIN,'https://api.github.com');assert.equal(env.HERMES_REAUTH_TARGET_PATH,'/');return {ok:true,status:'EMAIL_REAUTH_OPERATIONAL_CHALLENGE_READY',challenge_id:`sha256:${'e'.repeat(64)}`,action_digest:`sha256:${'f'.repeat(64)}`,delivery_reference:'delivery-refresh',identity_alias:'owner-primary-email',issued_at:'2026-10-15T16:30:00.000Z',ttl_seconds:600,execution_authorized:false,production_allowed:false};}
  });
  assert.equal(result.ok,true);
  assert.equal(result.status,'PUBLIC_WEB_OPERATIONAL_MISSION_REAUTH_REFRESHED_AWAITING_HUMAN_REAUTH');
  assert.equal(store.record.status,'awaiting_human_reauth');
  assert.equal(store.record.evidence_key,null);
  assert.equal(challengeCalls,1);
  assert.equal(networkCalls,0);
  assert.equal(poolEnded,1);
  assert.equal(result.execution_started,false);
  assert.equal(result.external_network_called,false);
});

test('refresh CLI accepts no positional target or mission override',async()=>{
  await assert.rejects(()=>main({environment:{},argv:['https://attacker.example']}),/arguments_not_allowed/);
});
