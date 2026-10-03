'use strict';
const {prepareHermesMaintainerTrustedE2eApprovalRequests}=require('./hermes-maintainer-trusted-e2e-approval-request-preparation');
const {bindHermesMaintainerTrustedE2eHumanApprovals}=require('./hermes-maintainer-trusted-e2e-human-approval-binding');
const {prepareHermesMaintainerTrustedE2eAuthorizationRequests}=require('./hermes-maintainer-trusted-e2e-authorization-request-preparation');
const {bindHermesMaintainerTrustedE2eAuthorizationGrants}=require('./hermes-maintainer-trusted-e2e-authorization-grant-binding');
const {buildHermesMaintainerTrustedE2eOperationalInput}=require('./hermes-maintainer-trusted-e2e-operational-input-builder');
const CONTRACT_VERSION='hermes_maintainer_trusted_e2e_authorized_operational_composition_v1';
function blocked(stage,value){return Object.freeze({contract_version:CONTRACT_VERSION,status:'TRUSTED_E2E_AUTHORIZED_OPERATIONAL_BLOCKED',prepared:false,stage,value:value||null,operational:null,authorization_consumed:false,production_used:false,merge_authority:false,human_merge_required:true});}
function prepareHermesMaintainerTrustedE2eAuthorizedOperational(input={}){
 const approvals=prepareHermesMaintainerTrustedE2eApprovalRequests({branch_name:input.branch_name});
 if(approvals.prepared!==true)return blocked('approval_requests',approvals);
 const bindings=bindHermesMaintainerTrustedE2eHumanApprovals({approval_requests:approvals.approval_requests,decisions:input.human_decisions});
 if(bindings.bound!==true)return blocked('human_approval_bindings',bindings);
 const requests=prepareHermesMaintainerTrustedE2eAuthorizationRequests({approval_bindings:bindings.approval_bindings});
 if(requests.prepared!==true)return blocked('authorization_requests',requests);
 const grants=bindHermesMaintainerTrustedE2eAuthorizationGrants({authorization_requests:requests.authorization_requests,decisions:input.authorization_decisions});
 if(grants.granted!==true)return blocked('authorization_grants',grants);
 const evidence=input.operational_evidence||{};
 const built=buildHermesMaintainerTrustedE2eOperationalInput({...evidence,branch:{...evidence.branch,grant:grants.authorization_grants.branch},edit:{...evidence.edit,grant:grants.authorization_grants.edit},pull_request:{...evidence.pull_request,grant:grants.authorization_grants.pull_request}});
 if(built.input_valid!==true)return blocked('operational_input',built);
 return Object.freeze({contract_version:CONTRACT_VERSION,status:'TRUSTED_E2E_AUTHORIZED_OPERATIONAL_PREPARED',prepared:true,stage:'prepared',operational:built.operational,authorization_consumed:false,production_used:false,merge_authority:false,human_merge_required:true});
}
module.exports={CONTRACT_VERSION,prepareHermesMaintainerTrustedE2eAuthorizedOperational};