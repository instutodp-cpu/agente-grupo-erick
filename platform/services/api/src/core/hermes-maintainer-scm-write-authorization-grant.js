'use strict';

const {isCanonicalContentDigest}=require('./canonical-content-digest');

const CONTRACT_VERSION='hermes_maintainer_scm_write_authorization_grant_v1';

function grantHermesMaintainerScmWriteAuthorization(request,grant){
 const blockers=[];
 if(!request||request.contract_version!=='hermes_maintainer_scm_write_authorization_request_v1'||request.status!=='SCM_WRITE_AUTHORIZATION_REQUEST_PREPARED'||request.request_valid!==true)blockers.push('AUTHORIZATION_REQUEST_INVALID');
 if(!isCanonicalContentDigest(request?.intent_digest))blockers.push('INTENT_DIGEST_INVALID');
 if(request?.human_approval_present!==true||request?.execution_authorized!==false||request?.authorization_consumed!==false)blockers.push('REQUEST_STATE_INVALID');
 if(!grant||grant.decision!=='AUTHORIZED')blockers.push('AUTHORIZATION_NOT_GRANTED');
 if(grant?.intent_digest!==request?.intent_digest)blockers.push('AUTHORIZATION_DIGEST_MISMATCH');
 if(typeof grant?.authorization_reference!=='string'||grant.authorization_reference.trim()==='')blockers.push('AUTHORIZATION_REFERENCE_INVALID');
 const valid=blockers.length===0;
 return Object.freeze({
  contract_version:CONTRACT_VERSION,
  status:valid?'SCM_WRITE_AUTHORIZATION_GRANTED':'SCM_WRITE_AUTHORIZATION_BLOCKED',
  authorization_valid:valid,
  intent_digest:request?.intent_digest||null,
  operation:request?.operation||null,
  repository:request?.repository||null,
  base_ref:request?.base_ref||null,
  branch_name:request?.branch_name||null,
  approval_reference:request?.approval_reference||null,
  authorization_reference:valid?grant.authorization_reference:null,
  human_approval_present:valid,
  execution_authorized:valid,
  authorization_consumed:false,
  credential_material_present:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  blockers:Object.freeze([...new Set(blockers)].sort())
 });
}
module.exports={CONTRACT_VERSION,grantHermesMaintainerScmWriteAuthorization};
