'use strict';
const {prepareHermesMaintainerTrustedE2eApprovalRequests}=require('./hermes-maintainer-trusted-e2e-approval-request-preparation');
const {bindHermesMaintainerTrustedE2eHumanApprovals}=require('./hermes-maintainer-trusted-e2e-human-approval-binding');
const {prepareHermesMaintainerTrustedE2eAuthorizationRequests}=require('./hermes-maintainer-trusted-e2e-authorization-request-preparation');
const CONTRACT_VERSION='hermes_maintainer_trusted_e2e_external_decision_adapter_v1';
const KEYS=Object.freeze(['branch','edit','pull_request']);
function blocked(stage,value){return Object.freeze({contract_version:CONTRACT_VERSION,status:'TRUSTED_E2E_EXTERNAL_DECISIONS_BLOCKED',adapted:false,stage,value:value||null,human_decisions:null,authorization_decisions:null,execution_authorized:false,authorization_consumed:false,production_used:false,merge_authority:false,human_merge_required:true});}
function ref(v){return typeof v==='string'&&v.trim()!==''?v:null;}
function adaptHermesMaintainerTrustedE2eExternalDecisions(input={}){
 const refs=input.references;
 if(!refs)return blocked('external_references',null);
 const approvals=prepareHermesMaintainerTrustedE2eApprovalRequests({branch_name:input.branch_name});
 if(approvals.prepared!==true)return blocked('approval_requests',approvals);
 const human={};
 for(const k of KEYS){const r=ref(refs[k]?.approval_reference);if(!r)return blocked('human_references',null);human[k]=Object.freeze({decision:'APPROVED',intent_digest:approvals.approval_requests[k].intent_digest,approval_reference:r});}
 const bindings=bindHermesMaintainerTrustedE2eHumanApprovals({approval_requests:approvals.approval_requests,decisions:human});
 if(bindings.bound!==true)return blocked('human_approval_bindings',bindings);
 const requests=prepareHermesMaintainerTrustedE2eAuthorizationRequests({approval_bindings:bindings.approval_bindings});
 if(requests.prepared!==true)return blocked('authorization_requests',requests);
 const authorization={};
 for(const k of KEYS){const r=ref(refs[k]?.authorization_reference);if(!r)return blocked('authorization_references',null);authorization[k]=Object.freeze({decision:'AUTHORIZED',intent_digest:requests.authorization_requests[k].intent_digest,authorization_reference:r});}
 return Object.freeze({contract_version:CONTRACT_VERSION,status:'TRUSTED_E2E_EXTERNAL_DECISIONS_ADAPTED',adapted:true,human_decisions:Object.freeze(human),authorization_decisions:Object.freeze(authorization),execution_authorized:false,authorization_consumed:false,production_used:false,merge_authority:false,human_merge_required:true});
}
module.exports={CONTRACT_VERSION,adaptHermesMaintainerTrustedE2eExternalDecisions};
