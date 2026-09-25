'use strict';
const {isNonEmptyString,isPlainObject,uniqueSorted}=require('./read-only-adapter-contract');
const ACCESS_VERSION='hermes_maintainer_scm_read_access_contract_v1';
const CONTRACT_VERSION='hermes_maintainer_scm_read_network_boundary_v1';
const ALLOWED_OPERATIONS=Object.freeze(['ci_read','repository_code_search','repository_read']);
function buildHermesMaintainerScmReadNetworkBoundary(access){
 const b=[];
 if(!isPlainObject(access)||access.contract_version!==ACCESS_VERSION||access.status!=='MAINTAINER_SCM_READ_ACCESS_REQUEST_PREPARED_STAGING'||access.request_valid!==true)b.push('access_request_invalid');
 for(const k of ['receipt_fingerprint','capability_fingerprint','mission_id','operation','repository','base_ref','executor_id'])if(!isNonEmptyString(access?.[k]))b.push(k+'_invalid');
 if(!ALLOWED_OPERATIONS.includes(access?.operation))b.push('operation_not_read_only');
 if(access?.access_mode!=='READ_ONLY_STAGING')b.push('access_mode_invalid');
 if(access?.credential_reference_required!==true||access?.credential_material_present!==false||access?.credential_resolved!==false)b.push('credential_boundary_invalid');
 if(access?.network_authorized!==false||access?.credentials_authorized!==false||access?.write_authorized!==false||access?.provider_called!==false||access?.execution_allowed!==false||access?.execution_performed!==false||access?.production_allowed!==false)b.push('upstream_authority_invalid');
 if(!Array.isArray(access?.blockers)||access.blockers.length)b.push('access_blocked');
 const blockers=uniqueSorted(b),ready=blockers.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,status:ready?'MAINTAINER_SCM_READ_NETWORK_BOUNDARY_PREPARED_STAGING':'MAINTAINER_SCM_READ_NETWORK_BOUNDARY_BLOCKED',boundary_ready:ready,receipt_fingerprint:access?.receipt_fingerprint||null,capability_fingerprint:access?.capability_fingerprint||null,mission_id:access?.mission_id||null,operation:access?.operation||null,repository:access?.repository||null,base_ref:access?.base_ref||null,executor_id:access?.executor_id||null,allowed_protocol:'HTTPS',allowed_method:'GET',allowed_host_class:'SCM_PROVIDER_API',read_only:true,network_request_prepared:ready,network_authorized:false,credential_reference_required:true,credential_resolved:false,credentials_authorized:false,write_authorized:false,provider_called:false,execution_allowed:false,execution_performed:false,production_allowed:false,blockers:Object.freeze(blockers)});
}
function validateHermesMaintainerScmReadNetworkBoundary(v){const e=[];if(!isPlainObject(v))return{valid:false,errors:['boundary_must_be_object']};if(v.contract_version!==CONTRACT_VERSION||v.status!=='MAINTAINER_SCM_READ_NETWORK_BOUNDARY_PREPARED_STAGING'||v.boundary_ready!==true)e.push('boundary_invalid');for(const k of ['receipt_fingerprint','capability_fingerprint','mission_id','operation','repository','base_ref','executor_id'])if(!isNonEmptyString(v[k]))e.push(k+'_invalid');if(!ALLOWED_OPERATIONS.includes(v.operation)||v.allowed_protocol!=='HTTPS'||v.allowed_method!=='GET'||v.allowed_host_class!=='SCM_PROVIDER_API'||v.read_only!==true||v.network_request_prepared!==true||v.network_authorized!==false||v.credential_reference_required!==true||v.credential_resolved!==false||v.credentials_authorized!==false||v.write_authorized!==false||v.provider_called!==false||v.execution_allowed!==false||v.execution_performed!==false||v.production_allowed!==false)e.push('authority_invalid');if(!Array.isArray(v.blockers)||v.blockers.length)e.push('blockers_invalid');return{valid:e.length===0,errors:uniqueSorted(e)};}
module.exports={CONTRACT_VERSION,ALLOWED_OPERATIONS,buildHermesMaintainerScmReadNetworkBoundary,validateHermesMaintainerScmReadNetworkBoundary};
