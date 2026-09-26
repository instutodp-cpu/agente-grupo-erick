'use strict';

const READINESS_VERSION='hermes_maintainer_credential_readiness_v1';
const REFERENCE='github_read_only_staging';

async function checkHermesMaintainerCredentialReadiness(runtime){
 if(!runtime||typeof runtime.resolveAuthorization!=='function'){
  return Object.freeze({readiness_version:READINESS_VERSION,credential_reference:REFERENCE,ready:false,credential_material_present:false,reason:'RUNTIME_UNAVAILABLE'});
 }
 try{
  const resolution=await runtime.resolveAuthorization(REFERENCE);
  const ready=Boolean(resolution&&resolution.ok===true&&typeof resolution.authorization==='string'&&resolution.authorization.length>0);
  return Object.freeze({
   readiness_version:READINESS_VERSION,
   credential_reference:REFERENCE,
   ready,
   credential_material_present:false,
   reason:ready?'READY':'CREDENTIAL_UNAVAILABLE'
  });
 }catch(_error){
  return Object.freeze({readiness_version:READINESS_VERSION,credential_reference:REFERENCE,ready:false,credential_material_present:false,reason:'CREDENTIAL_UNAVAILABLE'});
 }
}

module.exports={READINESS_VERSION,REFERENCE,checkHermesMaintainerCredentialReadiness};
