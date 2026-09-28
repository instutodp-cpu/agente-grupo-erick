'use strict';

const {checkHermesMaintainerGithubWriteE2eRuntimeReadiness}=require('./hermes-maintainer-github-write-e2e-runtime-readiness');
const {createHermesMaintainerGithubWriteE2eProcessRuntime}=require('./hermes-maintainer-github-write-e2e-process-runtime');

const OPERATIONAL_ENTRY_VERSION='hermes_maintainer_github_write_e2e_operational_entry_v1';

async function executeHermesMaintainerGithubWriteE2eOperationalEntry(input,{runtimeOptions={}}={}){
 const readiness=await checkHermesMaintainerGithubWriteE2eRuntimeReadiness(runtimeOptions);
 if(readiness.status!=='READY'||readiness.ready!==true)throw new TypeError('e2e_runtime_not_ready');
 let runtime;
 try{
  runtime=createHermesMaintainerGithubWriteE2eProcessRuntime(runtimeOptions);
  return await runtime.execute(input);
 }finally{
  if(runtime)await runtime.close();
 }
}

module.exports={OPERATIONAL_ENTRY_VERSION,executeHermesMaintainerGithubWriteE2eOperationalEntry};
