'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {COLS,SELECT,INSERT,FINALIZE,createHermesMaintainerA3ProcessObservationPersistence}=
 require('../src/core/hermes-maintainer-a3-process-observation-persistence');
const {createHermesMaintainerA3DurableProcessObservation,
 createHermesMaintainerA3DurableProcessObservationFromServerEnv}=
 require('../src/runtime/hermes-maintainer-a3-durable-process-observation');
const IMAGE='sha256:'+'d'.repeat(64);
const HASH='sha256:'+'a'.repeat(64);
const READY=Object.freeze({
 HERMES_DEPLOYMENT_STAGE:'staging',HERMES_A3_ZERO_EFFECT_TEST_ENABLED:'true',
 HERMES_EXECUTION_ENABLED:'false',HERMES_EXECUTION_KILL_SWITCH:'true',
 HERMES_MISSION_INGRESS_ENABLED:'false'
});
const candidate=()=>({
 source:'MAESTRO_MISSION_GATEWAY_OFFICIAL_QUEUE_CANDIDATE',
 mission_id:'official-a3-mission',mission_run_id:'official-a3-run',
 workspace_id:'official-workspace',operation:'update_file',
 repository:'instutodp-cpu/agente-grupo-erick',
 contract_hash:HASH,revision_sha:'b'.repeat(40),test_id:'hermes_core_smoke',
 verified_contract_integrity:true,simulated_run_queued:true,
 outbox_acknowledged:false,simulation_observed:false,receipt_durable:false,
 issuer_verified:false,approval_verified:false,execution_authorized:false,
 production_allowed:false,merge_authority:false
});
const observation=()=>({
 status:'A3_OFFICIAL_TEST_PROCESS_OBSERVED_NOT_ATTESTED',
 mission_id:'official-a3-mission',mission_run_id:'official-a3-run',
 workspace_id:'official-workspace',contract_hash:HASH,
 operation:'update_file',repository:'instutodp-cpu/agente-grupo-erick',
 revision_sha:'b'.repeat(40),
 simulation_observed:true,test_process_passed:true,
 receipt_durable:false,issuer_verified:false,approval_verified:false,
 outbox_acknowledged:false,execution_authorized:false,
 production_allowed:false,merge_authority:false,
 network_call_performed:null,scm_write_performed:null
});
function db(){
 const rows=new Map();let transaction=null,queries=[],commits=0,failCommit=false,failRead=false;
 const client={async query(sql,args=[]){
  queries.push(sql);
  if(sql==='BEGIN'){transaction={kind:null};return {rows:[]};}
  if(sql==='ROLLBACK'){transaction=null;return {rows:[]};}
  if(sql==='COMMIT'){
   commits++;
   if(failCommit)throw Error('commit uncertain');
   if(transaction?.kind==='insert')rows.set(transaction.row.mission_run_id,transaction.row);
   if(transaction?.kind==='update')rows.set(transaction.row.mission_run_id,transaction.row);
   transaction=null;return {rows:[]};
  }
  if(sql===INSERT){
   const row=Object.fromEntries(COLS.map((k,i)=>[k,args[i]]));
   if([...rows.values()].some(x=>x.mission_run_id===row.mission_run_id||
      x.mission_id===row.mission_id))return {rows:[]};
   transaction={kind:'insert',row:{...row,state:'reserved',
    observation_digest:null,observation_evidence:null,failure_code:null}};
   return {rows:[{mission_run_id:row.mission_run_id}]};
  }
  if(sql===FINALIZE){
   const scope=Object.fromEntries(COLS.map((k,i)=>[k,args[i+4]]));
   const prior=rows.get(scope.mission_run_id);
   if(!prior||prior.state!=='reserved'||
      COLS.some(k=>prior[k]!==scope[k]))return {rows:[]};
   transaction={kind:'update',row:{...prior,state:args[0],
    observation_digest:args[1],observation_evidence:args[2]?JSON.parse(args[2]):null,
    failure_code:args[3]}};
   return {rows:[{mission_run_id:scope.mission_run_id}]};
  }
  throw Error('unexpected SQL '+sql);
 },release(){}};
 const pool={
  connect:async()=>client,
  query:async(sql,args)=>{
   queries.push(sql);
   if(failRead)throw Error('read unavailable');
   if(sql!==SELECT)throw Error('unexpected SELECT');
   const row=rows.get(args[0]);
   return {rows:row?[row]:[]};
  }
 };
 return{rows,pool,queries,commits:()=>commits,
  breakCommit:()=>{failCommit=true},breakRead:()=>{failRead=true}};
}
const store=(f,env=READY)=>createHermesMaintainerA3ProcessObservationPersistence({
 pool:f.pool,imageId:IMAGE,environment:env});
