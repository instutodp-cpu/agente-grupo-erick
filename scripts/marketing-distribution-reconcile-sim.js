const assert=require('node:assert/strict');
const crypto=require('node:crypto');
function id(prefix,payload){return prefix+'-'+crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0,12)}
function ambiguous(intent,reason='timeout_after_request_sent'){
 return {intent_id:intent.intent_id,idempotency_key:intent.idempotency_key,status:'reconciliation_required',reason,auto_retry:false,external_execution:false};
}
function reconcile(intent,observation,evidence=[]){
 let decision='remain_ambiguous';
 if(observation==='confirmed_effect')decision='confirm_success';
 else if(observation==='not_found'&&evidence.length)decision='authorize_same_key_retry';
 else if(observation==='conflicting_effect')decision='block_conflict';
 return {reconciliation_id:id('rec',{intent:intent.intent_id,observation,evidence}),intent_id:intent.intent_id,idempotency_key:intent.idempotency_key,provider_observation:observation,provider_ref:null,decision,external_execution:false,evidence};
}
function auditEvent(intent,event_type,details={},seq=1){
 return {event_id:id('evt',{intent:intent.intent_id,event_type,seq,details}),intent_id:intent.intent_id,idempotency_key:intent.idempotency_key,event_type,occurred_at:'SIMULATED',simulation:true,external_mutation:false,details};
}
function appendAudit(log,event){return Object.freeze([...log,Object.freeze({...event})])}
function authorizeRetry(rec){
 return {authorized:rec.decision==='authorize_same_key_retry',idempotency_key:rec.idempotency_key,new_intent:false,external_execution:false};
}
function run(){
 const i={intent_id:'i1',idempotency_key:'k'.repeat(64)};
 const a=ambiguous(i);assert.equal(a.auto_retry,false);
 const confirmed=reconcile(i,'confirmed_effect',['provider_ref:123']);assert.equal(confirmed.decision,'confirm_success');
 const nf=reconcile(i,'not_found',['provider_lookup_by_idempotency_key']);assert.equal(authorizeRetry(nf).authorized,true);assert.equal(authorizeRetry(nf).idempotency_key,i.idempotency_key);
 assert.equal(reconcile(i,'not_found',[]).decision,'remain_ambiguous');
 assert.equal(reconcile(i,'conflicting_effect',['provider_ref:other']).decision,'block_conflict');
 let log=[];log=appendAudit(log,auditEvent(i,'attempt_ambiguous'));log=appendAudit(log,auditEvent(i,'reconciliation_started',{},2));assert.equal(log.length,2);
 console.log('Marketing C06 reconciliation/audit simulation: PASS');
}
if(require.main===module)run();
module.exports={ambiguous,reconcile,auditEvent,appendAudit,authorizeRetry};
