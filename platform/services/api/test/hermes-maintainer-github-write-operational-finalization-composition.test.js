'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHermesMaintainerGithubWriteOperationalFinalizationComposition}=require('../src/runtime/hermes-maintainer-github-write-operational-finalization-composition');

const digest='sha256:'+'a'.repeat(64),sha='b'.repeat(40),ref='refs/heads/hermes/canary/operational-finalization';
function admission(overrides={}){return {contract_version:'hermes_maintainer_github_durable_write_admission_v1',status:'GITHUB_DURABLE_WRITE_REQUEST_ADMITTED',admission_valid:true,execution_authorized:true,provider:'GITHUB',operation:'create_branch',repository:'instutodp-cpu/agente-grupo-erick',intent_digest:digest,attempt_reference:'attempt-final',capability_reference:'cap-final',admission_reference:'admission-final',persistence_key:digest+'::authorization-final',ownership_key:digest+'::authorization-final::attempt-ownership',request:{body:{ref,sha}},...overrides};}
function execution(overrides={}){return {contract_version:'hermes_maintainer_github_durable_write_execution_boundary_v1',status:'GITHUB_DURABLE_WRITE_EXECUTION_SUCCEEDED',execution_performed:true,network_call_performed:true,write_performed:true,production_used:false,provider_status:201,blockers:[],...overrides};}
function pool(){
 const rows=new Map();
 const client={async query(sql,args){if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};const table=sql.includes('write_finalization')?'finalization':'outcome',key=args[0];if(rows.has(table+':'+key))return {rows:[]};const row=table==='finalization'?{finalization_key:args[0],finalization_digest:args[1],outcome_digest:args[2],intent_digest:args[3],attempt_reference:args[4],admission_reference:args[5],repository:args[6],operation:args[7],ref:args[8],sha:args[9],provider_status:args[10]}:{outcome_key:args[0],outcome_digest:args[1],intent_digest:args[2],attempt_reference:args[3],admission_reference:args[4],repository:args[5],operation:args[6],ref:args[7],sha:args[8],provider_status:args[9]};rows.set(table+':'+key,row);return {rows:[row]};},release(){}};
 return {connect:async()=>client,async query(sql,args){const table=sql.includes('write_finalization')?'finalization':'outcome',row=rows.get(table+':'+args[0]);return {rows:row?[row]:[]};}};
}

test('durably closes a confirmed official execution through outcome and finalization persistence',async()=>{
 const out=await createHermesMaintainerGithubWriteOperationalFinalizationComposition({pool:pool()}).finalize(admission(),execution());
 assert.equal(out.status,'OPERATIONAL_WRITE_FINALIZATION_CONFIRMED');
 assert.equal(out.finalization_valid,true);
 assert.equal(out.durable,true);
 assert.equal(out.receipt.status,'GITHUB_WRITE_DURABLE_FINALIZATION_CONFIRMED');
 assert.equal(out.receipt.ref,ref);
 assert.equal(out.receipt.sha,sha);
 assert.equal(out.receipt.provider_status,201);
 assert.equal(out.network_call_performed,false);
 assert.equal(out.write_performed,false);
 assert.deepEqual(out.blockers,[]);
});

test('replay fails closed because outcome persistence is create-if-absent',async()=>{
 const composition=createHermesMaintainerGithubWriteOperationalFinalizationComposition({pool:pool()});
 const first=await composition.finalize(admission(),execution());
 const replay=await composition.finalize(admission(),execution());
 assert.equal(first.status,'OPERATIONAL_WRITE_FINALIZATION_CONFIRMED');
 assert.equal(replay.status,'OPERATIONAL_WRITE_FINALIZATION_BLOCKED');
 assert.deepEqual(replay.blockers,['DURABLE_OUTCOME_NOT_CONFIRMED']);
 assert.equal(replay.durable,false);
});

test('unconfirmed execution fails closed before persistence',async()=>{
 let connects=0;
 const p=pool(),original=p.connect;p.connect=async()=>{connects++;return original();};
 const out=await createHermesMaintainerGithubWriteOperationalFinalizationComposition({pool:p}).finalize(admission(),execution({write_performed:false}));
 assert.equal(out.status,'OPERATIONAL_WRITE_FINALIZATION_BLOCKED');
 assert.deepEqual(out.blockers,['EXECUTION_OUTCOME_NOT_CONFIRMED']);
 assert.equal(connects,0);
 assert.equal(out.durable,false);
});

test('construction requires configured Postgres pool and remains inert',()=>{
 assert.throws(()=>createHermesMaintainerGithubWriteOperationalFinalizationComposition(),/postgres_pool_required/);
 const p=pool();let calls=0;p.connect=async()=>{calls++;throw new Error('must not connect during construction');};
 const composition=createHermesMaintainerGithubWriteOperationalFinalizationComposition({pool:p});
 assert.equal(composition.composition_version,'hermes_maintainer_github_write_operational_finalization_composition_v1');
 assert.equal(calls,0);
});
