'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module');
const {buildUpdateA3,buildPullA3}=require('./helpers/a3-maintenance-operation-test-data');
const {readFor}=require('./helpers/a3-mission-origin-test-evidence');
const {evaluateA3ScopedExternalActionEligibility}=require('../src/core/a3-scoped-external-action-eligibility');
function pending(d){return{...d.eligibilityInput,source_evidence:{...d.eligibilityInput.source_evidence,durable_target:null}};}
function withStubs(transport,callback){
 const calls=[];
 const orig=Module._load;
 const sims={
  'hermes-maintainer-scm-write-postgres-persistence-composition':{createHermesMaintainerScmWritePostgresPersistenceComposition:()=>({adapter:{persist:async()=>{calls.push('consumption');return{contract_version:'hermes_maintainer_scm_write_persistence_adapter_v1',status:'SCM_WRITE_PERSISTENCE_CREATED',adapter_valid:true,persistence_performed:true,created:true,durable:true,network_call_performed:false,write_performed:false};}}})},
  'hermes-maintainer-scm-write-postgres-attempt-ownership-composition':{createHermesMaintainerScmWritePostgresAttemptOwnershipComposition:()=>({adapter:{persist:async()=>{calls.push('ownership');return{contract_version:'hermes_maintainer_scm_write_attempt_ownership_persistence_adapter_v1',status:'SCM_WRITE_ATTEMPT_OWNERSHIP_PERSISTENCE_CREATED',adapter_valid:true,persistence_performed:true,created:true,durable:true,ownership_exclusive:true,execution_authorized:false,network_call_performed:false,write_performed:false,production_used:false};}}})}
 };
 Module._load=function(id,parent,isMain){for(const [suffix,exported] of Object.entries(sims))if(id.endsWith(suffix))return exported;return orig.apply(this,arguments);};
 try{
  const modulePath=require.resolve('../src/runtime/'+transport);
  delete require.cache[modulePath];
  const loaded=require(modulePath);
  return callback(loaded,calls);
 }finally{Module._load=orig;}
}
for(const [make,filename,createName] of [
 [buildUpdateA3,'hermes-maintainer-github-update-file-operational-admission-composition','createHermesMaintainerGithubUpdateFileOperationalAdmissionComposition'],
 [buildPullA3,'hermes-maintainer-github-create-pull-request-operational-admission-composition','createHermesMaintainerGithubCreatePullRequestOperationalAdmissionComposition']
]){
 test(make().eligibilityInput.operation+' pre-ownership denies forged A3 before persistence, then hydrates real DB proof',async()=>{
  const d=make(),p=pending(d);
  await withStubs(filename,async(mod,calls)=>{
   const op=mod[createName]({pool:{connect(){},query(){}},readMissionRun:readFor(p)});
   const drift={...p,environment:'production'};
   const rejected=await op.prepare(drift,d.grant,d.target,d.operationalInput);
   assert.equal(rejected.admission_valid,false);assert.deepEqual(calls,[]);
   const result=await op.prepare(p,d.grant,d.target,d.operationalInput);
   assert.deepEqual(calls,['consumption','ownership']);
   assert.equal(result.admission_valid,true);
   assert.equal(result.a3_verified_evidence.source_evidence.durable_target.ownership_key,result.ownership_key);
   assert.equal(result.a3_verified_evidence.source_evidence.durable_target.attempt_reference,d.operationalInput.attempt_reference);
   assert.equal(evaluateA3ScopedExternalActionEligibility(result.a3_verified_evidence).a3_eligible,true);
   assert.equal(result.write_performed,false);
  });
 });
}

