'use strict';
const {loadPublicWebThirdCanaryTargetConfig}=require('./public-web-canary-third-target-config');
const FLAG='HERMES_PUBLIC_WEB_REAL_CANARY_ENABLED', KILL='HERMES_PUBLIC_WEB_REAL_CANARY_KILL_SWITCH';
const REFERENCE_ID='public_web_staging_public_reference';
function envTrue(env,key){return env?.[key]==='true';}
function createPublicWebCanaryOperationalControls({environment=process.env}={}){
 const target=loadPublicWebThirdCanaryTargetConfig(); if(!target.ok) throw new Error('approved_target_unavailable');
 const reference=Object.freeze({reference_id:REFERENCE_ID,reference_type:'public_web_staging_opaque_reference',provider_id:'public_web_read_only',workspace_type:'corporate',tenant_id:'grupo_erick',environment:'staging',status:'reference_registered',reference_version:1,synthetic:true,disabled:false,revoked:false,required_secret_names:['public_web_public_access_handle'],metadata:{label:'public web staging public access',purpose:'public_web_canary_execution',classification:'public'}});
 const secretReferenceRegistry=Object.freeze({getSecretReference(id){return id===REFERENCE_ID?reference:null;}});
 const secretResolver=Object.freeze({resolveReference(ref,ctx){const valid=ref&&ref.reference_id===REFERENCE_ID&&ctx&&ctx.environment==='staging'&&ctx.purpose==='public_web_canary_execution';return Object.freeze({resolved:valid,reference_id:valid?REFERENCE_ID:null,exportable:false,credential_material_present:false,blocked_reason:valid?null:'staging_secret_access_context_invalid'});}});
 return Object.freeze({target:target.config,secretReference:reference,secretReferenceRegistry,secretResolver,
  featureFlagResolver:async()=>envTrue(environment,FLAG),killSwitchResolver:async()=>!Object.prototype.hasOwnProperty.call(environment,KILL)||envTrue(environment,KILL),
  flag_environment_key:FLAG,kill_switch_environment_key:KILL,production_allowed:false,credential_material_present:false});
}
module.exports={FLAG,KILL,REFERENCE_ID,createPublicWebCanaryOperationalControls};
