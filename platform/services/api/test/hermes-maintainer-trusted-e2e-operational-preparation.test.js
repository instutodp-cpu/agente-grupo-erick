'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');

function load(fail){
 const original=Module._load;
 const calls=[];
 Module._load=function(r,p,m){
  if(r.endsWith('github-write-operational-admission-composition'))return {
   preflightHermesMaintainerGithubWriteOperationalAdmission:(eligibility,grant,canary,input)=>{
    calls.push(['branch_preflight',eligibility,grant,canary,input]);
    if(fail==='branch_preflight'||eligibility?.eligibility_id!=='a3-e2e')return {admission_preflight_valid:false};
    return {admission_preflight_valid:true};
   },
   createHermesMaintainerGithubWriteOperationalAdmissionComposition:()=>({prepare:async(eligibility,grant,canary,input)=>{
    calls.push(['branch',eligibility,grant,canary,input]);
    if(fail==='branch'||eligibility?.eligibility_id!=='a3-e2e')return {admission_valid:false};
    return {admission_valid:true,operation:'create_branch'};
   }})
  };
  if(r.endsWith('github-update-file-operational-admission-composition'))return {
   preflightHermesMaintainerGithubUpdateFileOperationalAdmission:()=>fail==='edit_preflight'?{admission_preflight_valid:false}:{admission_preflight_valid:true},
   createHermesMaintainerGithubUpdateFileOperationalAdmissionComposition:()=>({prepare:async()=>{calls.push(['edit']);return fail==='edit'?{admission_valid:false}:{admission_valid:true,operation:'update_file'}}})
  };
  if(r.endsWith('github-create-pull-request-operational-admission-composition'))return {
   preflightHermesMaintainerGithubCreatePullRequestOperationalAdmission:()=>fail==='pull_preflight'?{admission_preflight_valid:false}:{admission_preflight_valid:true},
   createHermesMaintainerGithubCreatePullRequestOperationalAdmissionComposition:()=>({prepare:async()=>{calls.push(['pull']);return fail==='pull'?{admission_valid:false}:{admission_valid:true,operation:'create_pull_request'}}})
  };
  if(r.endsWith('trusted-e2e-canary-workflow-preparation'))return {prepareHermesMaintainerTrustedE2eCanaryWorkflow:input=>{calls.push(['workflow',input]);return fail==='workflow'?{prepared:false}:{prepared:true,workflow:{ok:true}}}};
  return original(r,p,m);
 };
 try{
  const path=require.resolve('../src/runtime/hermes-maintainer-trusted-e2e-operational-preparation');
  delete require.cache[path];
  return {m:require(path),calls};
 }finally{Module._load=original;}
}

const valid=()=>({
 repository_read:{path:'README.md'},
 branch:{
  a3_eligibility_input:{eligibility_id:'a3-e2e'},
  grant:{id:'branch-grant'},
  canary:{ref:'refs/heads/hermes/canary/e2e'},
  target:{operation:'create_branch',branch_name:'hermes/canary/e2e'},
  operational_input:{id:'branch-operational'},
  controlled_execution:{id:'branch-control'},
  mutation_input:{id:'branch-mutation'}
 },
 edit:{grant:{id:'edit-grant'},target:{operation:'update_file',branch:'hermes/canary/e2e'},operational_input:{id:'edit-operational'}},
 pull_request:{grant:{id:'pull-grant'},target:{operation:'create_pull_request',head:'hermes/canary/e2e',base:'main',draft:true},operational_input:{id:'pull-operational'}}
});

test('prepares admissions in mutation order and binds exact A3 evidence into the branch workflow',async()=>{
 const {m,calls}=load();
 const c=m.createHermesMaintainerTrustedE2eOperationalPreparation({pool:{}});
 const x=await c.prepare(valid());
 assert.equal(c.composition_version,'hermes_maintainer_trusted_e2e_operational_preparation_v2');
 assert.equal(x.prepared,true);
 assert.equal(x.production_used,false);
 assert.equal(x.merge_authority,false);
 assert.equal(x.human_merge_required,true);
 const branchPreflight=calls.find(entry=>entry[0]==='branch_preflight');
 const branchAdmission=calls.find(entry=>entry[0]==='branch');
 const workflow=calls.find(entry=>entry[0]==='workflow');
 assert.equal(branchPreflight[1].eligibility_id,'a3-e2e');
 assert.equal(branchAdmission[1].eligibility_id,'a3-e2e');
 assert.equal(workflow[1].branch.a3_eligibility_input.eligibility_id,'a3-e2e');
 assert.equal(workflow[1].branch.canary.ref,'refs/heads/hermes/canary/e2e');
 assert.equal(typeof c.execute,'undefined');
});

for(const stage of ['branch','edit','pull','workflow'])test('fails closed at '+stage,async()=>{
 const {m,calls}=load(stage);
 const x=await m.createHermesMaintainerTrustedE2eOperationalPreparation({pool:{}}).prepare(valid());
 assert.equal(x.prepared,false);
 if(stage==='branch')assert.equal(calls.some(entry=>entry[0]==='branch'),true);
 if(stage==='edit')assert.equal(calls.some(entry=>entry[0]==='edit'),true);
 if(stage==='pull')assert.equal(calls.some(entry=>entry[0]==='pull'),true);
 if(stage==='workflow')assert.equal(calls.some(entry=>entry[0]==='workflow'),true);
});

test('missing A3 eligibility fails closed during preflight before any durable admission',async()=>{
 const {m,calls}=load();
 const i=valid();
 delete i.branch.a3_eligibility_input;
 const x=await m.createHermesMaintainerTrustedE2eOperationalPreparation({pool:{}}).prepare(i);
 assert.equal(x.prepared,false);
 assert.equal(x.stage,'operational_admission_preflight');
 assert.equal(calls.some(entry=>entry[0]==='branch'),false);
 assert.equal(calls.some(entry=>entry[0]==='edit'),false);
 assert.equal(calls.some(entry=>entry[0]==='pull'),false);
 assert.equal(calls.some(entry=>entry[0]==='workflow'),false);
});

test('rejects inconsistent target chain before consuming any durable authorization',async()=>{
 const {m,calls}=load();
 const i=valid();
 i.edit.target.branch='hermes/canary/other';
 const x=await m.createHermesMaintainerTrustedE2eOperationalPreparation({pool:{}}).prepare(i);
 assert.equal(x.prepared,false);
 assert.equal(x.stage,'workflow_target_preflight');
 assert.deepEqual(calls,[]);
});

test('rejects any invalid admission preflight before consuming durable authorization',async()=>{
 for(const stage of ['branch_preflight','edit_preflight','pull_preflight']){
  const {m,calls}=load(stage);
  const x=await m.createHermesMaintainerTrustedE2eOperationalPreparation({pool:{}}).prepare(valid());
  assert.equal(x.prepared,false);
  assert.equal(x.stage,'operational_admission_preflight');
  assert.equal(calls.some(entry=>['branch','edit','pull','workflow'].includes(entry[0])),false);
 }
});

test('rejects canary branch mismatch before consuming any durable authorization',async()=>{
 const {m,calls}=load();
 const i=valid();
 i.branch.canary.ref='refs/heads/hermes/canary/other';
 const x=await m.createHermesMaintainerTrustedE2eOperationalPreparation({pool:{}}).prepare(i);
 assert.equal(x.prepared,false);
 assert.equal(x.stage,'workflow_target_preflight');
 assert.deepEqual(calls,[]);
});