test('single official MissionRun reservation precedes isolated process; completed row is observation ONLY',async()=>{
 const f=db(),dbStore=store(f);let read=0,process=0;
 const op=createHermesMaintainerA3DurableProcessObservation({
  readSimulatedRunCandidate:async()=>{read++;return candidate()},
  observeIsolatedProcess:async()=>{process++;return observation()},
  persistence:dbStore
 });
 const out=await op.observeOnce({});
 assert.equal(out.status,'A3_PROCESS_OBSERVATION_DURABLE_NOT_ATTESTED');
 assert.equal(out.process_observation_durable,true);
 assert.match(out.observation_digest,/^sha256:[a-f0-9]{64}$/);
 assert.equal(out.simulation_receipt_durable,false);
 for(const k of ['issuer_verified','human_approval_verified','execution_authorized',
  'production_allowed','merge_authority'])assert.equal(out[k],false,k);
 assert.equal(out.network_call_performed,null);
 assert.equal(out.scm_write_performed,null);
 const row=f.rows.get(candidate().mission_run_id);
 assert.equal(row.state,'process_observed');
 assert.equal(row.observation_evidence.observation_type,'isolated_test_process_only');
 assert.equal(row.observation_evidence.simulation_receipt_durable,false);
 assert.equal(row.observation_evidence.independent_issuer_verified,false);
 assert.equal(row.observation_evidence.outbox_acknowledged,false);
 assert.equal(row.observation_evidence.network_call_performed,null);
 assert.equal(row.observation_evidence.scm_write_performed,null);
 assert.equal(read,1);assert.equal(process,1);assert.equal(f.commits(),2);
 const replay=await op.observeOnce({});
 assert.equal(replay.process_observation_durable,false);
 assert.equal(process,1,'one physical subprocess per official MissionRun');
 assert.equal(f.rows.size,1);
});
test('cross-run reuse of the same Mission is denied before another process starts',async()=>{
 const f=db(),persist=store(f),first=candidate();
 assert.equal((await persist.reserve(first)).attempt_reserved,true);
 const second={...first,mission_run_id:'other-run'};
 assert.equal((await persist.reserve(second)).attempt_reserved,false);
 assert.equal(f.rows.size,1);
});
test('disabled staging and all unsafe switches block before any SQL',async()=>{
 for(const env of [{},
  {...READY,HERMES_DEPLOYMENT_STAGE:'production'},
  {...READY,HERMES_EXECUTION_ENABLED:'true'},
  {...READY,HERMES_EXECUTION_KILL_SWITCH:'false'},
  {...READY,HERMES_MISSION_INGRESS_ENABLED:'true'},
  {...READY,HERMES_A3_ZERO_EFFECT_TEST_ENABLED:'false'}
 ]){
  const f=db(),persist=store(f,env);
  assert.equal((await persist.reserve(candidate())).attempt_reserved,false);
  assert.equal(f.queries.length,0);
 }
});
test('tampered MissionRun, target, image or unauthorized source cannot reserve',async()=>{
 for(const patch of [
  {source:'LOCAL_RUNNER'},{operation:'create_branch'},
  {repository:'unrelated/repo'},{mission_run_id:''},{revision_sha:'main'},
  {contract_hash:'invalid'},{issuer_verified:true},
  {outbox_acknowledged:true},{simulated_run_queued:false},
  {receipt_durable:true},{simulation_observed:true},
  {execution_authorized:true}
 ]){
  const f=db(),persist=store(f);
  const result=await persist.reserve({...candidate(),...patch});
  assert.equal(result.attempt_reserved,false,JSON.stringify(patch));
  assert.equal(f.rows.size,0);
 }
});
test('unverified observation never finalizes, even after reservation',async()=>{
 for(const patch of [
  {receipt_durable:true},{issuer_verified:true},{approval_verified:true},
  {outbox_acknowledged:true},{execution_authorized:true},
  {network_call_performed:false},{scm_write_performed:false},
  {mission_run_id:'other-run'},{workspace_id:'other-workspace'},
  {operation:'create_pull_request'},{repository:'other/repository'},
  {revision_sha:'f'.repeat(40)},
  {contract_hash:'sha256:'+'c'.repeat(64)},{test_process_passed:false}
 ]){
  const f=db(),persist=store(f),source=candidate();
  assert.equal((await persist.reserve(source)).attempt_reserved,true);
  const out=await persist.finish(source,{...observation(),...patch});
  assert.equal(out.process_observation_durable,false,JSON.stringify(patch));
  assert.equal(f.rows.get(source.mission_run_id).state,'reserved');
 }
});
test('failed test locks the attempt, never auto-replays',async()=>{
 const f=db(),persist=store(f);let called=0;
 const op=createHermesMaintainerA3DurableProcessObservation({
  readSimulatedRunCandidate:async()=>candidate(),
  observeIsolatedProcess:async()=>{called++;throw Error('untrusted runner failure')},
  persistence:persist
 });
 const out=await op.observeOnce({});
 assert.equal(out.process_observation_durable,false);
 assert.equal(f.rows.get(candidate().mission_run_id).state,'failed_safe');
 assert.equal(f.rows.get(candidate().mission_run_id).observation_digest,null);
 await op.observeOnce({});
 assert.equal(called,1);
});
test('uncertain DB commits and missing readback never permit a process replay',async()=>{
 for(const failure of ['commit','read']){
  const f=db(),persist=store(f);
  if(failure==='commit')f.breakCommit();else f.breakRead();
  let processes=0;
  const op=createHermesMaintainerA3DurableProcessObservation({
   readSimulatedRunCandidate:async()=>candidate(),
   observeIsolatedProcess:async()=>{processes++;return observation()},
   persistence:persist
  });
  const first=await op.observeOnce({});
  assert.equal(first.process_observation_durable,false);
  assert.equal(processes,0);
 }
});
test('runtime composition remains inert without server-owned Gateway and pinned image',async()=>{
 const f=db(),env={...READY};
 let fetches=0,processes=0;
 const runtime=createHermesMaintainerA3DurableProcessObservationFromServerEnv({
  pool:f.pool,environment:env,
  fetchImpl:async()=>{fetches++;throw Error('unexpected transport')},
  spawnImpl:()=>{processes++;throw Error('unexpected Docker')}
 });
 assert.equal(runtime.configured,false);
 const answer=await runtime.observeOnce({});
 assert.equal(answer.process_observation_durable,false);
 assert.equal(fetches,0);
 assert.equal(processes,0);
 assert.equal(f.rows.size,0);
});

