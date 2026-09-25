'use strict';
const {validateHermesMaintainerReadRuntimeAuthorization}=require('./hermes-maintainer-read-runtime-authorization');
const CONTRACT_VERSION='hermes_maintainer_trusted_repository_read_adapter_v1';
async function invokeHermesMaintainerTrustedRepositoryRead(auth,request,adapter){
 const v=validateHermesMaintainerReadRuntimeAuthorization(auth);
 if(!v.valid)return result('BLOCKED',false,false,null,'AUTHORIZATION_INVALID');
 if(!request||request.repository!==auth.repository||request.ref!==auth.base_ref||typeof request.path!=='string'||!request.path.length)return result('BLOCKED',false,false,null,'REQUEST_SCOPE_INVALID');
 if(request.method!==undefined&&request.method!=='GET')return result('BLOCKED',false,false,null,'METHOD_NOT_READ_ONLY');
 if(!adapter||typeof adapter.readRepositoryPath!=='function')return result('BLOCKED',false,false,null,'TRUSTED_ADAPTER_UNAVAILABLE');
 let raw;
 try{raw=await adapter.readRepositoryPath(Object.freeze({provider:'GITHUB',repository:auth.repository,ref:auth.base_ref,path:request.path,method:'GET',read_only:true}));}
 catch{return result('FAILED',true,true,null,'PROVIDER_READ_FAILED');}
 if(!raw||raw.ok!==true||typeof raw.content!=='string')return result('FAILED',true,true,null,'PROVIDER_RESPONSE_INVALID');
 return result('SUCCEEDED',true,true,Object.freeze({path:request.path,content:raw.content,sha:typeof raw.sha==='string'?raw.sha:null}),null);
}
function result(outcome,called,performed,data,blocker){return Object.freeze({contract_version:CONTRACT_VERSION,outcome,read_only:true,provider_called:called,execution_performed:performed,write_performed:false,production_used:false,data,blockers:Object.freeze(blocker?[blocker]:[])});}
module.exports={CONTRACT_VERSION,invokeHermesMaintainerTrustedRepositoryRead};
