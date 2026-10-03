const assert=require('node:assert/strict');const crypto=require('node:crypto');
function strategyDecision({objective,scope,research=[],diagnosis=null,economics=null,rules=[]}){
 if(!objective||!scope)return {status:'blocked',reason:'objective_and_scope_required',external_execution:false};
 const current=research.filter(x=>x.current!==false&&x.evidence_ref);
 if(!current.length)return {status:'blocked',reason:'current_evidence_required',external_execution:false};
 const applicable=rules.filter(r=>r.validity==='active'&&JSON.stringify(r.scope)===JSON.stringify(scope)&&r.confidence>=.60).sort((a,b)=>b.confidence-a.confidence);
 const next=diagnosis?.next_test||{hypothesis:'Measure the highest-friction funnel transition before intervention.',controlled_dimension:'measurement',primary_metric:'funnel coverage'};
 const limitations=[];if(!economics)limitations.push('commercial economics unavailable; do not infer profitability');
 const seed=JSON.stringify({objective,scope,evidence:current.map(x=>x.evidence_ref),rules:applicable.map(x=>x.rule_id),next});
 return {decision_id:'ms-'+crypto.createHash('sha256').update(seed).digest('hex').slice(0,12),status:'proposed',objective,scope,evidence_refs:current.map(x=>x.evidence_ref),learned_rule_refs:applicable.map(x=>x.rule_id),recommended_test:next,limitations,external_execution:false,approval_required_for_execution:true};
}
function run(){const scope={channel:'instagram',store_id:'barreiros',audience:'women-25-35'};const blocked=strategyDecision({objective:'increase qualified demand',scope});assert.equal(blocked.status,'blocked');const ok=strategyDecision({objective:'increase direct sales',scope,research:[{evidence_ref:'e1',current:true}],diagnosis:{next_test:{hypothesis:'Test CTA to qualified WhatsApp conversation.',controlled_dimension:'cta',primary_metric:'qualified WhatsApp contacts'}},rules:[{rule_id:'r1',scope,confidence:.8,validity:'active'}]});assert.equal(ok.status,'proposed');assert.deepEqual(ok.learned_rule_refs,['r1']);assert.equal(ok.external_execution,false);assert.equal(ok.approval_required_for_execution,true);assert.ok(ok.limitations.length);console.log('Marketing strategy simulation: PASS')}
if(require.main===module)run();module.exports={strategyDecision};
