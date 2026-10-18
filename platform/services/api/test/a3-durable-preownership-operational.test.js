'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module');
const {buildUpdateA3,buildPullA3}=require('./helpers/a3-maintenance-operation-test-data');
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
   const op=mod[createName]({pool:{connect(){},query(){}}});
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
