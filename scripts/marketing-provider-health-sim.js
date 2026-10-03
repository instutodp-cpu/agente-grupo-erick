const assert=require('node:assert/strict');
function route(req,health){
 if(!health)return decision(req,'blocked_unknown',null,'health_evidence_missing');
 if(health.simulation!==true||health.real_provider_enabled!==false)return decision(req,'blocked_unknown',health.adapter_id,'unsafe_health_evidence');
 if(health.status==='unknown')return decision(req,'blocked_unknown',health.adapter_id,'health_unknown');
 if(health.status==='unavailable')return decision(req,'blocked_unavailable',health.adapter_id,'provider_unavailable');
 if(!health.capabilities?.includes(req.capability))return decision(req,'blocked_capability',health.adapter_id,'capability_not_declared');
 if(health.status==='degraded'&&req.mutation===true)return decision(req,'blocked_unavailable',health.adapter_id,'degraded_mutation_blocked');
 return decision(req,'route_simulated',health.adapter_id,health.status==='degraded'?'degraded_read_only':null);
}
function decision(req,d,a,reason){return{capability:req.capability,selected_adapter_id:d==='route_simulated'?a:null,decision:d,health_evidence_ref:req.health_evidence_ref||null,reason,simulation:true,external_execution:false}}
function observe(id,adapter,event,detail=null){return{observation_id:id,adapter_id:adapter,event_type:event,observed_at:'SIMULATED_TIME',detail,simulation:true,external_effect:false}}
function run(){const h={adapter_id:'analytics.meta',status:'healthy',capabilities:['analytics.read'],simulation:true,real_provider_enabled:false};assert.equal(route({capability:'analytics.read',mutation:false,health_evidence_ref:'h1'},h).decision,'route_simulated');assert.equal(route({capability:'social.publish',mutation:true,health_evidence_ref:'h2'},{...h,status:'degraded',capabilities:['social.publish']}).decision,'blocked_unavailable');console.log('Marketing C08 provider health routing simulation: PASS')}
if(require.main===module)run();module.exports={route,observe};
