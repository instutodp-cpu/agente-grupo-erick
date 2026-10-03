'use strict';
const {createHermesMaintainerTrustedE2eOperationalPreparation}=require('./hermes-maintainer-trusted-e2e-operational-preparation');
const {runHermesMaintainerTrustedE2eStagingCanary,CONFIRMATION}=require('./hermes-maintainer-trusted-e2e-staging-canary-entry');
const COMPOSITION_VERSION='hermes_maintainer_trusted_e2e_operational_canary_v1';
function blocked(stage,value){return Object.freeze({composition_version:COMPOSITION_VERSION,status:'MAINTAINER_TRUSTED_E2E_OPERATIONAL_CANARY_BLOCKED',completed:false,stage,value:value||null,production_used:false,merge_authority:false,human_merge_required:true});}
function createHermesMaintainerTrustedE2eOperationalCanary(options={}){
 const preparation=createHermesMaintainerTrustedE2eOperationalPreparation({pool:options.pool});
 return Object.freeze({composition_version:COMPOSITION_VERSION,async execute(input={}){
  if(input.confirmation!==CONFIRMATION)return blocked('explicit_confirmation');
  if(options.environment?.NODE_ENV!=='staging')return blocked('staging_environment');
  const prepared=await preparation.prepare(input.operational);
  if(prepared?.prepared!==true)return blocked('operational_preparation',prepared);
  const result=await runHermesMaintainerTrustedE2eStagingCanary({...options,input:{confirmation:CONFIRMATION,workflow:prepared.workflow}});
  if(result?.completed!==true)return blocked('staging_canary',result);
  return Object.freeze({composition_version:COMPOSITION_VERSION,status:'MAINTAINER_TRUSTED_E2E_OPERATIONAL_CANARY_COMPLETED',completed:true,canary:result,production_used:false,merge_authority:false,human_merge_required:true});
 }});
}
module.exports={COMPOSITION_VERSION,createHermesMaintainerTrustedE2eOperationalCanary};
