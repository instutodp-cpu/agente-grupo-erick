'use strict';

const {executeHermesMaintainerGithubWriteE2eOperationalEntry}=require('./hermes-maintainer-github-write-e2e-operational-entry');

const ACCEPTANCE_VERSION='hermes_maintainer_github_write_operational_acceptance_gate_v1';

async function executeHermesMaintainerGithubWriteOperationalAcceptanceGate(grant,canary,input,options={}){
 const result=await executeHermesMaintainerGithubWriteE2eOperationalEntry(grant,canary,input,options);
 if(!result||result.status!=='E2E_DURABLE_WRITE_CLOSURE_CONFIRMED'||result.closure_valid!==true||result.durable!==true||
  result.execution?.status!=='GITHUB_DURABLE_WRITE_EXECUTION_SUCCEEDED'||result.receipt?.status!=='GITHUB_WRITE_DURABLE_FINALIZATION_CONFIRMED'||
  result.receipt?.receipt_valid!==true||result.network_call_performed!==true||result.write_performed!==true||result.production_used!==false){
  throw new TypeError('operational_acceptance_failed');
 }
 return Object.freeze({
  acceptance_version:ACCEPTANCE_VERSION,status:'OPERATIONAL_ACCEPTANCE_CONFIRMED',accepted:true,
  environment:'staging',durable:true,network_call_performed:true,write_performed:true,production_used:false,
  execution_status:result.execution.status,receipt_status:result.receipt.status
 });
}

module.exports={ACCEPTANCE_VERSION,executeHermesMaintainerGithubWriteOperationalAcceptanceGate};
