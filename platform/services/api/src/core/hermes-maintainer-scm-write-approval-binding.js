'use strict';

const {isCanonicalContentDigest}=require('./canonical-content-digest');

const CONTRACT_VERSION='hermes_maintainer_scm_write_approval_binding_v1';

function bindHermesMaintainerScmWriteApproval(request,approval){
 const blockers=[];
 if(!request||request.contract_version!=='hermes_maintainer_scm_write_approval_request_v1'||request.status!=='SCM_WRITE_APPROVAL_REQUEST_PREPARED'||request.request_valid!==true)blockers.push('APPROVAL_REQUEST_INVALID');
 if(!isCanonicalContentDigest(request?.intent_digest))blockers.push('INTENT_DIGEST_INVALID');
 if(!approval||approval.decision!=='APPROVED')blockers.push('APPROVAL_NOT_GRANTED');
 if(approval?.intent_digest!==request?.intent_digest)blockers.push('APPROVAL_DIGEST_MISMATCH');
 if(typeof approval?.approval_reference!=='string'||approval.approval_reference.trim()==='')blockers.push('APPROVAL_REFERENCE_INVALID');
 const valid=blockers.length===0;
 return Object.freeze({
  contract_version:CONTRACT_VERSION,
  status:valid?'SCM_WRITE_APPROVAL_BOUND':'SCM_WRITE_APPROVAL_BLOCKED',
  approval_valid:valid,
  intent_digest:request?.intent_digest||null,
  operation:request?.operation||null,
  repository:request?.repository||null,
  base_ref:request?.base_ref||null,
  branch_name:request?.branch_name||null,
  approval_reference:valid?approval.approval_reference:null,
  human_approval_required:true,
  human_approval_present:valid,
  execution_authorized:false,
  credential_material_present:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  blockers:Object.freeze([...new Set(blockers)].sort())
 });
}
module.exports={CONTRACT_VERSION,bindHermesMaintainerScmWriteApproval};
