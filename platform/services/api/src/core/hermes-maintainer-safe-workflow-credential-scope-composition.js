'use strict';
const {isPlainObject,uniqueSorted}=require('./read-only-adapter-contract');
const {ADMITTED,validateHermesMaintainerSafeWorkflowAdmissionComposition}=require('./hermes-maintainer-safe-workflow-admission-composition');
const {CAPABILITY:CREATE_BRANCH_CAPABILITY,defineHermesMaintainerGithubWriteCredentialScope}=require('./hermes-maintainer-github-write-credential-scope');
const {CAPABILITY:UPDATE_FILE_CAPABILITY,defineHermesMaintainerGithubUpdateFileCredentialScope}=require('./hermes-maintainer-github-update-file-credential-scope');
const {CAPABILITY:CREATE_PR_CAPABILITY,defineHermesMaintainerGithubCreatePullRequestCredentialScope}=require('./hermes-maintainer-github-create-pull-request-credential-scope');
const CONTRACT_VERSION='hermes_maintainer_safe_workflow_credential_scope_composition_v1';
const SCOPED='MAINTAINER_SAFE_WORKFLOW_CREDENTIAL_SCOPE_COMPOSED_SIMULATION',BLOCKED='MAINTAINER_SAFE_WORKFLOW_CREDENTIAL_SCOPE_COMPOSITION_BLOCKED';
const CONFIG=Object.freeze({
 create_branch:Object.freeze({capability:CREATE_BRANCH_CAPABILITY,define:defineHermesMaintainerGithubWriteCredentialScope}),
 update_file:Object.freeze({capability:UPDATE_FILE_CAPABILITY,define:defineHermesMaintainerGithubUpdateFileCredentialScope}),
 create_pull_request:Object.freeze({capability:CREATE_PR_CAPABILITY,define:defineHermesMaintainerGithubCreatePullRequestCredentialScope})
});
function composeHermesMaintainerSafeWorkflowCredentialScope(admissionComposition){
 const blockers=[],av=validateHermesMaintainerSafeWorkflowAdmissionComposition(admissionComposition);
 if(!av.valid)blockers.push(...av.errors.map(e=>'admission_composition::'+e));
 if(av.valid&&(admissionComposition.status!==ADMITTED||admissionComposition.admission_composed!==true||admissionComposition.execution_authorized!==true))blockers.push('admission_composition_not_ready');
 const config=CONFIG[admissionComposition?.durable_operation];let scope=null;
 if(!config)blockers.push('durable_operation_unsupported');
 if(blockers.length===0)scope=config.define({capability:config.capability,provider:'GITHUB',operation:admissionComposition.durable_operation,environment:'staging',repository:'instutodp-cpu/agente-grupo-erick'});
 if(scope&&scope.scope_valid!==true)blockers.push(...(scope.blockers||[]).map(e=>'credential_scope::'+e));
 const u=uniqueSorted(blockers),ok=u.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,mission_id:ok?admissionComposition.mission_id:'mission_not_available',workflow_digest:ok?admissionComposition.workflow_digest:null,intent_digest:ok?admissionComposition.intent_digest:null,durable_operation:ok?admissionComposition.durable_operation:null,ownership_key:ok?admissionComposition.ownership_key:null,attempt_reference:ok?admissionComposition.attempt_reference:null,capability_reference:ok?admissionComposition.capability_reference:null,admission_reference:ok?admissionComposition.admission_reference:null,status:ok?SCOPED:BLOCKED,credential_scope_composed:ok,credential_scope:ok?scope:null,credential_scope_contract:ok?scope.contract_version:null,credential_reference:ok?scope.credential_reference:null,credential_resolution_required:ok,credential_resolution_invoked:false,credential_material_present:false,authorization_header_present:false,authority_consumed:ok,execution_boundary_invoked:false,execution_authorized:ok,network_authorized:false,credentials_authorized:false,write_authorized:false,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,provider_called:false,secret_accessed:false,operational_authority_consumed:ok,blockers:Object.freeze(u)});
}
function validateHermesMaintainerSafeWorkflowCredentialScopeComposition(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['credential_scope_composition_must_be_object']};const ok=v.status===SCOPED;
 if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');if(![SCOPED,BLOCKED].includes(v.status)||v.credential_scope_composed!==ok)e.push('status_invalid');
 if(ok&&(!isPlainObject(v.credential_scope)||v.credential_scope.scope_valid!==true||v.credential_scope.credential_material_present!==false||v.credential_scope.credential_resolution_performed!==false||v.credential_scope.authorization_header_present!==false||v.credential_scope.network_call_performed!==false||v.credential_scope.write_performed!==false||v.credential_scope.production_used!==false))e.push('credential_scope_invalid');
 for(const f of ['credential_resolution_invoked','credential_material_present','authorization_header_present','execution_boundary_invoked','network_authorized','credentials_authorized','write_authorized','merge_authority','production_allowed','provider_called','secret_accessed'])if(v[f]!==false)e.push(f+'_must_be_false');
 for(const f of ['credential_resolution_required','authority_consumed','execution_authorized','operational_authority_consumed'])if(v[f]!==ok)e.push(f+'_invalid');
 if(v.human_merge_required!==true)e.push('human_merge_required_must_be_true');if(v.simulation!==true)e.push('simulation_must_be_true');if(!Array.isArray(v.blockers))e.push('blockers_invalid');
 return{valid:e.length===0,errors:uniqueSorted(e)};
}
module.exports={BLOCKED,CONTRACT_VERSION,SCOPED,composeHermesMaintainerSafeWorkflowCredentialScope,validateHermesMaintainerSafeWorkflowCredentialScopeComposition};
