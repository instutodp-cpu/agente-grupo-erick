'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { validateHermesMaintainerPlan } = require('./hermes-maintainer-plan-contract');
const { verifyHermesMaintainerPlanFingerprint } = require('./hermes-maintainer-plan-fingerprint');

const CONTRACT_VERSION='hermes_maintainer_step_contract_v1';
const ACTION_TO_STEP=Object.freeze({
 repository_read:'READ_PREPARATION',
 repository_code_search:'SEARCH_PREPARATION',
 ci_read:'CI_READ_PREPARATION',
 test_execution:'TEST_PREPARATION',
 branch_prepare:'BRANCH_PREPARATION',
 code_edit_prepare:'CODE_EDIT_PREPARATION',
 pull_request_prepare:'PULL_REQUEST_PREPARATION'
});

function prepareHermesMaintainerSteps(plan,fingerprint){
 const blockers=[];
 const pv=validateHermesMaintainerPlan(plan);
 if(!pv.valid) blockers.push(...pv.errors.map(e=>`plan::${e}`));
 const fv=verifyHermesMaintainerPlanFingerprint(plan,fingerprint);
 if(!fv.valid) blockers.push(...fv.errors.map(e=>`fingerprint::${e}`));
 if(plan&&plan.ready!==true) blockers.push('plan_not_ready');
 const decisions=plan&&Array.isArray(plan.request_decisions)?plan.request_decisions:[];
 const steps=decisions.map((decision,index)=>{
   const action=decision&&decision.action_decision&&decision.action_decision.action;
   if(!isNonEmptyString(action)||!ACTION_TO_STEP[action]) blockers.push(`step_${index}::action_not_supported`);
   if(!decision||decision.allowed!==true) blockers.push(`step_${index}::request_not_allowed`);
   return Object.freeze({step_index:index,action:isNonEmptyString(action)?action:'action_not_available',step_kind:ACTION_TO_STEP[action]||'BLOCKED',prepared:decision&&decision.allowed===true&&Boolean(ACTION_TO_STEP[action]),executed:false,runtime_mutated:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false});
 });
 const unique=uniqueSorted(blockers),ready=unique.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,mission_id:plan&&isNonEmptyString(plan.mission_id)?plan.mission_id:'mission_not_available',status:ready?'MAINTAINER_STEPS_PREPARED_SIMULATION':'MAINTAINER_STEPS_BLOCKED',ready,step_count:steps.length,steps:Object.freeze(steps),executed:false,runtime_mutated:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,production_allowed:false,simulation:true,blockers:Object.freeze(unique)});
}
function validateHermesMaintainerSteps(value){
 const errors=[];
 if(!isPlainObject(value)) return {valid:false,errors:['steps_must_be_object']};
 if(value.contract_version!==CONTRACT_VERSION) errors.push('contract_version_invalid');
 if(!isNonEmptyString(value.mission_id)) errors.push('mission_id_invalid');
 if(!['MAINTAINER_STEPS_PREPARED_SIMULATION','MAINTAINER_STEPS_BLOCKED'].includes(value.status)) errors.push('status_invalid');
 if(typeof value.ready!=='boolean'||value.ready!==(value.status==='MAINTAINER_STEPS_PREPARED_SIMULATION')) errors.push('ready_status_mismatch');
 if(!Number.isInteger(value.step_count)||value.step_count<0||!Array.isArray(value.steps)||value.step_count!==value.steps.length) errors.push('step_count_invalid');
 if(Array.isArray(value.steps)) value.steps.forEach((s,i)=>{if(!isPlainObject(s)||s.step_index!==i||s.executed!==false||s.runtime_mutated!==false||s.network_used!==false||s.provider_called!==false||s.secret_accessed!==false||s.operational_authority_consumed!==false) errors.push(`step_${i}_invalid`);});
 for(const f of ['executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed','production_allowed']) if(value[f]!==false) errors.push(`${f}_must_be_false`);
 if(value.simulation!==true) errors.push('simulation_must_be_true');
 if(!Array.isArray(value.blockers)||!value.blockers.every(isNonEmptyString)) errors.push('blockers_invalid');
 return {valid:errors.length===0,errors:uniqueSorted(errors)};
}
module.exports={ACTION_TO_STEP,CONTRACT_VERSION,prepareHermesMaintainerSteps,validateHermesMaintainerSteps};
