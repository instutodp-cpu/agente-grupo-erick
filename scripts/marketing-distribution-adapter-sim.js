const assert=require('node:assert/strict');

function adapterFor(channel){return ['instagram','whatsapp','meta_ads','google_ads'].includes(channel)?channel:'generic'}
function prepareAdapterJob(intent,target,nowMs){
 if(!intent?.idempotency_key)return {status:'terminal_failure',reason:'missing_idempotency_key',external_execution:false};
 const due=target.scheduled_for?Date.parse(target.scheduled_for):null;
 return {job_id:'job-'+intent.idempotency_key.slice(0,12),intent_ref:intent.intent_id,adapter:adapterFor(target.channel),idempotency_key:intent.idempotency_key,scheduled_for:target.scheduled_for||null,attempt:1,max_attempts:3,mode:'simulation',external_execution:false,status:due&&nowMs<due?'scheduled':'ready'};
}
function runAttempt(job,outcome,ledger=new Map()){
 if(ledger.get(job.idempotency_key)==='success')return receipt(job,'duplicate_noop','already_succeeded',false);
 if(job.status==='scheduled')return receipt(job,'scheduled','not_due_yet',false);
 if(job.attempt>job.max_attempts)return receipt(job,'terminal_failure','attempts_exhausted',false);
 if(outcome==='transient_failure'){
   if(job.attempt>=job.max_attempts)return receipt(job,'terminal_failure','attempts_exhausted',false);
   return receipt(job,'retryable_failure','transient_provider_failure',true);
 }
 if(outcome==='terminal_failure')return receipt(job,'terminal_failure','terminal_provider_failure',false);
 ledger.set(job.idempotency_key,'success');return receipt(job,'would_execute',null,false);
}
function receipt(job,outcome,reason,retry){return {job_id:job.job_id,idempotency_key:job.idempotency_key,attempt:job.attempt,simulated:true,external_mutation:false,outcome,reason,retry_same_idempotency_key:retry}}
function retryJob(job){return {...job,attempt:job.attempt+1,status:'ready',idempotency_key:job.idempotency_key}}
function markDue(job,nowMs){if(job.status!=='scheduled')return job;const due=Date.parse(job.scheduled_for);return nowMs>=due?{...job,status:'ready'}:job}

function run(){
 const intent={intent_id:'i1',idempotency_key:'a'.repeat(64)},future='2030-01-01T12:00:00.000Z';
 let job=prepareAdapterJob(intent,{channel:'instagram',scheduled_for:future},Date.parse('2030-01-01T11:00:00.000Z'));assert.equal(job.status,'scheduled');
 job=markDue(job,Date.parse(future));assert.equal(job.status,'ready');
 const ledger=new Map();let r=runAttempt(job,'transient_failure',ledger);assert.equal(r.outcome,'retryable_failure');const key=job.idempotency_key;job=retryJob(job);assert.equal(job.idempotency_key,key);
 r=runAttempt(job,'success',ledger);assert.equal(r.outcome,'would_execute');assert.equal(r.external_mutation,false);
 assert.equal(runAttempt(retryJob(job),'success',ledger).outcome,'duplicate_noop');
 console.log('Marketing C06 adapter scheduling/retry simulation: PASS');
}
if(require.main===module)run();
module.exports={adapterFor,prepareAdapterJob,runAttempt,retryJob,markDue};
