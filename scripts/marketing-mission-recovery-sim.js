const assert=require('node:assert/strict');
function decide(c){const base={case_id:c.case_id,retry_allowed:false,compensation_allowed:false,human_required:false,external_effect:false,simulation:true};
if(c.effect_state==='confirmed')return{...base,decision:'confirm_effect_and_continue',reason:'external effect confirmed; do not retry'};
if(c.effect_state==='conflicting')return{...base,decision:'escalate_conflict',human_required:true,reason:'provider evidence conflicts'};
if(c.failure_class==='ambiguous'||c.effect_state==='unknown')return{...base,decision:'escalate_ambiguous',human_required:true,reason:'effect cannot be proven'};
if(c.failure_class==='terminal')return{...base,decision:'block_terminal',reason:'terminal failure is not retryable'};
if(c.failure_class==='stuck'||c.failure_class==='deadline_exceeded')return{...base,decision:'escalate_stuck',human_required:true,reason:'mission requires intervention'};
if(c.failure_class==='transient'&&c.effect_state==='none')return{...base,decision:'retry_same_idempotency_key',retry_allowed:true,reason:'transient failure with no effect'};
if(c.effect_state==='not_found'&&c.traceable_evidence===true)return{...base,decision:'retry_same_idempotency_key',retry_allowed:true,reason:'effect proven absent'};
return{...base,decision:'escalate_ambiguous',human_required:true,reason:'insufficient evidence'};
}
function main(){assert.equal(decide({case_id:'c1',failure_class:'ambiguous',effect_state:'unknown'}).decision,'escalate_ambiguous');console.log('Marketing C09 mission recovery simulation: PASS')}if(require.main===module)main();module.exports={decide};
