'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildUpdateA3,buildPullA3}=require('./helpers/a3-maintenance-operation-test-data');
const {recordFor,readFor}=require('./helpers/a3-mission-origin-test-evidence');
const {createHermesMaintainerA3MissionSourceVerifier}=require('../src/core/hermes-maintainer-a3-mission-source-verification');
function pending(data){return{...data.eligibilityInput,source_evidence:{...data.eligibilityInput.source_evidence,durable_target:null}};}
for(const make of [buildUpdateA3,buildPullA3]){
 const operation=make().eligibilityInput.operation;
 test(operation+': verified independent MissionRun read must match exact scope, digest and single-use ID',async()=>{
  const p=pending(make()),v=createHermesMaintainerA3MissionSourceVerifier({readMissionRun:readFor(p)});
  const yes=await v.verify(p);
  assert.equal(yes.verified,true);
  assert.equal(yes.status,'A3_MISSION_SOURCE_VERIFIED');
  assert.equal(yes.mission_run_id,'unit-test-mission-run');
  assert.equal(await createHermesMaintainerA3MissionSourceVerifier().verify(p).then(x=>x.verified),false);
 });
 test(operation+': missing, forged and stale mission source never authorize',async()=>{
  const p=pending(make());
  const changes=[
   {mission_run_id:''},{mission_id:'another'},{source:'LOCAL_RUNNER'},
   {status:'READY'},{environment:'production'},{operation:'create_branch'},
   {workflow_operation:'branch_prepare'},{branch_name:'hermes/another'},
   {target_digest:'sha256:'+'a'.repeat(64)},{intent_digest:'sha256:'+'b'.repeat(64)},
   {approval_reference:'fake-approval'},{authorization_reference:'fake-auth'},
   {single_use_authorization_id:'fake-id'},{single_use_fingerprint:'sha256:'+'c'.repeat(64)},
   {simulation_receipt_digest:null},{durably_confirmed:false},{executed:true},
   {production_used:true},{merge_authority:true},{human_merge_required:false},
   {simulation_effect:'NON_ZERO'},{blockers:['anything']},
  ];
  for(const c of changes){
   const record=recordFor(p,c);
   const v=createHermesMaintainerA3MissionSourceVerifier({readMissionRun:async()=>record});
   const out=await v.verify(p);
   assert.equal(out.verified,false,JSON.stringify(c));
  }
  const badDigest={...recordFor(p),record_digest:'sha256:'+'f'.repeat(64)};
  assert.equal((await createHermesMaintainerA3MissionSourceVerifier({readMissionRun:async()=>badDigest}).verify(p)).verified,false);
  for(const readMissionRun of [async()=>null,async()=>({authorized:true}),async()=>{throw Error('network')}])
   assert.equal((await createHermesMaintainerA3MissionSourceVerifier({readMissionRun}).verify(p)).verified,false);
  let reads=0;
  const prod={...p,environment:'production'};
  assert.equal((await createHermesMaintainerA3MissionSourceVerifier({readMissionRun:async()=>{reads++;return recordFor(p);}}).verify(prod)).verified,false);
  assert.equal(reads,0);
 });
}
