'use strict';

const {computeCanonicalContentDigest,isCanonicalContentDigest}=require('./canonical-content-digest');

const CONTRACT_VERSION='hermes_maintainer_scm_write_intent_fingerprint_v1';

function material(v){
 return {contract_version:v.contract_version,status:v.status,intent_valid:v.intent_valid,provider:v.provider,operation:v.operation,repository:v.repository,base_ref:v.base_ref,branch_name:v.branch_name,approval_required:v.approval_required,approval_present:v.approval_present,execution_authorized:v.execution_authorized};
}
function fingerprintHermesMaintainerScmWriteIntent(v){
 if(!v||v.contract_version!=='hermes_maintainer_scm_write_intent_v1'||v.status!=='SCM_WRITE_INTENT_PREPARED'||v.intent_valid!==true||v.approval_required!==true||v.approval_present!==false||v.execution_authorized!==false||v.network_call_performed!==false||v.write_performed!==false) throw new TypeError('prepared SCM write intent required');
 return Object.freeze({contract_version:CONTRACT_VERSION,intent_contract_version:v.contract_version,intent_digest:computeCanonicalContentDigest(material(v)),operation:v.operation,repository:v.repository,base_ref:v.base_ref,branch_name:v.branch_name});
}
function verifyHermesMaintainerScmWriteIntentFingerprint(v,f){
 const errors=[];
 if(!f||f.contract_version!==CONTRACT_VERSION)errors.push('fingerprint_contract_invalid');
 if(!isCanonicalContentDigest(f?.intent_digest))errors.push('intent_digest_invalid');
 let expected=null;try{expected=fingerprintHermesMaintainerScmWriteIntent(v);}catch{errors.push('intent_not_prepared');}
 if(expected&&f.intent_digest!==expected.intent_digest)errors.push('intent_digest_mismatch');
 for(const k of ['operation','repository','base_ref','branch_name'])if(expected&&f[k]!==expected[k])errors.push(`${k}_mismatch`);
 return {valid:errors.length===0,errors:Object.freeze([...new Set(errors)].sort())};
}
module.exports={CONTRACT_VERSION,fingerprintHermesMaintainerScmWriteIntent,verifyHermesMaintainerScmWriteIntentFingerprint};
