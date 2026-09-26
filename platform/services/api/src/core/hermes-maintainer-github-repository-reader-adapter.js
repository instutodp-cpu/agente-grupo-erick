'use strict';
const {validateHermesMaintainerGithubRepositoryReaderRequest}=require('./hermes-maintainer-github-repository-reader-contract');
const CONTRACT_VERSION='hermes_maintainer_github_repository_reader_adapter_v1';
async function invokeHermesMaintainerGithubRepositoryReader(request,runtime){
 const v=validateHermesMaintainerGithubRepositoryReaderRequest(request);
 if(!v.valid)return result('BLOCKED',false,false,null,'REQUEST_INVALID');
 if(!runtime||typeof runtime.readGithubRepositoryPath!=='function')return result('BLOCKED',false,false,null,'TRUSTED_RUNTIME_UNAVAILABLE');
 let raw;
 try{raw=await runtime.readGithubRepositoryPath(Object.freeze({repository:request.repository,ref:request.ref,path:request.path,method:'GET',read_only:true}));}
 catch{return result('FAILED',true,true,null,'GITHUB_READ_FAILED');}
 if(!raw||raw.ok!==true||typeof raw.content!=='string')return result('FAILED',true,true,null,'GITHUB_RESPONSE_INVALID');
 return result('SUCCEEDED',true,true,Object.freeze({path:request.path,content:raw.content,sha:typeof raw.sha==='string'?raw.sha:null}),null);
}
function result(outcome,called,performed,data,blocker){return Object.freeze({contract_version:CONTRACT_VERSION,outcome,provider:'GITHUB',read_only:true,network_call_performed:called,execution_performed:performed,credential_material_present:false,write_performed:false,production_used:false,data,blockers:Object.freeze(blocker?[blocker]:[])});}
module.exports={CONTRACT_VERSION,invokeHermesMaintainerGithubRepositoryReader};
