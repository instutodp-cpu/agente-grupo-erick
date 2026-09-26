'use strict';
const {isPlainObject,isNonEmptyString}=require('./read-only-adapter-contract');
const CONTRACT_VERSION='hermes_maintainer_github_repository_reader_contract_v1';
const PROVIDER='GITHUB';
function buildHermesMaintainerGithubRepositoryReaderRequest(input){
 const blockers=[];
 if(!isPlainObject(input))blockers.push('INPUT_INVALID');
 if(input?.provider!==PROVIDER)blockers.push('PROVIDER_INVALID');
 if(!isNonEmptyString(input?.repository)||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository))blockers.push('REPOSITORY_INVALID');
 if(!isNonEmptyString(input?.ref))blockers.push('REF_INVALID');
 if(!isNonEmptyString(input?.path))blockers.push('PATH_INVALID');
 if(input?.method!=='GET'||input?.read_only!==true)blockers.push('READ_ONLY_BOUNDARY_INVALID');
 const valid=blockers.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,status:valid?'GITHUB_REPOSITORY_READER_REQUEST_PREPARED_STAGING':'GITHUB_REPOSITORY_READER_REQUEST_BLOCKED',request_valid:valid,provider:PROVIDER,repository:input?.repository||null,ref:input?.ref||null,path:input?.path||null,method:'GET',read_only:true,credential_reference_required:true,credential_material_present:false,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze([...new Set(blockers)].sort())});
}
function validateHermesMaintainerGithubRepositoryReaderRequest(v){
 const e=[];
 if(!isPlainObject(v))return{valid:false,errors:['REQUEST_MUST_BE_OBJECT']};
 if(v.contract_version!==CONTRACT_VERSION||v.status!=='GITHUB_REPOSITORY_READER_REQUEST_PREPARED_STAGING'||v.request_valid!==true)e.push('REQUEST_INVALID');
 if(v.provider!==PROVIDER||!isNonEmptyString(v.repository)||!isNonEmptyString(v.ref)||!isNonEmptyString(v.path)||v.method!=='GET'||v.read_only!==true)e.push('READ_BOUNDARY_INVALID');
 if(v.credential_reference_required!==true||v.credential_material_present!==false||v.network_call_performed!==false||v.write_performed!==false||v.production_used!==false)e.push('AUTHORITY_INVALID');
 if(!Array.isArray(v.blockers)||v.blockers.length)e.push('BLOCKERS_INVALID');
 return{valid:e.length===0,errors:[...new Set(e)].sort()};
}
module.exports={CONTRACT_VERSION,buildHermesMaintainerGithubRepositoryReaderRequest,validateHermesMaintainerGithubRepositoryReaderRequest};
