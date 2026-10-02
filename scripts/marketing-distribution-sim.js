const assert=require('node:assert/strict');
const crypto=require('node:crypto');

function stable(v){if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));return v}
function hash(v){return crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex')}
function riskFor(action){if(['mutate_campaign','mutate_budget'].includes(action))return 'L3';if(['publish','send'].includes(action))return 'L2';return 'L1'}
function scopeFor(plan,target){return {artifact_hash:plan.artifact_hash,channel:target.channel,action:target.action,account_ref:target.account_ref||null,audience_ref:target.audience_ref||null,scheduled_for:target.scheduled_for||null}}
function prepareIntent(plan,target,approval,seen=new Set()){
 const risk=riskFor(target.action),scope_hash=hash(scopeFor(plan,target)),idempotency_key=hash({plan_id:plan.plan_id,target_id:target.target_id,scope_hash});
 if(seen.has(idempotency_key))return {status:'duplicate',idempotency_key,external_execution:false};
 if(risk!=='L1'){
   if(!approval||approval.status!=='approved')return {status:'blocked_approval',risk_level:risk,scope_hash,idempotency_key,external_execution:false};
   if(approval.scope_hash!==scope_hash||approval.artifact_hash!==plan.artifact_hash)return {status:'blocked_scope',risk_level:risk,scope_hash,idempotency_key,external_execution:false};
 }
 return {intent_id:'sim-'+idempotency_key.slice(0,12),plan_id:plan.plan_id,target_id:target.target_id,artifact_hash:plan.artifact_hash,scope_hash,idempotency_key,risk_level:risk,approval_ref:approval?.approval_id||null,mode:'simulation',external_execution:false,status:'prepared'};
}
function simulateReceipt(intent,seen){
 if(intent.status==='duplicate')return {idempotency_key:intent.idempotency_key,simulated:true,external_mutation:false,result:'duplicate_noop',reasons:['duplicate_idempotency_key']};
 if(intent.status!=='prepared')return {idempotency_key:intent.idempotency_key,simulated:true,external_mutation:false,result:'blocked',reasons:[intent.status]};
 seen.add(intent.idempotency_key);return {intent_id:intent.intent_id,idempotency_key:intent.idempotency_key,simulated:true,external_mutation:false,result:'would_execute',reasons:[]};
}
function run(){
 const plan={plan_id:'p1',artifact_hash:'a'.repeat(64)},target={target_id:'t1',channel:'instagram',action:'publish',account_ref:'ig-erick',audience_ref:null};
 const no=prepareIntent(plan,target,null);assert.equal(no.status,'blocked_approval');
 const scope_hash=hash(scopeFor(plan,target)),approval={approval_id:'ap1',status:'approved',scope_hash,artifact_hash:plan.artifact_hash};
 const seen=new Set(),ok=prepareIntent(plan,target,approval,seen);assert.equal(ok.status,'prepared');const receipt=simulateReceipt(ok,seen);assert.equal(receipt.external_mutation,false);
 assert.equal(prepareIntent(plan,target,approval,seen).status,'duplicate');
 const changed={...target,account_ref:'other'};assert.equal(prepareIntent(plan,changed,approval,new Set()).status,'blocked_scope');
 console.log('Marketing C06 approval/distribution simulation: PASS');
}
if(require.main===module)run();
module.exports={stable,hash,riskFor,scopeFor,prepareIntent,simulateReceipt};
