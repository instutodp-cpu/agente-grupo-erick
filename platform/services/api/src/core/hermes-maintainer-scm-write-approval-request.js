'use strict';

const {verifyHermesMaintainerScmWriteIntentFingerprint}=require('./hermes-maintainer-scm-write-intent-fingerprint');

const CONTRACT_VERSION='hermes_maintainer_scm_write_approval_request_v1';

function buildHermesMaintainerScmWriteApprovalRequest(intent,fingerprint){
 const blockers=[];
 const verification=verifyHermesMaintainerScmWriteIntentFingerprint(intent,fingerprint);
 if(!verification.valid)blockers.push('INTENT_FINGERPRINT_INVALID');
 if(intent?.approval_required!==true||intent?.approval_present!==false||intent?.execution_authorized!==false)blockers.push('INTENT_STATE_INVALID');
 const valid=blockers.length===0;
 return Object.freeze({
  contract_version:CONTRACT_VERSION,
  status:valid?'SCM_WRITE_APPROVAL_REQUEST_PREPARED':'SCM_WRITE_APPROVAL_REQUEST_BLOCKED',
  request_valid:valid,
  intent_digest:fingerprint?.intent_digest||null,
  operation:intent?.operation||null,
  repository:intent?.repository||null,
  base_ref:intent?.base_ref||null,
  branch_name:intent?.branch_name||null,
  human_approval_required:true,
  human_approval_present:false,
  execution_authorized:false,
  credential_material_present:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  blockers:Object.freeze([...new Set(blockers)].sort())
 });
}

module.exports={CONTRACT_VERSION,buildHermesMaintainerScmWriteApprovalRequest};
