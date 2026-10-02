'use strict';
const CONTRACT_VERSION='hermes_maintainer_e2e_workflow_contract_v1';
const STEPS=Object.freeze([
 Object.freeze({order:1,action:'repository_read',mode:'operational_read_only',authority:'github_read_only_staging'}),
 Object.freeze({order:2,action:'branch_prepare',mode:'governed_mutation',durable_operation:'create_branch'}),
 Object.freeze({order:3,action:'code_edit_prepare',mode:'governed_mutation',durable_operation:'update_file'}),
 Object.freeze({order:4,action:'test_execution',mode:'operational_dependency_required'}),
 Object.freeze({order:5,action:'pull_request_prepare',mode:'governed_mutation',durable_operation:'create_pull_request',draft_required:true})
]);
function buildHermesMaintainerE2eWorkflowContract(){
 return Object.freeze({contract_version:CONTRACT_VERSION,status:'MAINTAINER_E2E_WORKFLOW_DEFINED',steps:STEPS,read_only_first:true,test_before_pull_request:true,draft_pull_request_only:true,production_allowed:false,merge_authority:false,human_merge_required:true,execution_ready:false,blockers:Object.freeze(['test_execution_operational_composition_missing'])});
}
function validateHermesMaintainerE2eWorkflowContract(v){
 const errors=[];
 if(!v||v.contract_version!==CONTRACT_VERSION)errors.push('contract_version_invalid');
 if(v?.status!=='MAINTAINER_E2E_WORKFLOW_DEFINED'||v?.steps!==STEPS)errors.push('workflow_invalid');
 if(v?.read_only_first!==true||v?.test_before_pull_request!==true||v?.draft_pull_request_only!==true)errors.push('workflow_guards_invalid');
 if(v?.production_allowed!==false||v?.merge_authority!==false||v?.human_merge_required!==true)errors.push('authority_boundary_invalid');
 if(v?.execution_ready!==false||!Array.isArray(v?.blockers)||!v.blockers.includes('test_execution_operational_composition_missing'))errors.push('missing_dependency_not_declared');
 return{valid:errors.length===0,errors};
}
module.exports={CONTRACT_VERSION,STEPS,buildHermesMaintainerE2eWorkflowContract,validateHermesMaintainerE2eWorkflowContract};
