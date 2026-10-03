const assert=require('node:assert/strict');
const registry=require('../marketing/registry/integration-capabilities.json');
function route(req){
 const cap=registry.capabilities.find(x=>x.capability_id===req.capability_id);
 if(!cap)return {status:'denied',reason:'unregistered_capability',external_execution:false};
 if(!cap.allowed_actions.includes(req.action))return {status:'denied',reason:'action_not_allowed',external_execution:false};
 if(req.simulation!==true)return {status:'denied',reason:'simulation_required',external_execution:false};
 if((cap.risk_level==='L2'||cap.risk_level==='L3')&&!req.approval_ref)return {status:'denied',reason:'approval_required',external_execution:false};
 return {status:'simulated',capability_id:cap.capability_id,provider:cap.provider,risk_level:cap.risk_level,idempotency_key:req.idempotency_key,external_execution:false};
}
function run(){assert.equal(route({capability_id:'research.web',action:'search',simulation:true,approval_ref:null,idempotency_key:'k1'}).status,'simulated');assert.equal(route({capability_id:'social.publish',action:'publish',simulation:true,approval_ref:null,idempotency_key:'k2'}).reason,'approval_required');assert.equal(route({capability_id:'ads.mutate',action:'change_budget',simulation:true,approval_ref:'a1',idempotency_key:'k3'}).external_execution,false);console.log('Marketing C08 integration adapter simulation: PASS')}
if(require.main===module)run();module.exports={route};
