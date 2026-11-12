'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createHermesMaintainerGithubCreatePullRequestE2eDurableClosure}=require('../src/runtime/hermes-maintainer-github-create-pull-request-e2e-durable-closure');
const {buildPullA3}=require('./helpers/a3-maintenance-operation-test-data');
const {readFor}=require('./helpers/a3-mission-origin-test-evidence');
const digest='sha256:'+'7'.repeat(64),head='hermes/pr-e2e';
function caseData(){return buildPullA3({head,title:'Hermes e2e',body:'staging draft'});}
function grant(){return caseData().grant;}
const target=caseData().target;
function input(){return caseData().operationalInput;}
function eligibility(){return caseData().eligibilityInput;}
function pool(){const rows=new Map();const client={async query(sql,args){if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};let table;if(sql.includes('create_pull_request_finalization'))table='finalization';else if(sql.includes('create_pull_request_execution_outcome'))table='outcome';else if(sql.includes('attempt_ownership'))table='ownership';else table='consumption';const key=args[0];if(sql.startsWith('SELECT ')){const row=rows.get(table+':'+key);return {rows:row?[row]:[]};}if(rows.has(table+':'+key))return {rows:[]};let row;if(table==='finalization')row={finalization_key:args[0],finalization_digest:args[1],outcome_digest:args[2],intent_digest:args[3],attempt_reference:args[4],admission_reference:args[5],repository:args[6],operation:args[7],base:args[8],head:args[9],draft:args[10],pull_request_number:args[11],pull_request_url:args[12],provider_status:args[13]};else if(table==='outcome')row={outcome_key:args[0],outcome_digest:args[1],intent_digest:args[2],attempt_reference:args[3],admission_reference:args[4],repository:args[5],operation:args[6],base:args[7],head:args[8],draft:args[9],pull_request_number:args[10],pull_request_url:args[11],provider_status:args[12]};else if(table==='ownership')row={ownership_key:args[0],persistence_key:args[1],intent_digest:args[2],authorization_reference:args[3],consumption_reference:args[4],attempt_reference:args[5]};else row={persistence_key:args[0],intent_digest:args[1],authorization_reference:args[2],consumption_reference:args[3]};rows.set(table+':'+key,row);return {rows:[row]};},release(){}};return {connect:async()=>client,async query(sql,args){let table;if(sql.includes('create_pull_request_finalization'))table='finalization';else if(sql.includes('create_pull_request_execution_outcome'))table='outcome';else if(sql.includes('attempt_ownership'))table='ownership';else table='consumption';const row=rows.get(table+':'+args[0]);return {rows:row?[row]:[]};}};}
test('closes draft PR durable chain and preserves provider identity',async()=>{let calls=0,body;const out=await createHermesMaintainerGithubCreatePullRequestE2eDurableClosure({pool:pool(),readMissionRun:readFor(eligibility()),environment:{HERMES_GITHUB_CREATE_PULL_REQUEST_STAGING_TOKEN:'synthetic-token'},fetchImpl:async(_url,o)=>{calls++;body=JSON.parse(o.body);return {status:201,json:async()=>({number:438,html_url:'https://github.com/instutodp-cpu/agente-grupo-erick/pull/438',draft:true})};},createTimeoutSignal:()=>new AbortController().signal}).execute(eligibility(),grant(),target,input());assert.equal(calls,1);assert.equal(body.head,head);assert.equal(body.base,'main');assert.equal(body.draft,true);assert.equal(out.status,'CREATE_PULL_REQUEST_E2E_DURABLE_CLOSURE_CONFIRMED');assert.equal(out.receipt.pull_request_number,438);assert.equal(out.durable,true);assert.equal(out.production_used,false);});
test('replay fails closed before a second provider write',async()=>{let calls=0;const c=createHermesMaintainerGithubCreatePullRequestE2eDurableClosure({pool:pool(),readMissionRun:readFor(eligibility()),environment:{HERMES_GITHUB_CREATE_PULL_REQUEST_STAGING_TOKEN:'synthetic-token'},fetchImpl:async()=>{calls++;return {status:201,json:async()=>({number:438,html_url:'https://github.com/instutodp-cpu/agente-grupo-erick/pull/438',draft:true})};},createTimeoutSignal:()=>new AbortController().signal});const first=await c.execute(eligibility(),grant(),target,input()),replay=await c.execute(eligibility(),grant(),target,input());assert.equal(first.closure_valid,true);assert.equal(replay.status,'CREATE_PULL_REQUEST_E2E_DURABLE_CLOSURE_BLOCKED');assert.equal(calls,1);});
test('invalid target fails closed before provider',async()=>{let calls=0;const out=await createHermesMaintainerGithubCreatePullRequestE2eDurableClosure({pool:pool(),readMissionRun:readFor(eligibility()),environment:{HERMES_GITHUB_CREATE_PULL_REQUEST_STAGING_TOKEN:'synthetic-token'},fetchImpl:async()=>{calls++;},createTimeoutSignal:()=>new AbortController().signal}).execute(eligibility(),grant(),{...target,draft:false},input());assert.equal(out.closure_valid,false);assert.equal(calls,0);});
test('construction is inert and credential remains isolated',()=>{let calls=0;const c=createHermesMaintainerGithubCreatePullRequestE2eDurableClosure({pool:pool(),readMissionRun:readFor(eligibility()),environment:{HERMES_GITHUB_CREATE_PULL_REQUEST_STAGING_TOKEN:'synthetic-token'},fetchImpl:async()=>{calls++;},createTimeoutSignal:()=>new AbortController().signal});assert.equal(c.composition_version,'hermes_maintainer_github_create_pull_request_e2e_durable_closure_v2');assert.equal(c.credential_reference,'github_create_pull_request_hermes_branch_staging');assert.equal(calls,0);assert.equal(c.production_used,false);assert.throws(()=>createHermesMaintainerGithubCreatePullRequestE2eDurableClosure(),/postgres_pool_required/);});

test('official public-web read MissionRun cannot supply A3 authority even before attestation checks',async()=>{
 const e=eligibility(),g=grant(),t=target,i=input(),calls=[];
 let providerCalls=0;
 const closure=createHermesMaintainerGithubCreatePullRequestE2eDurableClosure({
  pool:pool(),
  invokeMissionGateway:async arg=>{
   calls.push(arg.operation);
   if(arg.operation==='list_runs')return {runs:[{id:'real-existing-web-read-run',espaco_id:'workspace-1',
    mission_id:e.source_evidence.single_use_authorization.mission_id,
    status:'concluida',dispatch_simulado:false,
    contrato_json:'{"contract_version":"1.0"}',contract_hash:'sha256:'+'f'.repeat(64)}]};
   if(arg.operation==='verify_integrity')return {ok:true,expected:'sha256:'+'f'.repeat(64),actual:'sha256:'+'f'.repeat(64)};
   return {error:'Operação inválida'};
  },
  environment:{HERMES_GITHUB_CREATE_PULL_REQUEST_STAGING_TOKEN:'synthetic-token'},
  fetchImpl:async()=>{providerCalls++;throw Error('no write allowed');},
  createTimeoutSignal:()=>new AbortController().signal
 });
 const out=await closure.execute(e,g,t,i);
 assert.equal(out.closure_valid,false);
 assert.deepEqual(out.blockers,['DURABLE_ADMISSION_NOT_CONFIRMED']);
 assert.deepEqual(calls,['list_runs']); // Stronger fail-closed: invalid mission purpose rejects before hash/provenance.
 assert.equal(providerCalls,0);
});