test('2026-10-19 observed update_file canary cannot silently promote without source provenance',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const root=path.resolve(__dirname,'../../..');
 const evidence=JSON.parse(fs.readFileSync(path.join(root,'docs/audits/HERMES_A3_UPDATE_FILE_CANARY_20261019.json'),'utf8'));
 const map=JSON.parse(fs.readFileSync(path.join(root,'docs/audits/HERMES_READINESS_MAP.json'),'utf8'));
 const autonomy=map.autonomy,extension=autonomy.a3_maintenance_expansion,review=extension.update_file_canary_review;
 assert.equal(evidence.scope.operation,'update_file');
 assert.equal(evidence.scope.environment,'staging');
 assert.equal(evidence.human_authorized_intent_digest,'sha256:55bffd2fcced4099e9f08a3cf7a1a753ca50fb89a77bd7ff618fea7ce30b7a33');
 assert.equal(evidence.observed_execution.provider_status,200);
 assert.equal(evidence.observed_execution.new_blob_sha,'6145a08810c51a85b906dd96b8cbe0b9218ed6c7');
 assert.equal(evidence.observed_execution.branch_commit_sha,'27023bb6d239077a6efd1874289cf3e7372abbf0');
 for(const field of ['maintainer_scm_write_consumption_records','maintainer_scm_write_attempt_ownership_records','maintainer_github_update_file_execution_outcome_matching_records','maintainer_github_update_file_finalization_matching_records'])assert.equal(evidence.durable_evidence[field],1);
 assert.equal(evidence.provenance_review.independent_staging_gate_source_attestation_present,false);
 assert.equal(evidence.provenance_review.single_use_artifact_linked_to_durable_mission_run_receipt,false);
 assert.ok(evidence.provenance_review.promotion_blockers.length>0);
 assert.equal(evidence.decision.canary_real_write_confirmed,true);
 for(const name of ['trusted_e2e_promotion_evidence_complete','promotion_eligible','human_promotion_authorized','operational','production_allowed','a4_authorized','merge_authority'])assert.equal(evidence.decision[name],false,name);
 assert.equal(extension.status,'implemented_tested_unpromoted');
 assert.equal(extension.proven_e2e,false);
 assert.equal(extension.operational,false);
 assert.equal(extension.human_promotion_authorized,false);
 assert.equal(extension.production_allowed,false);
 assert.equal(review.real_provider_write_confirmed,true);
 assert.equal(review.staging_gate_source_verified,false);
 assert.equal(review.single_use_mission_source_verified,false);
 assert.equal(review.promotion_eligible,false);
 assert.equal(autonomy.current_max_level,'A3_authorized_scoped');
 assert.equal(autonomy.candidate,null);
 assert.equal(autonomy.a3_canary.operation,'create_branch');
});

for(const [make,filename,createName] of [
 [buildUpdateA3,'hermes-maintainer-github-update-file-operational-admission-composition','createHermesMaintainerGithubUpdateFileOperationalAdmissionComposition'],
 [buildPullA3,'hermes-maintainer-github-create-pull-request-operational-admission-composition','createHermesMaintainerGithubCreatePullRequestOperationalAdmissionComposition']
]){
 test(make().eligibilityInput.operation+' refuses untrusted mission proof before DB consumption',async()=>{
  const d=make(),p=pending(d);
  await withStubs(filename,async(mod,calls)=>{
   const blocked=await mod[createName]({pool:{connect(){},query(){}}}).prepare(p,d.grant,d.target,d.operationalInput);
   assert.equal(blocked.admission_valid,false);
   assert.deepEqual(blocked.blockers,['A3_MISSION_SOURCE_UNVERIFIED']);
   assert.deepEqual(calls,[]);
   const invalid=await mod[createName]({pool:{connect(){},query(){}},readMissionRun:async()=>({verified:true})}).prepare(p,d.grant,d.target,d.operationalInput);
   assert.equal(invalid.admission_valid,false);
   assert.deepEqual(calls,[]);
   const spoofed=await mod[createName]({pool:{connect(){},query(){}},readMissionRun:async()=>({...require('./helpers/a3-mission-origin-test-evidence').recordFor(p),mission_id:'forged'})}).prepare(p,d.grant,d.target,d.operationalInput);
   assert.equal(spoofed.admission_valid,false);
   assert.deepEqual(calls,[]);
  });
 });
}

for(const [make,filename,createName] of [
 [buildUpdateA3,'hermes-maintainer-github-update-file-operational-admission-composition','createHermesMaintainerGithubUpdateFileOperationalAdmissionComposition'],
 [buildPullA3,'hermes-maintainer-github-create-pull-request-operational-admission-composition','createHermesMaintainerGithubCreatePullRequestOperationalAdmissionComposition']
]){
 test(make().eligibilityInput.operation+' blocks request mutation during MissionRun lookup before any DB writes',async()=>{
  const d=make(),p=pending(d);
  await withStubs(filename,async(mod,calls)=>{
   const {recordFor}=require('./helpers/a3-mission-origin-test-evidence');
   const record=recordFor(p);
   const op=mod[createName]({pool:{connect(){},query(){}},readMissionRun:async()=>{
    p.target_reference.branch_name='hermes/mutated';
    return record;
   }});
   const out=await op.prepare(p,d.grant,d.target,d.operationalInput);
   assert.equal(out.admission_valid,false);
   assert.deepEqual(out.blockers,['A3_MISSION_SOURCE_READ_SCOPE_DRIFT']);
   assert.deepEqual(calls,[]);
  });
 });
}
