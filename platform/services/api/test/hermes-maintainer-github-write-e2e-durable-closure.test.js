'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHermesMaintainerGithubWriteE2eDurableClosure}=require('../src/runtime/hermes-maintainer-github-write-e2e-durable-closure');

const digest='sha256:'+'7'.repeat(64),sha='c'.repeat(40),branch='hermes/canary/e2e-durable-closure';
function grant(){return {contract_version:'hermes_maintainer_scm_write_authorization_grant_v1',status:'SCM_WRITE_AUTHORIZATION_GRANTED',authorization_valid:true,intent_digest:digest,operation:'create_branch',repository:'instutodp-cpu/agente-grupo-erick',base_ref:'main',branch_name:branch,approval_reference:'approval-e2e',authorization_reference:'auth-e2e',human_approval_present:true,execution_authorized:true,authorization_consumed:false,credential_material_present:false,network_call_performed:false,write_performed:false,production_used:false,blockers:[]};}
function canary(){return {contract_version:'hermes_maintainer_github_write_canary_contract_v1',status:'CANARY_PREPARED',canary_valid:true,provider:'GITHUB',environment:'staging',repository:'instutodp-cpu/agente-grupo-erick',operation:'create_branch',ref:'refs/heads/'+branch,sha,credential_material_present:false,execution_authorized:false,network_call_performed:false,write_performed:false,production_used:false};}
function input(){return {consumption_reference:'consume-e2e',attempt_reference:'attempt-e2e',capability_reference:'cap-e2e',admission_reference:'admission-e2e'};}
function pool(){
 const rows=new Map();
 const client={async query(sql,args){if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};let table;if(sql.includes('write_finalization'))table='finalization';else if(sql.includes('execution_outcome'))table='outcome';else if(sql.includes('attempt_ownership'))table='ownership';else table='consumption';const key=args[0];if(sql.startsWith('SELECT ')){const row=rows.get(table+':'+key);return {rows:row?[row]:[]};}if(rows.has(table+':'+key))return {rows:[]};let row;if(table==='finalization')row={finalization_key:args[0],finalization_digest:args[1],outcome_digest:args[2],intent_digest:args[3],attempt_reference:args[4],admission_reference:args[5],repository:args[6],operation:args[7],ref:args[8],sha:args[9],provider_status:args[10]};else if(table==='outcome')row={outcome_key:args[0],outcome_digest:args[1],intent_digest:args[2],attempt_reference:args[3],admission_reference:args[4],repository:args[5],operation:args[6],ref:args[7],sha:args[8],provider_status:args[9]};else if(table==='ownership')row={ownership_key:args[0],persistence_key:args[1],intent_digest:args[2],authorization_reference:args[3],consumption_reference:args[4],attempt_reference:args[5]};else row={persistence_key:args[0],intent_digest:args[1],authorization_reference:args[2],consumption_reference:args[3]};rows.set(table+':'+key,row);return {rows:[row]};},release(){}};
 return {connect:async()=>client,async query(sql,args){let table;if(sql.includes('write_finalization'))table='finalization';else if(sql.includes('execution_outcome'))table='outcome';else if(sql.includes('attempt_ownership'))table='ownership';else table='consumption';const row=rows.get(table+':'+args[0]);return {rows:row?[row]:[]};}};
}

test('closes the official durable write chain end to end while preserving admission identity',async()=>{
 let fetchCalls=0,body;
 const out=await createHermesMaintainerGithubWriteE2eDurableClosure({pool:pool(),environment:{HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'synthetic-token'},fetchImpl:async(_url,options)=>{fetchCalls++;body=JSON.parse(options.body);return {status:201};},createTimeoutSignal:()=>new AbortController().signal}).execute(grant(),canary(),input());
 assert.equal(fetchCalls,1);assert.deepEqual(body,{ref:'refs/heads/'+branch,sha});
 assert.equal(out.status,'E2E_DURABLE_WRITE_CLOSURE_CONFIRMED');assert.equal(out.closure_valid,true);assert.equal(out.durable,true);
 assert.equal(out.execution.status,'GITHUB_DURABLE_WRITE_EXECUTION_SUCCEEDED');assert.equal(out.receipt.status,'GITHUB_WRITE_DURABLE_FINALIZATION_CONFIRMED');
 assert.equal(out.receipt.admission_reference,'admission-e2e');assert.equal(out.receipt.ref,'refs/heads/'+branch);assert.equal(out.receipt.sha,sha);
 assert.equal(out.network_call_performed,true);assert.equal(out.write_performed,true);assert.equal(out.production_used,false);
});

test('replay fails closed before a second provider write',async()=>{
 let fetchCalls=0;const composition=createHermesMaintainerGithubWriteE2eDurableClosure({pool:pool(),environment:{HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'synthetic-token'},fetchImpl:async()=>{fetchCalls++;return {status:201};},createTimeoutSignal:()=>new AbortController().signal});
 const first=await composition.execute(grant(),canary(),input());const replay=await composition.execute(grant(),canary(),input());
 assert.equal(first.closure_valid,true);assert.equal(replay.status,'E2E_DURABLE_WRITE_CLOSURE_BLOCKED');assert.deepEqual(replay.blockers,['DURABLE_ADMISSION_NOT_CONFIRMED']);assert.equal(fetchCalls,1);
});

test('invalid canary fails closed before provider and finalization',async()=>{
 let fetchCalls=0;const out=await createHermesMaintainerGithubWriteE2eDurableClosure({pool:pool(),environment:{HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'synthetic-token'},fetchImpl:async()=>{fetchCalls++;return {status:201};},createTimeoutSignal:()=>new AbortController().signal}).execute(grant(),{...canary(),ref:'refs/heads/main'},input());
 assert.equal(out.status,'E2E_DURABLE_WRITE_CLOSURE_BLOCKED');assert.deepEqual(out.blockers,['DURABLE_ADMISSION_NOT_CONFIRMED']);assert.equal(fetchCalls,0);assert.equal(out.durable,false);
});

test('construction is inert and requires all existing runtime dependencies',()=>{
 let fetchCalls=0;const composition=createHermesMaintainerGithubWriteE2eDurableClosure({pool:pool(),environment:{HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'synthetic-token'},fetchImpl:async()=>{fetchCalls++;return {status:201};},createTimeoutSignal:()=>new AbortController().signal});
 assert.equal(composition.composition_version,'hermes_maintainer_github_write_e2e_durable_closure_v1');assert.equal(fetchCalls,0);assert.equal(composition.production_used,false);
 assert.throws(()=>createHermesMaintainerGithubWriteE2eDurableClosure(),/postgres_pool_required/);
});
