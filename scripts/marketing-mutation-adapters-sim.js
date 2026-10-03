const assert=require('node:assert/strict');const seen=new Set();
const allowed={'social.publish':new Set(['publish','schedule']),'whatsapp.send':new Set(['send'])};
function execute(job,approval,provider='success'){
 if(job.simulation!==true)return deny(job,'simulation_required');
 if(!allowed[job.capability_id]||!allowed[job.capability_id].has(job.action))return deny(job,'unregistered_action');
 if(!approval||approval.status!=='approved')return deny(job,'approval_required');
 if(approval.consumption?.single_use!==true)return deny(job,'single_use_required');
 if(approval.consumption?.consumed_at||approval.consumption?.consumed_by_intent)return deny(job,'approval_replay');
 if(approval.scope_hash!==job.scope_hash)return deny(job,'scope_mismatch');
 if(approval.artifact_hash!==job.artifact_hash)return deny(job,'artifact_mismatch');
 if(!job.idempotency_key||job.idempotency_key.length<16)return deny(job,'invalid_idempotency_key');
 if(seen.has(job.idempotency_key))return receipt(job,'duplicate_noop',false,null);
 if(provider==='ambiguous')return receipt(job,'ambiguous',true,'reconciliation_required');
 if(provider!=='success')return deny(job,'provider_failure');
 seen.add(job.idempotency_key);return receipt(job,'simulated_accepted',false,null);
}
function receipt(j,status,requires_reconciliation,reason){return{job_id:j.job_id,status,idempotency_key:j.idempotency_key,external_mutation:false,requires_reconciliation,reason}}
function deny(j,reason){return receipt(j,'blocked',false,reason)}
function reset(){seen.clear()}
function run(){reset();const j={job_id:'j',capability_id:'social.publish',action:'publish',intent_id:'i',approval_id:'a',scope_hash:'s',artifact_hash:'h',idempotency_key:'1234567890abcdef',simulation:true};const a={status:'approved',scope_hash:'s',artifact_hash:'h',consumption:{single_use:true,consumed_at:null,consumed_by_intent:null}};assert.equal(execute(j,a).status,'simulated_accepted');assert.equal(execute(j,a).status,'duplicate_noop');console.log('Marketing C08 mutation adapters simulation: PASS')}
if(require.main===module)run();module.exports={execute,reset};