test('migration 035 is strictly staging-only observation, with global single-use and RLS',()=>{
 const sql=fs.readFileSync(path.resolve(__dirname,'../../../migrations/hermes/035_create_maintainer_a3_process_observations.sql'),'utf8');
 assert.match(sql,/CREATE TABLE IF NOT EXISTS hermes\.maintainer_a3_process_observations/);
 assert.match(sql,/mission_run_id TEXT PRIMARY KEY/);
 assert.match(sql,/mission_id TEXT NOT NULL UNIQUE/);
 assert.match(sql,/state IN \('reserved','process_observed','failed_safe'\)/);
 assert.match(sql,/state='process_observed' AND observation_digest IS NOT NULL/);
 assert.match(sql,/observation_evidence->>'independent_issuer_verified'='false'/);
 assert.match(sql,/observation_evidence->>'simulation_receipt_durable'='false'/);
 assert.match(sql,/observation_evidence->>'execution_authorized'='false'/);
 assert.match(sql,/observation_evidence->>'network_call_performed' IS NULL/);
 assert.match(sql,/ALTER TABLE hermes\.maintainer_a3_process_observations ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/REVOKE ALL ON TABLE hermes\.maintainer_a3_process_observations/);
 assert.doesNotMatch(sql,/INSERT INTO hermes\.|UPDATE hermes\.|maintainer_scm_write_consumption|MAESTRO_A3_PRIVATE_KEY/);
});

