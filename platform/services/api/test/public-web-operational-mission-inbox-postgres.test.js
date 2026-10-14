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

test('postgres inbox reads by run and applies compare-and-set lifecycle transition',async()=>{
  let current=rowFrom(record()); const calls=[];
  const pool={
    async query(sql,params){
      calls.push({sql,params});
      if(sql.includes('to_regclass')) return {rows:[{table_exists:true}]};
      if(sql.startsWith('SELECT *')) return {rows:current?[current]:[]};
      if(sql.startsWith('UPDATE')) {
        if(current && current.mission_run_id===params[0] && current.status===params[1]) {
          current={...current,status:params[2],updated_at:'2026-10-14T21:01:00.000Z'};
          return {rows:[current]};
        }
        return {rows:[]};
      }
      throw new Error('unexpected query');
    },
    async connect(){throw new Error('not used');}
  };
  const inbox=createPublicWebOperationalMissionInboxPostgres({pool});
  const found=await inbox.getByRun('run-1'); assert.equal(found.ok,true); assert.equal(found.record.status,'accepted');
  const moved=await inbox.transition({mission_run_id:'run-1',expected_status:'accepted',next_status:'preparing'});
  assert.equal(moved.ok,true); assert.equal(moved.record.status,'preparing');
  const stale=await inbox.transition({mission_run_id:'run-1',expected_status:'accepted',next_status:'preparing'});
  assert.equal(stale.ok,false); assert.equal(stale.status,'CONFLICT'); assert.equal(stale.current_status,'preparing');
});

test('postgres inbox lifecycle patches are whitelisted before SQL construction',async()=>{
  const pool={async query(sql){if(sql.includes('to_regclass')) return {rows:[{table_exists:true}]}; throw new Error('must not mutate');},async connect(){throw new Error('not used');}};
  const inbox=createPublicWebOperationalMissionInboxPostgres({pool});
  const result=await inbox.transition({mission_run_id:'run-1',expected_status:'accepted',next_status:'preparing',patch:{tenant_id:'other'}});
  assert.equal(result.ok,false); assert.equal(result.status,'INVALID'); assert.match(result.reason,/patch_field_forbidden/);
});
