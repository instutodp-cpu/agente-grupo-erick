'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createPostgresComposioOutlookAudit,
  ROLE_SQL,LOCK_SQL,COUNT_SQL,INSERT_ATTEMPT_SQL,INSERT_RESULT_SQL,TABLE}=
  require('../src/adapters/postgres/composio-outlook-metadata-audit-postgres');

class ScriptedPool {
  constructor({failAt=null}={}) {
    this.events=[];this.queries=[];this.releases=0;this.failAt=failAt;
  }
  async connect(){
    return {
      query:async (sql,params=[])=>{
        this.queries.push({sql,params});
        if(sql===this.failAt)throw Error('simulated database outage');
        if(['BEGIN','COMMIT','ROLLBACK',ROLE_SQL,LOCK_SQL].includes(sql))return {rows:[]};
        if(sql===COUNT_SQL)
          return {rows:[{attempts:this.events.filter(e=>e.type==='attempt').length}]};
        if(sql===INSERT_ATTEMPT_SQL||sql===INSERT_RESULT_SQL) {
          const type=sql===INSERT_ATTEMPT_SQL?'attempt':'result';
          const trace_id=params[1];
          if(this.events.some(e=>e.type===type&&e.trace_id===trace_id) ||
            (type==='result'&&!this.events.some(e=>e.type==='attempt'&&
              e.trace_id===trace_id&&e.user_id===params[2])))
            return {rowCount:0,rows:[]};
          this.events.push({type,trace_id,user_id:params[2],
            outcome:type==='result'?params[3]:null,
            sampled_messages:type==='result'?params[4]:null});
          return {rowCount:1,rows:[{event_id:params[0]}]};
        }
        throw Error('unexpected SQL');
      },
      release:()=>{this.releases++;}
    };
  }
}
test('migration is append-only, RLS protected, group-scoped, no secrets',()=>{
  const sql=fs.readFileSync(path.resolve(__dirname,
    '../../../migrations/hermes/051_create_composio_outlook_metadata_audit.sql'),'utf8');
  assert.match(sql,/CREATE TABLE IF NOT EXISTS hermes\.composio_outlook_metadata_audit/);
  assert.match(sql,/tenant_id = 'grupo_erick'/);
  assert.match(sql,/scope_type = 'group_shared'/);
  assert.match(sql,/UNIQUE \(trace_id, event_type\)/);
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/REVOKE ALL.*\n\s*FROM PUBLIC, anon, authenticated/);
  assert.match(sql,/BEFORE UPDATE/);
  assert.match(sql,/BEFORE DELETE/);
  assert.doesNotMatch(sql,/password\s*=|ck_[a-zA-Z0-9]{20,}|postgres(?:ql)?:\/\//i);
  assert.equal(TABLE,'hermes.composio_outlook_metadata_audit');
});
test('atomic reservation persists attempt before outcome',async()=>{
  const pool=new ScriptedPool();
  const audit=createPostgresComposioOutlookAudit({pool});
  const trace_id=randomUUID();
  const reserved=await audit.reserveAttempt({trace_id,user_id:'owner-fixture'});
  assert.deepEqual(reserved,{reserved:true,trace_id});
  assert.equal(pool.events.length,1);
  assert.equal(pool.events[0].type,'attempt');
  assert.deepEqual(pool.queries.slice(0,5).map(q=>q.sql),
    ['BEGIN',ROLE_SQL,LOCK_SQL,COUNT_SQL,INSERT_ATTEMPT_SQL]);
  assert.equal(pool.queries[5].sql,'COMMIT');
  const outcome=await audit.appendOutcome({
    trace_id,user_id:'owner-fixture',outcome:'SUCCEEDED',sampled_messages:2});
  assert.deepEqual(outcome,{persisted:true,trace_id});
  assert.equal(pool.events.length,2);
  assert.equal(pool.events[1].outcome,'SUCCEEDED');
  assert.equal(pool.releases,2);
});
test('shared group budget blocks eleventh request and never partitions by company',async()=>{
  const pool=new ScriptedPool();
  const audit=createPostgresComposioOutlookAudit({pool});
  for(let i=0;i<10;i++) {
    const r=await audit.reserveAttempt({trace_id:randomUUID(),
      user_id:'owner-fixture',max_requests:10});
    assert.equal(r.reserved,true);
  }
  const last=await audit.reserveAttempt({trace_id:randomUUID(),
    user_id:'owner-fixture',max_requests:10});
  assert.deepEqual(last,{reserved:false,reason:'request_budget_exhausted'});
  assert.equal(pool.events.length,10);
  assert.equal(pool.queries.at(-1).sql,'ROLLBACK');
  assert.equal(pool.queries.filter(q=>q.sql===LOCK_SQL).length,11);
  assert.ok(!COUNT_SQL.includes('company_id'));
  assert.ok(!COUNT_SQL.includes('store_id'));
});
test('duplicate reservation and duplicate result are rejected',async()=>{
  const pool=new ScriptedPool();
  const audit=createPostgresComposioOutlookAudit({pool});
  const trace_id=randomUUID();
  await audit.reserveAttempt({trace_id,user_id:'owner-fixture'});
  await assert.rejects(()=>audit.reserveAttempt({trace_id,user_id:'owner-fixture'}));
  assert.equal(pool.queries.at(-1).sql,'ROLLBACK');
  await audit.appendOutcome({trace_id,user_id:'owner-fixture',
    outcome:'FAILED',sampled_messages:null});
  await assert.rejects(()=>audit.appendOutcome({trace_id,
    user_id:'owner-fixture',outcome:'FAILED'}));
  assert.equal(pool.events.length,2);
});
test('outcome without matching attempt and owner is blocked',async()=>{
  const pool=new ScriptedPool();
  const audit=createPostgresComposioOutlookAudit({pool});
  const trace_id=randomUUID();
  await assert.rejects(()=>audit.appendOutcome({trace_id,
    user_id:'owner-fixture',outcome:'FAILED'}));
  await audit.reserveAttempt({trace_id,user_id:'owner-fixture'});
  await assert.rejects(()=>audit.appendOutcome({trace_id,
    user_id:'another-owner',outcome:'FAILED'}));
  assert.equal(pool.events.length,1);
});
test('ungranted restricted role fails closed before any audit SQL',async()=>{
  const pool=new ScriptedPool({failAt:ROLE_SQL});
  const audit=createPostgresComposioOutlookAudit({pool});
  await assert.rejects(()=>audit.reserveAttempt({trace_id:randomUUID(),
    user_id:'owner-fixture'}));
  assert.deepEqual(pool.queries.map(q=>q.sql),['BEGIN',ROLE_SQL,'ROLLBACK']);
  assert.equal(pool.events.length,0);
  assert.equal(pool.releases,1);
  await assert.rejects(()=>audit.appendOutcome({trace_id:randomUUID(),
    user_id:'owner-fixture',outcome:'FAILED'}));
  assert.deepEqual(pool.queries.slice(3).map(q=>q.sql),
    ['BEGIN',ROLE_SQL,'ROLLBACK']);
  assert.equal(pool.events.length,0);
});
test('database outage fails closed, rolls back and releases connection',async()=>{
  const pool=new ScriptedPool({failAt:COUNT_SQL});
  const audit=createPostgresComposioOutlookAudit({pool});
  await assert.rejects(()=>audit.reserveAttempt({trace_id:randomUUID(),
    user_id:'owner-fixture'}));
  assert.equal(pool.queries.at(-1).sql,'ROLLBACK');
  assert.equal(pool.releases,1);
  assert.equal(pool.events.length,0);
});
test('invalid identity, count and outcomes cannot reach database',async()=>{
  const pool=new ScriptedPool();
  const audit=createPostgresComposioOutlookAudit({pool});
  await assert.rejects(()=>audit.reserveAttempt({
    trace_id:'not-uuid',user_id:'owner-fixture'}));
  await assert.rejects(()=>audit.reserveAttempt({
    trace_id:randomUUID(),user_id:'other company with spaces'}));
  await assert.rejects(()=>audit.reserveAttempt({
    trace_id:randomUUID(),user_id:'owner-fixture',max_requests:100}));
  await assert.rejects(()=>audit.appendOutcome({trace_id:randomUUID(),
    user_id:'owner-fixture',outcome:'SUCCEEDED',sampled_messages:11}));
  await assert.rejects(()=>audit.appendOutcome({trace_id:randomUUID(),
    user_id:'owner-fixture',outcome:'FAILED',sampled_messages:1}));
  assert.equal(pool.queries.length,0);
});