function safeTemporaryTestPgUrl(raw){
 try{
  const u=new URL(raw||'');
  return ['postgres:','postgresql:'].includes(u.protocol)&&
   ['localhost','127.0.0.1','::1'].includes(u.hostname)&&
   /^hermes_test(?:_[a-z0-9_-]+)?$/i.test(decodeURIComponent(u.pathname.slice(1)));
 }catch{return false;}
}
test('real temporary PostgreSQL rejects replay and persists only non-authoritative process observation',
 {skip:!safeTemporaryTestPgUrl(process.env.HERMES_POSTGRES_TEST_DATABASE_URL)},
 async t=>{
  const {Pool}=require('pg');
  const pool=new Pool({connectionString:process.env.HERMES_POSTGRES_TEST_DATABASE_URL,
   max:4,connectionTimeoutMillis:4000});
  let created=false;
  try{
   const pre=await pool.query("SELECT to_regclass('hermes.maintainer_a3_process_observations') AS tab");
   if(pre.rows[0].tab){t.skip('existing test table must not be overwritten');return;}
   let sql=fs.readFileSync(path.resolve(__dirname,
    '../../../migrations/hermes/035_create_maintainer_a3_process_observations.sql'),'utf8');
   // Vanilla disposable CI PostgreSQL has no Supabase anon/authenticated
   // roles. Only these staging ACL statements are skipped in CI fixture.
   sql=sql.replace(/REVOKE ALL ON TABLE hermes\.maintainer_a3_process_observations\s+FROM PUBLIC, anon, authenticated;/,'')
     .replace(/REVOKE USAGE ON SCHEMA hermes FROM PUBLIC, anon, authenticated;/,'');
   await pool.query(sql);created=true;
   const persistence=createHermesMaintainerA3ProcessObservationPersistence({
    pool,imageId:IMAGE,environment:READY});
   const attempts=await Promise.all(Array.from({length:4},
    ()=>persistence.reserve(candidate())));
   assert.equal(attempts.filter(x=>x.attempt_reserved).length,1);
   const finished=await persistence.finish(candidate(),observation());
   assert.equal(finished.process_observation_durable,true);
   assert.equal(finished.simulation_receipt_durable,false);
   const persisted=await pool.query(
    'SELECT state,observation_digest,observation_evidence FROM hermes.maintainer_a3_process_observations');
   assert.equal(persisted.rows.length,1);
   assert.equal(persisted.rows[0].state,'process_observed');
   assert.equal(persisted.rows[0].observation_digest,finished.observation_digest);
   assert.equal(persisted.rows[0].observation_evidence.independent_issuer_verified,false);
   assert.equal(persisted.rows[0].observation_evidence.network_call_performed,null);
   assert.equal((await persistence.reserve(candidate())).attempt_reserved,false);
   assert.equal((await persistence.finish(candidate(),observation())).process_observation_durable,false);
  }finally{
   if(created)await pool.query('DROP TABLE IF EXISTS hermes.maintainer_a3_process_observations');
   await pool.end();
  }
 });
