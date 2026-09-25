'use strict';
const {isNonEmptyString,isPlainObject,uniqueSorted}=require('./read-only-adapter-contract');
const RECEIPT_VERSION='hermes_maintainer_scm_read_durable_consumption_receipt_v1';
const CONTRACT_VERSION='hermes_maintainer_scm_read_access_contract_v1';
const ALLOWED_OPERATIONS=Object.freeze(['ci_read','repository_code_search','repository_read']);
function buildHermesMaintainerScmReadAccessRequest(receipt){
 const b=[];
 if(!isPlainObject(receipt)||receipt.contract_version!==RECEIPT_VERSION)b.push('receipt_invalid');
 if(receipt?.status!=='MAINTAINER_SCM_READ_DURABLE_CONSUMPTION_CONFIRMED'||receipt?.durable_consumption_confirmed!==true)b.push('durable_consumption_unconfirmed');
 for(const k of ['receipt_fingerprint','capability_fingerprint','consumption_fingerprint','consumption_id','mission_id','operation','repository','base_ref','executor_id'])if(!isNonEmptyString(receipt?.[k]))b.push(k+'_invalid');
 if(!ALLOWED_OPERATIONS.includes(receipt?.operation))b.push('operation_not_read_only');
 if(receipt?.persistence_outcome!=='CREATED')b.push('persistence_not_created');
 if(receipt?.execution_allowed!==false||receipt?.network_authorized!==false||receipt?.credentials_authorized!==false||receipt?.write_authorized!==false||receipt?.provider_called!==false||receipt?.execution_performed!==false||receipt?.production_allowed!==false)b.push('upstream_boundary_invalid');
 if(!Array.isArray(receipt?.blockers)||receipt.blockers.length)b.push('receipt_blocked');
 const blockers=uniqueSorted(b),valid=blockers.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,status:valid?'MAINTAINER_SCM_READ_ACCESS_REQUEST_PREPARED_STAGING':'MAINTAINER_SCM_READ_ACCESS_REQUEST_BLOCKED',request_valid:valid,receipt_fingerprint:receipt?.receipt_fingerprint||null,capability_fingerprint:receipt?.capability_fingerprint||null,mission_id:receipt?.mission_id||null,operation:receipt?.operation||null,repository:receipt?.repository||null,base_ref:receipt?.base_ref||null,executor_id:receipt?.executor_id||null,access_mode:'READ_ONLY_STAGING',credential_reference_required:true,credential_material_present:false,credential_resolved:false,network_authorized:false,credentials_authorized:false,write_authorized:false,provider_called:false,execution_allowed:false,execution_performed:false,production_allowed:false,blockers:Object.freeze(blockers)});
}
function validateHermesMaintainerScmReadAccessRequest(v){const e=[];if(!isPlainObject(v))return{valid:false,errors:['request_must_be_object']};if(v.contract_version!==CONTRACT_VERSION||v.status!=='MAINTAINER_SCM_READ_ACCESS_REQUEST_PREPARED_STAGING'||v.request_valid!==true)e.push('request_invalid');for(const k of ['receipt_fingerprint','capability_fingerprint','mission_id','operation','repository','base_ref','executor_id'])if(!isNonEmptyString(v[k]))e.push(k+'_invalid');if(!ALLOWED_OPERATIONS.includes(v.operation)||v.access_mode!=='READ_ONLY_STAGING'||v.credential_reference_required!==true||v.credential_material_present!==false||v.credential_resolved!==false||v.network_authorized!==false||v.credentials_authorized!==false||v.write_authorized!==false||v.provider_called!==false||v.execution_allowed!==false||v.execution_performed!==false||v.production_allowed!==false)e.push('boundary_invalid');if(!Array.isArray(v.blockers)||v.blockers.length)e.push('blockers_invalid');return{valid:e.length===0,errors:uniqueSorted(e)};}
module.exports={CONTRACT_VERSION,ALLOWED_OPERATIONS,buildHermesMaintainerScmReadAccessRequest,validateHermesMaintainerScmReadAccessRequest};
