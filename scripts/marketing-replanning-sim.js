const assert=require('node:assert/strict');const crypto=require('node:crypto');
function exactScope(a,b){return JSON.stringify(a)===JSON.stringify(b)}
function replan({objective,scope,rules,diagnosis}){
 const selected=[],rejected=[];
 for(const r of rules){if(r.validity!=='active')rejected.push({rule_id:r.rule_id,reason:'rule_not_active'});else if(!exactScope(r.scope,scope))rejected.push({rule_id:r.rule_id,reason:'scope_mismatch'});else if(r.confidence<.60)rejected.push({rule_id:r.rule_id,reason:'confidence_below_threshold'});else selected.push(r)}
 selected.sort((a,b)=>b.confidence-a.confidence||a.rule_id.localeCompare(b.rule_id));
 const best=selected[0],base=diagnosis?.next_test||{hypothesis:'Improve measurement before selecting a commercial intervention.',controlled_dimension:'measurement',primary_metric:'complete funnel coverage'};
 const hypothesis=best?base.hypothesis+' Historical same-scope evidence supports testing this direction; outcome is not guaranteed.':base.hypothesis;
 const seed=JSON.stringify({objective,scope,selected:selected.map(x=>x.rule_id),bottleneck:diagnosis?.primary_bottleneck});
 return {decision_id:'rp-'+crypto.createHash('sha256').update(seed).digest('hex').slice(0,12),objective,scope,selected_learning_refs:selected.map(x=>x.rule_id),rejected_learning_refs:rejected,recommended_test:{...base,hypothesis},external_execution:false,approval_required_for_execution:true,limitations:['historical learning is decision support, not a future outcome guarantee']};
}
function run(){const scope={channel:'instagram',store_id:'barreiros',audience:'women-25-35',format:'reel'};
 const rules=[{rule_id:'r1',scope,confidence:.8,validity:'active'},{rule_id:'r2',scope:{...scope,store_id:'sirinhaem'},confidence:.95,validity:'active'}];
 const diagnosis={primary_bottleneck:'whatsapp_to_sale',next_test:{hypothesis:'Test improved WhatsApp qualification.',controlled_dimension:'whatsapp_qualification',primary_metric:'direct sales per WhatsApp contact'}};
 const r=replan({objective:'increase direct sales',scope,rules,diagnosis});assert.deepEqual(r.selected_learning_refs,['r1']);assert.equal(r.rejected_learning_refs[0].reason,'scope_mismatch');assert.equal(r.external_execution,false);assert.equal(r.approval_required_for_execution,true);console.log('Marketing C07 replanning simulation: PASS')}
if(require.main===module)run();module.exports={exactScope,replan};
