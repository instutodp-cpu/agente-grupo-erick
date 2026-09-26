'use strict';

const {createHermesMaintainerProcessRuntime}=require('./hermes-maintainer-process-env-binding');
const {checkHermesMaintainerCredentialReadiness}=require('./hermes-maintainer-credential-readiness');

const EVIDENCE_VERSION='hermes_maintainer_runtime_readiness_evidence_v1';

async function collectHermesMaintainerRuntimeReadinessEvidence({runtimeFactory=createHermesMaintainerProcessRuntime}={}){
 if(typeof runtimeFactory!=='function')throw new TypeError('runtimeFactory required');
 try{
  const runtime=runtimeFactory();
  const readiness=await checkHermesMaintainerCredentialReadiness(runtime);
  return Object.freeze({
   evidence_version:EVIDENCE_VERSION,
   environment:'staging',
   credential_reference:readiness.credential_reference,
   ready:readiness.ready===true,
   credential_material_present:false,
   reason:readiness.reason
  });
 }catch(_error){
  return Object.freeze({
   evidence_version:EVIDENCE_VERSION,
   environment:'staging',
   credential_reference:'github_read_only_staging',
   ready:false,
   credential_material_present:false,
   reason:'RUNTIME_UNAVAILABLE'
  });
 }
}

module.exports={EVIDENCE_VERSION,collectHermesMaintainerRuntimeReadinessEvidence};
