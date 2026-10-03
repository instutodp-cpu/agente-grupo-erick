'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const test=require('node:test');
const {Pool}=require('pg');
const {buildAccountingRuntimeHandoff,admitAccountingRuntime}=require('../src/accounting-runtime-integration');
const URL=process.env.HERMES_POSTGRES_TEST_DATABASE_URL;
function safe(v){try{const u=new global.URL(v);return ['127.0.0.1','localhost','::1'].includes(u.hostname)&&/^hermes_test(?:_[a-z0-9_-]+)?$/i.test(decodeURIComponent(u.pathname.slice(1)));}catch{return false;}}
const enabled=safe(URL);
async function migrate(pool){
 for(const name of ['003_create_execution_jobs.sql','004_create_execution_attempts.sql','029_create_accounting_operational_bindings.sql']){
  await pool.query(fs.readFileSync(path.resolve(__dirname,'../../../migrations/hermes',name),'utf8'));
 }
}
function h(key='idem-1'){return buildAccountingRuntimeHandoff({handoffId:'c26-h1',tenantId:'tenant-c26',organizationId:'org-c26',projectId:'accounting',sessionReferenceId:'period-2026-10',actorId:'human-c26',operationId:'op-'+key,capability:'FINANCIAL_EXECUTION',idempotencyKey:key,mode:'SHADOW'});}
test('C26 postgres persists accounting capability defaults fail closed and durable idempotency', {skip:!enabled},async()=>{
 const pool=new Pool({connectionString:URL});try{await migrate(pool);
  await pool.query("DELETE FROM hermes.accounting_execution_bindings WHERE tenant_id='tenant-c26'");
  await pool.query("DELETE FROM hermes.accounting_capability_flags WHERE tenant_id='tenant-c26'");
  await pool.query("INSERT INTO hermes.accounting_capability_flags(tenant_id,capability,version,updated_by) VALUES('tenant-c26','FINANCIAL_EXECUTION',1,'c26-test')");
  const flag=(await pool.query("SELECT enabled,real_provider_enabled FROM hermes.accounting_capability_flags WHERE tenant_id='tenant-c26'")).rows[0];
  assert.deepEqual(flag,{enabled:false,real_provider_enabled:false});
  const fakeJob='c26-job-'+Date.now();
  await pool.query(`INSERT INTO hermes.execution_jobs(job_reference_id,tenant_id,organization_id,project_id,session_reference_id,agent_id,actor_id,logical_identity_digest,idempotency_fingerprint,record_fingerprint,record_digest,admission_reference_id,revision,state,contract_version,schema_version,durable_record)
 VALUES($1,'tenant-c26','org-c26','accounting','period-2026-10','accounting','human-c26','logical-c26','runtime-idem-c26','fp-c26','digest-c26','admission-c26',1,'MATERIALIZED','test-v1',3,'{}'::jsonb)`,[fakeJob]);
  await pool.query("INSERT INTO hermes.accounting_execution_bindings(binding_id,tenant_id,capability,operation_id,idempotency_key,execution_job_reference_id) VALUES('b1','tenant-c26','FINANCIAL_EXECUTION','op1','accounting-idem-c26',$1)",[fakeJob]);
  await assert.rejects(pool.query("INSERT INTO hermes.accounting_execution_bindings(binding_id,tenant_id,capability,operation_id,idempotency_key,execution_job_reference_id) VALUES('b2','tenant-c26','FINANCIAL_EXECUTION','op2','accounting-idem-c26',$1)",[fakeJob]),e=>e.code==='23505');
 }finally{await pool.end();}
});
test('C26 runtime handoff traverses canonical admission interface and remains zero-effect',async()=>{
 const calls=[];const runtime={admitExecutionJob:async()=>{calls.push('job');return{outcome:'ADMITTED'};},materializeExecutionAttempt:async()=>{calls.push('attempt');return{id:'a'};},admitExecutionAttempt:async()=>{calls.push('admit');return{outcome:'ADMITTED'};}};
 const r=await admitAccountingRuntime({handoff:h(),runtime});assert.deepEqual(calls,['job','attempt','admit']);assert.equal(r.executed,false);assert.equal(r.externalEffectAllowed,false);assert.equal(r.status,'ADMITTED_SIMULATION');
});
