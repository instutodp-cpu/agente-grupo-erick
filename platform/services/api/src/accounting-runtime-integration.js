'use strict';

const { CAPABILITIES } = require('../../../../src/hermes/accounting/operational-control-plane');

const MODES=Object.freeze(['SIMULATION','SHADOW']);
function req(v,f){if(v===undefined||v===null||v==='')throw new Error(`${f} is required`);}
function buildAccountingRuntimeHandoff(i={}){
 for(const f of ['handoffId','tenantId','organizationId','projectId','sessionReferenceId','actorId','operationId','capability','idempotencyKey','mode'])req(i[f],f);
 if(!CAPABILITIES.includes(i.capability))throw new Error('unsupported accounting capability');
 if(!MODES.includes(i.mode))throw new Error('C25_ONLY_SIMULATION_OR_SHADOW');
 return Object.freeze({
  contract:'HERMES_ACCOUNTING_RUNTIME_HANDOFF_V1',
  ...i,
  executed:false,
  externalEffectAllowed:false,
  realProviderAllowed:false,
  requiresCanonicalExecutionJob:true,
  requiresCanonicalExecutionAttempt:true,
  requiresDurableAdmission:true
 });
}
function validateAccountingRuntimeHandoff(h){
 const blockers=[];
 if(h?.contract!=='HERMES_ACCOUNTING_RUNTIME_HANDOFF_V1')blockers.push('CONTRACT_INVALID');
 if(!CAPABILITIES.includes(h?.capability))blockers.push('CAPABILITY_INVALID');
 if(!MODES.includes(h?.mode))blockers.push('MODE_NOT_ALLOWED');
 if(h?.executed!==false)blockers.push('EXECUTED_MUST_BE_FALSE');
 if(h?.externalEffectAllowed!==false)blockers.push('EXTERNAL_EFFECT_MUST_BE_FALSE');
 if(h?.realProviderAllowed!==false)blockers.push('REAL_PROVIDER_MUST_BE_FALSE');
 for(const f of ['tenantId','organizationId','projectId','sessionReferenceId','actorId','operationId','idempotencyKey'])if(!h?.[f])blockers.push(`${f}_REQUIRED`);
 return Object.freeze({valid:blockers.length===0,blockers:Object.freeze(blockers)});
}
async function admitAccountingRuntime({handoff,runtime}={}){
 const validation=validateAccountingRuntimeHandoff(handoff);
 if(!validation.valid)return Object.freeze({status:'BLOCKED',reason:'HANDOFF_INVALID',blockers:validation.blockers,executed:false});
 if(!runtime||typeof runtime.admitExecutionJob!=='function'||typeof runtime.materializeExecutionAttempt!=='function'||typeof runtime.admitExecutionAttempt!=='function'){
  return Object.freeze({status:'BLOCKED',reason:'CANONICAL_RUNTIME_UNAVAILABLE',executed:false});
 }
 const job=await runtime.admitExecutionJob(handoff);
 if(!job||!['ADMITTED','EXISTING_IDENTICAL'].includes(job.outcome))return Object.freeze({status:'BLOCKED',reason:'JOB_ADMISSION_DENIED',executed:false,job});
 const attempt=await runtime.materializeExecutionAttempt({handoff,job});
 if(!attempt)return Object.freeze({status:'BLOCKED',reason:'ATTEMPT_MATERIALIZATION_FAILED',executed:false,job});
 const admission=await runtime.admitExecutionAttempt({handoff,job,attempt});
 if(!admission||admission.outcome!=='ADMITTED')return Object.freeze({status:'BLOCKED',reason:'ATTEMPT_ADMISSION_DENIED',executed:false,job,attempt,admission});
 return Object.freeze({status:'ADMITTED_SIMULATION',mode:handoff.mode,executed:false,externalEffectAllowed:false,job,attempt,admission});
}
module.exports={MODES,buildAccountingRuntimeHandoff,validateAccountingRuntimeHandoff,admitAccountingRuntime};
