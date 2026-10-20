'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {FIELDS,INSERT_SQL,SELECT_SQL,validClaim,
 createHermesMaintainerA3SourceClaimPostgresPersistence:createAdapter}=
 require('../src/core/hermes-maintainer-a3-source-claim-postgres-persistence');
const D=x=>'sha256:'+x.repeat(64);
function makeClaim(){return {
 single_use_authorization_id:'new-a3-single-use-claim',
 workspace_id:'new-space',mission_id:'new-mission',mission_run_id:'new-run',
 approval_reference:'new-post-run-human-approval',authorization_reference:'new-authorization',
 operation:'update_file',repository:'instutodp-cpu/agente-grupo-erick',
 environment:'staging',target_digest:D('a'),intent_digest:D('b'),
 simulation_receipt_digest:D('c'),staging_gate_fingerprint:D('d'),
 source_record_digest:D('e')
};}
const verified=claim=>({verified:true,source:'MISSION_GATEWAY_DURABLE',
 simulation_effect:'ZERO',durably_confirmed:true,executed:false,
 production_used:false,merge_authority:false,human_merge_required:true,
 approval_verified:true,issuer_verified:true,claim});
const staging=Object.freeze({HERMES_DEPLOYMENT_STAGE:'staging',HERMES_A3_SOURCE_CLAIMS_ENABLED:'true'});
function db(){
 const committed=new Map();let staged=null;let queries=[],failCommit=false,failRead=false,failConnect=false;
 const key='single_use_authorization_id';
 const client={async query(sql,args){
  queries.push(sql);
  if(sql==='BEGIN'){staged=null;return {rows:[]};}
  if(sql==='COMMIT'){
   if(failCommit)throw Error('commit uncertain');
   if(staged){committed.set(staged[key],staged);staged=null;}
   return {rows:[]};
  }
  if(sql==='ROLLBACK'){staged=null;return {rows:[]};}
  if(sql===INSERT_SQL){
   const row=Object.fromEntries(FIELDS.map((f,i)=>[f,args[i]]));
   if([...committed.values()].some(x=>x.single_use_authorization_id===row.single_use_authorization_id||
      x.approval_reference===row.approval_reference||
      x.simulation_receipt_digest===row.simulation_receipt_digest||
      x.source_record_digest===row.source_record_digest))
      return {rows:[]};
   staged=row;return {rows:[{single_use_authorization_id:row[key]}]};
  }
  throw Error('unexpected query');
 },release(){}};
 const pool={connect:async()=>{if(failConnect)throw Error('db unavailable');return client;},
  query:async(sql,args)=>{queries.push(sql);if(failRead)throw Error('read unavailable');
   if(sql!==SELECT_SQL)throw Error('unexpected SELECT');
   const row=committed.get(args[0]);return {rows:row?[row]:[]};}};
 return {pool,queries,committed,failCommit:()=>{failCommit=true},
 failRead:()=>{failRead=true},failConnect:()=>{failConnect=true}};
}
const adapter=(storage,source=async(c)=>verified(c),environment=staging)=>
 createAdapter({pool:storage.pool,verifyOfficialSource:source,environment});

test('constructor cannot enable A3 source claim without privileged verifier and DB',()=>{
 assert.throws(()=>createAdapter({}),/postgres_pool_required/);
 assert.throws(()=>createAdapter({pool:db().pool}),/independent_source_verifier_required/);
 assert.match(INSERT_SQL,/ON CONFLICT DO NOTHING RETURNING single_use_authorization_id/);
 assert.match(SELECT_SQL,/WHERE single_use_authorization_id=\$1/);
});
test('staging source claim is disabled by default and never consumes SCM authorization',async()=>{
 const store=db(),claim=makeClaim();
 for(const env of [{}, {HERMES_DEPLOYMENT_STAGE:'production',HERMES_A3_SOURCE_CLAIMS_ENABLED:'true'},
   {HERMES_DEPLOYMENT_STAGE:'staging',HERMES_A3_SOURCE_CLAIMS_ENABLED:'false'}]){
  const result=await adapter(store,async()=>verified(claim),env).createIfVerified(claim);
  assert.equal(result.durable,false);assert.equal(result.execution_authorized,false);
 }
 assert.deepEqual(store.queries,[]);
 assert.doesNotMatch(INSERT_SQL,/maintainer_scm_write_consumption|execution_authorized|api\.github\.com/);
});
test('verified independent source may claim once, never authorizes SCM, replay always denied',async()=>{
 const store=db(),claim=makeClaim(),a=adapter(store);
 const first=await a.createIfVerified(claim);
 assert.equal(first.status,'A3_SOURCE_CLAIM_DURABLY_OWNED');
 assert.equal(first.durable,true);assert.equal(first.claim_created,true);
 for(const field of ['execution_authorized','network_call_performed','write_performed','production_allowed','merge_authority'])
  assert.equal(first[field],false);
 assert.deepEqual(store.committed.get(claim.single_use_authorization_id),claim);
 const retry=await a.createIfVerified(claim);
 assert.equal(retry.status,'A3_SOURCE_CLAIM_ALREADY_OWNED');
 assert.equal(retry.durable,false);
 assert.equal(store.committed.size,1);
});
test('cross-workspace duplicates of ID, approval, simulation receipt and source digest are denied',async()=>{
 for(const field of ['single_use_authorization_id','approval_reference','simulation_receipt_digest','source_record_digest']){
  const store=db(),a=adapter(store),claim=makeClaim();
  assert.equal((await a.createIfVerified(claim)).durable,true);
  const other={...claim,
   single_use_authorization_id:'different-id',
   approval_reference:'different-human-approval',
   simulation_receipt_digest:D('f'),source_record_digest:D('0'),
   workspace_id:'other-space',mission_run_id:'other-run'};
  other[field]=claim[field];
  const result=await a.createIfVerified(other);
  assert.equal(result.durable,false,field);
  assert.equal(store.committed.size,1,field);
 }
});
test('no claim on signature, zero-effect, approval or scope failures',async()=>{
 const claim=makeClaim();
 const patches=[
  {verified:false},{issuer_verified:false},{approval_verified:false},
  {source:'LOCAL_RUNNER'},{simulation_effect:'UNKNOWN'},{durably_confirmed:false},
  {executed:true},{production_used:true},{merge_authority:true},
  {human_merge_required:false},{claim:{...claim,repository:'other/repo'}},
  {claim:{...claim,environment:'production'}},
  {claim:{...claim,mission_run_id:'different-run'}},
  {claim:{...claim,source_record_digest:'invalid'}},
  {claim:{...claim,extra_authority:'yes'}}
 ];
 for(const patch of patches){
  const store=db(),result=await adapter(store,async()=>({...verified(claim),...patch})).createIfVerified(claim);
  assert.equal(result.durable,false,JSON.stringify(patch));assert.deepEqual(store.queries,[]);
 }
 assert.equal(validClaim(claim),true);
 assert.equal(validClaim({...claim,operation:'delete_repository'}),false);
});

