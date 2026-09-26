'use strict';

const {isCanonicalContentDigest}=require('./canonical-content-digest');

const CONTRACT_VERSION='hermes_maintainer_scm_write_authorization_consumption_v1';

function consumeHermesMaintainerScmWriteAuthorization(grant,consumption){
 const blockers=[];
 if(!grant||grant.contract_version!=='hermes_maintainer_scm_write_authorization_grant_v1'||grant.status!=='SCM_WRITE_AUTHORIZATION_GRANTED'||grant.authorization_valid!==true)blockers.push('AUTHORIZATION_GRANT_INVALID');
 if(!isCanonicalContentDigest(grant?.intent_digest))blockers.push('INTENT_DIGEST_INVALID');
 if(grant?.execution_authorized!==true||grant?.authorization_consumed!==false)blockers.push('AUTHORIZATION_STATE_INVALID');
 if(typeof grant?.authorization_reference!=='string'||grant.authorization_reference.trim()==='')blockers.push('AUTHORIZATION_REFERENCE_INVALID');
 if(!consumption||consumption.intent_digest!==grant?.intent_digest)blockers.push('CONSUMPTION_DIGEST_MISMATCH');
 if(consumption?.authorization_reference!==grant?.authorization_reference)blockers.push('CONSUMPTION_REFERENCE_MISMATCH');
 if(typeof consumption?.consumption_reference!=='string'||consumption.consumption_reference.trim()==='')blockers.push('CONSUMPTION_REFERENCE_INVALID');
 if(consumption?.already_consumed===true)blockers.push('AUTHORIZATION_ALREADY_CONSUMED');
 const valid=blockers.length===0;
 return Object.freeze({
  contract_version:CONTRACT_VERSION,
  status:valid?'SCM_WRITE_AUTHORIZATION_CONSUMED':'SCM_WRITE_AUTHORIZATION_CONSUMPTION_BLOCKED',
  consumption_valid:valid,
  intent_digest:grant?.intent_digest||null,
  operation:grant?.operation||null,
  repository:grant?.repository||null,
  base_ref:grant?.base_ref||null,
  branch_name:grant?.branch_name||null,
  approval_reference:grant?.approval_reference||null,
  authorization_reference:grant?.authorization_reference||null,
  consumption_reference:valid?consumption.consumption_reference:null,
  execution_authorized:valid,
  authorization_consumed:valid,
  single_use:true,
  replay_detected:consumption?.already_consumed===true,
  credential_material_present:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  blockers:Object.freeze([...new Set(blockers)].sort())
 });
}
module.exports={CONTRACT_VERSION,consumeHermesMaintainerScmWriteAuthorization};
