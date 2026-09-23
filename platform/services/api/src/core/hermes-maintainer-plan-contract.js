'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { evaluateHermesMaintainerRequest } = require('./hermes-maintainer-request-contract');

const CONTRACT_VERSION='hermes_maintainer_plan_contract_v1';
const ACTION_ORDER=Object.freeze(['repository_read','repository_code_search','ci_read','test_execution','branch_prepare','code_edit_prepare','pull_request_prepare']);

function prepareHermesMaintainerPlan(input={}){
 const requests=Array.isArray(input.requests)?input.requests:[];
 const blockers=[];
 if(!isNonEmptyString(input.mission_id)) blockers.push('mission_id_invalid');
 if(requests.length<1) blockers.push('requests_required');
 const decisions=requests.map((request,index)=>{
   const result=evaluateHermesMaintainerRequest(request,input.foundation);
   if(!result.allowed) blockers.push(...result.blockers.map((b)=>`request_${index}::${b}`));
   return result;
 });
 const actions=requests.map(r=>isPlainObject(r)?r.action:null);
 for(let i=1;i<actions.length;i++){
   const prev=ACTION_ORDER.indexOf(actions[i-1]),cur=ACTION_ORDER.indexOf(actions[i]);
   if(prev<0||cur<0||cur<prev) blockers.push(`request_${i}::action_order_invalid`);
 }
 const unique=uniqueSorted(blockers);
 const ready=unique.length===0;
 return Object.freeze({
   contract_version:CONTRACT_VERSION,
   mission_id:isNonEmptyString(input.mission_id)?input.mission_id:'mission_not_available',
   status:ready?'MAINTAINER_PLAN_PREPARED_SIMULATION':'MAINTAINER_PLAN_BLOCKED',
   ready,
   request_count:requests.length,
   request_decisions:Object.freeze(decisions),
   executed:false,
   runtime_mutated:false,
   network_used:false,
   provider_called:false,
   secret_accessed:false,
   operational_authority_consumed:false,
   production_allowed:false,
   simulation:true,
   blockers:Object.freeze(unique)
 });
}

function validateHermesMaintainerPlan(plan){
 const errors=[];
 if(!isPlainObject(plan)) return {valid:false,errors:['plan_must_be_object']};
 const fields=['contract_version','mission_id','status','ready','request_count','request_decisions','executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed','production_allowed','simulation','blockers'];
 for(const k of Object.keys(plan)) if(!fields.includes(k)) errors.push(`plan_unknown_field::${k}`);
 for(const k of fields) if(!Object.prototype.hasOwnProperty.call(plan,k)) errors.push(`plan_missing_field::${k}`);
 if(plan.contract_version!==CONTRACT_VERSION) errors.push('contract_version_invalid');
 if(!isNonEmptyString(plan.mission_id)) errors.push('mission_id_invalid');
 if(!['MAINTAINER_PLAN_PREPARED_SIMULATION','MAINTAINER_PLAN_BLOCKED'].includes(plan.status)) errors.push('status_invalid');
 if(typeof plan.ready!=='boolean'||plan.ready!==(plan.status==='MAINTAINER_PLAN_PREPARED_SIMULATION')) errors.push('ready_status_mismatch');
 if(!Number.isInteger(plan.request_count)||plan.request_count<0||!Array.isArray(plan.request_decisions)||plan.request_count!==plan.request_decisions.length) errors.push('request_count_invalid');
 for(const f of ['executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed','production_allowed']) if(plan[f]!==false) errors.push(`${f}_must_be_false`);
 if(plan.simulation!==true) errors.push('simulation_must_be_true');
 if(!Array.isArray(plan.blockers)||!plan.blockers.every(isNonEmptyString)) errors.push('blockers_invalid');
 return {valid:errors.length===0,errors:uniqueSorted(errors)};
}
module.exports={ACTION_ORDER,CONTRACT_VERSION,prepareHermesMaintainerPlan,validateHermesMaintainerPlan};
