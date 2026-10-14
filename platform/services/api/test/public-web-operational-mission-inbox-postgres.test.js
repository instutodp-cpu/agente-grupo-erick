'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const { createPublicWebOperationalMissionInboxPostgres } = require('../src/adapters/postgres/public-web-operational-mission-inbox-postgres');

function record(overrides={}) { return {
  inbox_id:'inbox-1',contract_version:'public_web_operational_mission_inbox_v1',mission_id:'mission-1',mission_run_id:'run-1',tenant_id:'grupo_erick',workspace_id:'workspace-1',workspace_type:'corporate',principal_id:'maestro-control-plane',idempotency_key:'idem-1',correlation_id:'corr-1',contract_hash:`sha256:${'a'.repeat(64)}`,dispatch_token_digest:`sha256:${'b'.repeat(64)}`,target_origin:'https://example.com',target_path:'/docs',mission_payload:{mission_run_id:'run-1',contract_hash:`sha256:${'a'.repeat(64)}`},trial_config:{environment:'staging',tenant_id:'grupo_erick',workspace_type:'corporate',maximum_requests:1},status:'accepted',received_at:'2026-10-14T21:00:00.000Z',...overrides
}; }
function rowFrom(r){return {...r,mission_payload:r.mission_payload,trial_config:r.trial_config};}
function fakePool(mode='inserted', existing=null){
  const calls=[];
  const client={
    async query(sql,params){calls.push({sql,params}); if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK') return {rows:[]}; if(sql.startsWith('INSERT INTO')) return {rows: mode==='inserted'?[rowFrom(record())]:[]}; if(sql.startsWith('SELECT *')) return {rows: existing?[existing]:[]}; throw new Error('unexpected client query');},
    release(){calls.push({release:true});}
  };
  return {calls,async query(sql){calls.push({sql}); if(sql.includes('to_regclass')) return {rows:[{table_exists:true}]}; throw new Error('unexpected pool query');},async connect(){return client;}};
}

test('postgres inbox inserts once and returns durable receipt shape',async()=>{
  const pool=fakePool('inserted'); const inbox=createPublicWebOperationalMissionInboxPostgres({pool}); const result=await inbox.admit(record());
  assert.deepEqual(result,{ok:true,status:'INSERTED',inbox_id:'inbox-1'}); assert.ok(pool.calls.some(c=>c.sql==='COMMIT'));
});

test('postgres inbox treats exact duplicate as idempotent replay',async()=>{
  const existing=rowFrom(record()); const pool=fakePool('replay',existing); const inbox=createPublicWebOperationalMissionInboxPostgres({pool}); const result=await inbox.admit(record());
  assert.deepEqual(result,{ok:true,status:'IDEMPOTENT_REPLAY',inbox_id:'inbox-1'});
});

test('postgres inbox rejects same run or idempotency identity with divergent contract',async()=>{
  const existing=rowFrom(record({contract_hash:`sha256:${'c'.repeat(64)}`})); const pool=fakePool('replay',existing); const inbox=createPublicWebOperationalMissionInboxPostgres({pool}); const result=await inbox.admit(record());
  assert.equal(result.ok,false); assert.equal(result.status,'CONFLICT'); assert.ok(pool.calls.some(c=>c.sql==='ROLLBACK'));
});

test('postgres inbox fails closed when durable schema is not ready',async()=>{
  const pool={async query(){return {rows:[{table_exists:false}]};},async connect(){throw new Error('must not connect');}}; const inbox=createPublicWebOperationalMissionInboxPostgres({pool}); const result=await inbox.admit(record());
  assert.equal(result.ok,false); assert.equal(result.status,'NOT_READY');
});
