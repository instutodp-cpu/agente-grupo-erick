'use strict';
const {loadPublicWebThirdCanaryTargetConfig}=require('./public-web-canary-third-target-config');
const {PROVIDER_ID}=require('../core/public-web-transport-contract');
const {validatePublicWebStagingSecretReference}=require('../core/public-web-staging-secret-reference-contract');
const FLAG='HERMES_PUBLIC_WEB_REAL_CANARY_ENABLED', KILL='HERMES_PUBLIC_WEB_REAL_CANARY_KILL_SWITCH';
const BASE_FLAG='HERMES_PUBLIC_WEB_READ_ONLY_ENABLED', BASE_KILL='HERMES_PUBLIC_WEB_READ_ONLY_KILL_SWITCH';
const REFERENCE_ID='public_web_staging_public_reference';
function envTrue(env,key){return env?.[key]==='true';}
function createPublicWebCanaryOperationalControls({environment=process.env}={}){
 const target=loadPublicWebThirdCanaryTargetConfig(); if(!target.ok) throw new Error('approved_target_unavailable');
 const reference=Object.freeze({reference_id:REFERENCE_ID,reference_type:'public_web_staging_opaque_reference',provider_id:PROVIDER_ID,workspace_type:'corporate',tenant_id:'grupo_erick',environment:'staging',status:'reference_registered',reference_version:1,synthetic:true,disabled:false,revoked:false,required_secret_names:['public_web_public_access_handle'],metadata:{label:'public web staging public access',purpose:'public_web_canary_execution',classification:'public'}});
 const secretReferenceRegistry=Object.freeze({getSecretReference(id){return id===REFERENCE_ID?reference:null;}});
 const secretResolver=Object.freeze({
  canResolve(ref){const validation=validatePublicWebStagingSecretReference(ref);return validation.valid===true&&ref.reference_id===REFERENCE_ID;},
  resolveReference(ref,ctx){const valid=this.canResolve(ref)&&ctx&&ctx.environment==='staging'&&ctx.purpose==='public_web_canary_execution';return Object.freeze({resolved:valid,reference_id:valid?REFERENCE_ID:null,exportable:false,credential_material_present:false,blocked_reason:valid?null:'staging_secret_access_context_invalid'});}
 });
 return Object.freeze({target:target.config,secretReference:reference,secretReferenceRegistry,secretResolver,
  canaryFeatureFlagResolver:()=>envTrue(environment,FLAG),canaryKillSwitchResolver:()=>!Object.prototype.hasOwnProperty.call(environment,KILL)||envTrue(environment,KILL),
  featureFlagResolver:async(key)=>key===BASE_FLAG?envTrue(environment,BASE_FLAG):key===FLAG?envTrue(environment,FLAG):false,killSwitchResolver:async(key)=>key===BASE_KILL?(!Object.prototype.hasOwnProperty.call(environment,BASE_KILL)||envTrue(environment,BASE_KILL)):key===KILL?(!Object.prototype.hasOwnProperty.call(environment,KILL)||envTrue(environment,KILL)):true,
  flag_environment_key:FLAG,kill_switch_environment_key:KILL,base_flag_environment_key:BASE_FLAG,base_kill_switch_environment_key:BASE_KILL,production_allowed:false,credential_material_present:false});
}
module.exports={FLAG,KILL,BASE_FLAG,BASE_KILL,REFERENCE_ID,createPublicWebCanaryOperationalControls};
