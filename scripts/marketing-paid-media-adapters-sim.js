const assert=require('node:assert/strict');const seen=new Set();const actions=new Set(['create_campaign','change_budget','pause_campaign']);const providers=new Set(['meta_ads','google_ads']);
function execute(job,approval,providerResult='success'){
 if(job.simulation!==true)return deny(job,'simulation_required');
 if(!providers.has(job.provider))return deny(job,'unknown_provider');
 if(!actions.has(job.action))return deny(job,'unregistered_action');
 if(!approval||approval.status!=='approved'||approval.risk_level!=='L3')return deny(job,'explicit_l3_approval_required');
 if(approval.consumption?.single_use!==true)return deny(job,'single_use_required');
 if(approval.consumption?.consumed_at||approval.consumption?.consumed_by_intent)return deny(job,'approval_replay');
 if(approval.scope_hash!==job.scope_hash)return deny(job,'scope_mismatch');
 if(approval.artifact_hash!==job.artifact_hash)return deny(job,'artifact_mismatch');
 if(job.currency!=='BRL')return deny(job,'currency_not_allowed');
 if(!Number.isFinite(job.approved_budget_ceiling)||job.approved_budget_ceiling<0)return deny(job,'budget_ceiling_required');
 if(!Number.isFinite(job.requested_budget)||job.requested_budget<0)return deny(job,'invalid_requested_budget');
 if(job.requested_budget>job.approved_budget_ceiling)return deny(job,'budget_ceiling_exceeded');
 if(!job.idempotency_key||job.idempotency_key.length<16)return deny(job,'invalid_idempotency_key');
 if(seen.has(job.idempotency_key))return receipt(job,'duplicate_noop',false,null);
 if(providerResult==='ambiguous')return receipt(job,'ambiguous',true,'reconciliation_required');
 if(providerResult!=='success')return deny(job,'provider_failure');
 seen.add(job.idempotency_key);return receipt(job,'simulated_accepted',false,null);
}
function receipt(j,status,recon,reason){return{job_id:j.job_id,status,idempotency_key:j.idempotency_key,external_mutation:false,financial_effect:false,requires_reconciliation:recon,reason}}
function deny(j,reason){return receipt(j,'blocked',false,reason)}function reset(){seen.clear()}
function run(){reset();const j={job_id:'j',provider:'meta_ads',action:'create_campaign',intent_id:'i',approval_id:'a',scope_hash:'s',artifact_hash:'h',idempotency_key:'1234567890abcdef',currency:'BRL',requested_budget:100,approved_budget_ceiling:100,simulation:true};const a={status:'approved',risk_level:'L3',scope_hash:'s',artifact_hash:'h',consumption:{single_use:true,consumed_at:null,consumed_by_intent:null}};assert.equal(execute(j,a).status,'simulated_accepted');assert.equal(execute(j,a).status,'duplicate_noop');console.log('Marketing C08 paid media adapters simulation: PASS')}
if(require.main===module)run();module.exports={execute,reset};
