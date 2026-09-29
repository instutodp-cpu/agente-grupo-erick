[Reading 58 lines from start (total: 58 lines, 0 remaining)]

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHermesMaintainerGithubWriteOperationalCanaryComposition}=require('../src/runtime/hermes-maintainer-github-write-operational-canary-composition');

const digest='sha256:'+'2'.repeat(64),sha='b'.repeat(40),branch='hermes/canary/final-link';
function grant(){return {contract_version:'hermes_maintainer_scm_write_authorization_grant_v1',status:'SCM_WRITE_AUTHORIZATION_GRANTED',authorization_valid:true,intent_digest:digest,operation:'create_branch',repository:'instutodp-cpu/agente-grupo-erick',base_ref:'main',branch_name:branch,approval_reference:'approval-final',authorization_reference:'auth-final',human_approval_present:true,execution_authorized:true,authorization_consumed:false,credential_material_present:false,network_call_performed:false,write_performed:false,production_used:false,blockers:[]};}
function canary(){return {contract_version:'hermes_maintainer_github_write_canary_contract_v1',status:'CANARY_PREPARED',canary_valid:true,provider:'GITHUB',environment:'staging',repository:'instutodp-cpu/agente-grupo-erick',operation:'create_branch',ref:'refs/heads/'+branch,sha,credential_material_present:false,execution_authorized:false,network_call_performed:false,write_performed:false,production_used:false};}
function input(){return {consumption_reference:'consume-final',attempt_reference:'attempt-final',capability_reference:'cap-final',admission_reference:'admission-final'};}
function pool(){
 const rows=new Map();
 const client={async query(sql,args){if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};const table=sql.includes('attempt_ownership')?'ownership':'consumption',key=args[0];if(sql.startsWith('SELECT ')){const row=rows.get(table+':'+key);return {rows:row?[row]:[]};}if(rows.has(table+':'+key))return {rows:[]};const row=table==='ownership'?{ownership_key:args[0],persistence_key:args[1],intent_digest:args[2],authorization_reference:args[3],consumption_reference:args[4],attempt_reference:args[5]}:{persistence_key:args[0],intent_digest:args[1],authorization_reference:args[2],consumption_reference:args[3]};rows.set(table+':'+key,row);return {rows:[row]};},release(){}};
 return {connect:async()=>client,async query(sql,args){const table=sql.includes('attempt_ownership')?'ownership':'consumption',row=rows.get(table+':'+args[0]);return {rows:row?[row]:[]};}};
}

test('links official operational admission to guarded canary runner',async()=>{
 let fetchCalls=0,seen;
 const composition=createHermesMaintainerGithubWriteOperationalCanaryComposition({pool:pool(),environment:{HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'synthetic-token'},fetchImpl:async(url,options)=>{fetchCalls++;seen={url,options};return {status:201};},createTimeoutSignal:()=>new AbortController().signal});
 const out=await composition.execute(grant(),canary(),input());
 assert.equal(fetchCalls,1);
 assert.equal(seen.url,'https://api.github.com/repos/instutodp-cpu/agente-grupo-erick/git/refs');
 assert.equal(seen.options.method,'POST');
 assert.deepEqual(JSON.parse(seen.options.body),{ref:'refs/heads/'+branch,sha});
 assert.equal(out.status,'GITHUB_DURABLE_WRITE_EXECUTION_SUCCEEDED');
 assert.equal(out.network_call_performed,true);
 assert.equal(out.production_used,false);
});

test('replay fails closed before a second provider call',async()=>{
 let fetchCalls=0;
 const composition=createHermesMaintainerGithubWriteOperationalCanaryComposition({pool:pool(),environment:{HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'synthetic-token'},fetchImpl:async()=>{fetchCalls++;return {status:201};},createTimeoutSignal:()=>new AbortController().signal});
 const first=await composition.execute(grant(),canary(),input());
 const replay=await composition.execute(grant(),canary(),input());
 assert.equal(first.status,'GITHUB_DURABLE_WRITE_EXECUTION_SUCCEEDED');
 assert.equal(replay.status,'OPERATIONAL_CANARY_EXECUTION_BLOCKED');
 assert.equal(fetchCalls,1);
 assert.equal(replay.network_call_performed,false);
 assert.equal(replay.write_performed,false);
});

test('invalid canary fails closed with zero provider calls',async()=>{
 let fetchCalls=0;
 const composition=createHermesMaintainerGithubWriteOperationalCanaryComposition({pool:pool(),environment:{HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'synthetic-token'},fetchImpl:async()=>{fetchCalls++;return {status:201};},createTimeoutSignal:()=>new AbortController().signal});
 const out=await composition.execute(grant(),{...canary(),ref:'refs/heads/main'},input());
 assert.equal(out.status,'OPERATIONAL_CANARY_EXECUTION_BLOCKED');
 assert.equal(fetchCalls,0);
 assert.equal(out.network_call_performed,false);
});

test('construction is inert',()=>{
 let fetchCalls=0;
 const composition=createHermesMaintainerGithubWriteOperationalCanaryComposition({pool:pool(),environment:{HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'synthetic-token'},fetchImpl:async()=>{fetchCalls++;return {status:201};},createTimeoutSignal:()=>new AbortController().signal});
 assert.equal(composition.composition_version,'hermes_maintainer_github_write_operational_canary_composition_v1');
 assert.equal(composition.credential_material_present,false);
 assert.equal(composition.network_call_performed,false);
 assert.equal(composition.write_performed,false);
 assert.equal(fetchCalls,0);
});

[executed on device: srv1908789 (f7221c38-fb4d-4cfd-9516-dc87ebcc0f21)]