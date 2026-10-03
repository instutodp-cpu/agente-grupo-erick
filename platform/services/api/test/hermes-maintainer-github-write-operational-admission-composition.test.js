'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHermesMaintainerGithubWriteOperationalAdmissionComposition}=require('../src/runtime/hermes-maintainer-github-write-operational-admission-composition');

const digest='sha256:'+'1'.repeat(64);
const sha='a'.repeat(40);
const branch='hermes/canary/operational-admission';
function grant(){return {contract_version:'hermes_maintainer_scm_write_authorization_grant_v1',status:'SCM_WRITE_AUTHORIZATION_GRANTED',authorization_valid:true,intent_digest:digest,operation:'create_branch',repository:'instutodp-cpu/agente-grupo-erick',base_ref:'main',branch_name:branch,approval_reference:'approval-1',authorization_reference:'auth-1',human_approval_present:true,execution_authorized:true,authorization_consumed:false,credential_material_present:false,network_call_performed:false,write_performed:false,production_used:false,blockers:[]};}
function canary(){return {contract_version:'hermes_maintainer_github_write_canary_contract_v1',status:'CANARY_PREPARED',canary_valid:true,provider:'GITHUB',environment:'staging',repository:'instutodp-cpu/agente-grupo-erick',operation:'create_branch',ref:'refs/heads/'+branch,sha,credential_material_present:false,execution_authorized:false,network_call_performed:false,write_performed:false,production_used:false};}
function input(){return {consumption_reference:'consume-1',attempt_reference:'attempt-1',capability_reference:'capability-1',admission_reference:'admission-1'};}
function pool(){
 const rows=new Map();
 const client={async query(sql,args){
  if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};
  const table=sql.includes('attempt_ownership')?'ownership':'consumption';
  const key=args[0];if(sql.startsWith('SELECT ')){const row=rows.get(table+':'+key);return {rows:row?[row]:[]};}
  if(rows.has(table+':'+key))return {rows:[]};
  if(table==='ownership')rows.set(table+':'+key,{ownership_key:args[0],persistence_key:args[1],intent_digest:args[2],authorization_reference:args[3],consumption_reference:args[4],attempt_reference:args[5]});
  else rows.set(table+':'+key,{persistence_key:args[0],intent_digest:args[1],authorization_reference:args[2],consumption_reference:args[3]});
  return {rows:[rows.get(table+':'+key)]};
 },release(){}};
 return {connect:async()=>client,async query(sql,args){const table=sql.includes('attempt_ownership')?'ownership':'consumption';const row=rows.get(table+':'+args[0]);return {rows:row?[row]:[]};}};
}

test('builds an official durable #330 admission without network or provider write',async()=>{
 const composition=createHermesMaintainerGithubWriteOperationalAdmissionComposition({pool:pool()});
 const out=await composition.prepare(grant(),canary(),input());
 assert.equal(out.contract_version,'hermes_maintainer_github_durable_write_admission_v1');
 assert.equal(out.status,'GITHUB_DURABLE_WRITE_REQUEST_ADMITTED');
 assert.equal(out.admission_valid,true);
 assert.equal(out.execution_authorized,true);
 assert.equal(out.ownership_source,'DURABLE_PERSISTENCE_RECEIPT');
 assert.equal(out.request.body.ref,'refs/heads/'+branch);
 assert.equal(out.request.body.sha,sha);
 assert.equal(out.network_call_performed,false);
 assert.equal(out.write_performed,false);
 assert.equal(out.production_used,false);
});

test('durable consumption makes replay fail closed even though operational composition owns already_consumed=false',async()=>{
 const composition=createHermesMaintainerGithubWriteOperationalAdmissionComposition({pool:pool()});
 const first=await composition.prepare(grant(),canary(),input());
 const replay=await composition.prepare(grant(),canary(),input());
 assert.equal(first.admission_valid,true);
 assert.equal(replay.status,'OPERATIONAL_ADMISSION_BLOCKED');
 assert.deepEqual(replay.blockers,['DURABLE_CONSUMPTION_EXISTS']);
 assert.equal(replay.execution_authorized,false);
 assert.equal(replay.network_call_performed,false);
 assert.equal(replay.write_performed,false);
});

test('rejects grant/canary scope mismatch before durable persistence',async()=>{
 const bad={...grant(),branch_name:'hermes/canary/other'};
 const out=await createHermesMaintainerGithubWriteOperationalAdmissionComposition({pool:pool()}).prepare(bad,canary(),input());
 assert.equal(out.status,'OPERATIONAL_ADMISSION_BLOCKED');
 assert.deepEqual(out.blockers,['AUTHORIZATION_GRANT_SCOPE_INVALID']);
});

test('requires exact operational reference fields',async()=>{
 const out=await createHermesMaintainerGithubWriteOperationalAdmissionComposition({pool:pool()}).prepare(grant(),canary(),{...input(),already_consumed:false});
 assert.equal(out.status,'OPERATIONAL_ADMISSION_BLOCKED');
 assert.deepEqual(out.blockers,['OPERATIONAL_INPUT_INVALID']);
});

test('requires injected Postgres pool and never constructs process or GitHub runtime dependencies',()=>{
 assert.throws(()=>createHermesMaintainerGithubWriteOperationalAdmissionComposition(),/postgres_pool_required/);
});