test('read-only ownership requires fresh independent approval and exact durable PostgreSQL claim',async()=>{
 const store=db(),claim=makeClaim();
 let source=verified(claim),checks=0;
 const a=adapter(store,async(input)=>{checks++;return source;});
 const absent=await a.verifyOwned(claim);
 assert.equal(absent.status,'A3_SOURCE_CLAIM_ABSENT_OR_SCOPE_DRIFT');
 assert.equal(absent.durable,false);
 assert.equal(store.committed.size,0);
 assert.equal((await a.createIfVerified(claim)).durable,true);
 const owned=await a.verifyOwned(claim);
 assert.equal(owned.status,'A3_SOURCE_CLAIM_VERIFIED_CURRENT');
 assert.equal(owned.durable,true);
 assert.equal(owned.claim_created,false);
 for(const field of ['execution_authorized','network_call_performed','write_performed','production_allowed','merge_authority'])
  assert.equal(owned[field],false);
 const reads=store.queries.filter(q=>q===SELECT_SQL).length;
 assert.equal(reads,3);
 assert.ok(checks>=3,'fresh source callback executed each read');
 source={...verified(claim),approval_verified:false};
 const revoked=await a.verifyOwned(claim);
 assert.equal(revoked.durable,false,'revoked decision cannot reuse a durable row');
 assert.equal(revoked.status,'A3_OFFICIAL_SOURCE_UNVERIFIED');
 assert.equal(store.queries.filter(q=>q===SELECT_SQL).length,reads,'invalid source cannot access PG claim');
 source={...verified(claim),issuer_verified:false};
 assert.equal((await a.verifyOwned(claim)).durable,false);
 source=verified(claim);
 assert.equal((await a.verifyOwned({...claim,mission_run_id:'other'})).durable,false);
 assert.equal(store.committed.size,1,'read checks never write or delete');
});
test('read-only ownership rejects changed DB row, missing DB, and stage not enabled',async()=>{
 const store=db(),claim=makeClaim(),a=adapter(store);
 assert.equal((await a.createIfVerified(claim)).durable,true);
 store.committed.set(claim.single_use_authorization_id,{...claim,workspace_id:'other-space'});
 assert.equal((await a.verifyOwned(claim)).status,'A3_SOURCE_CLAIM_ABSENT_OR_SCOPE_DRIFT');
 store.committed.delete(claim.single_use_authorization_id);
 assert.equal((await a.verifyOwned(claim)).durable,false);
 store.failRead();
 assert.equal((await a.verifyOwned(claim)).status,'A3_SOURCE_CLAIM_READ_UNAVAILABLE');
 const disabled=adapter(store,async()=>{throw Error('must not invoke')},{});
 assert.equal((await disabled.verifyOwned(claim)).status,'A3_SOURCE_CLAIM_STAGING_DISABLED');
});
test('privileged issuer unavailable fails closed without DB query',async()=>{
 const store=db(),claim=makeClaim();
 const out=await adapter(store,async()=>{throw Error('unavailable')}).createIfVerified(claim);
 assert.equal(out.status,'A3_OFFICIAL_SOURCE_UNAVAILABLE');assert.equal(out.durable,false);assert.deepEqual(store.queries,[]);
});
test('database unavailability, uncertain commit or post-commit read never return a grant',async()=>{
 const claim=makeClaim();
 for(const fail of ['failConnect','failCommit','failRead']){
  const store=db();store[fail]();
  const out=await adapter(store).createIfVerified(claim);
  assert.equal(out.durable,false,fail);
  assert.equal(out.execution_authorized,false,fail);
 }
});
