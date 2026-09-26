'use strict';

const {isCanonicalContentDigest}=require('./canonical-content-digest');

const CONTRACT_VERSION='hermes_maintainer_scm_write_authorization_request_v1';

function buildHermesMaintainerScmWriteAuthorizationRequest(binding){
 const blockers=[];
 if(!binding||binding.contract_version!=='hermes_maintainer_scm_write_approval_binding_v1'||binding.status!=='SCM_WRITE_APPROVAL_BOUND'||binding.approval_valid!==true)blockers.push('APPROVAL_BINDING_INVALID');
 if(!isCanonicalContentDigest(binding?.intent_digest))blockers.push('INTENT_DIGEST_INVALID');
 if(binding?.human_approval_required!==true||binding?.human_approval_present!==true||binding?.execution_authorized!==false)blockers.push('APPROVAL_STATE_INVALID');
 if(typeof binding?.approval_reference!=='string'||binding.approval_reference.trim()==='')blockers.push('APPROVAL_REFERENCE_INVALID');
 const valid=blockers.length===0;
 return Object.freeze({
  contract_version:CONTRACT_VERSION,
  status:valid?'SCM_WRITE_AUTHORIZATION_REQUEST_PREPARED':'SCM_WRITE_AUTHORIZATION_REQUEST_BLOCKED',
  request_valid:valid,
  intent_digest:binding?.intent_digest||null,
  operation:binding?.operation||null,
  repository:binding?.repository||null,
  base_ref:binding?.base_ref||null,
  branch_name:binding?.branch_name||null,
  approval_reference:valid?binding.approval_reference:null,
  human_approval_present:valid,
  execution_authorized:false,
  authorization_consumed:false,
  credential_material_present:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  blockers:Object.freeze([...new Set(blockers)].sort())
 });
}
module.exports={CONTRACT_VERSION,buildHermesMaintainerScmWriteAuthorizationRequest};
