const assert=require('node:assert/strict');
const {strategyDecision}=require('./marketing-strategy-sim');
const {planLeadConversion}=require('./marketing-lead-conversion-sim');
const {candidate,promote}=require('./marketing-learning-feedback-sim');
const {replan}=require('./marketing-replanning-sim');
function runGoalCycle(input){
 const trace=[];const strategy=strategyDecision(input.strategy);trace.push({stage:'strategy',status:strategy.status});
 if(strategy.status!=='proposed')return {status:'blocked',blocked_stage:'strategy',trace,external_execution:false};
 const conversion=planLeadConversion(input.conversion);trace.push({stage:'lead_conversion',status:conversion.status});
 if(conversion.status!=='planned')return {status:'blocked',blocked_stage:'lead_conversion',trace,external_execution:false};
 const learning=candidate(input.learning.claim,input.learning.observations);trace.push({stage:'learning',status:learning.status});
 const rule=promote(learning,input.learning.observations);const rules=rule?[rule]:[];
 const replanning=replan({objective:input.strategy.objective,scope:input.strategy.scope,rules,diagnosis:input.diagnosis});trace.push({stage:'replanning',status:'planned'});
 return {status:'cycle_complete',strategy,conversion,learning,rule,replanning,trace,external_execution:false,requires_human_boundary:conversion.execution_eligible||replanning.approval_required_for_execution};
}
function main(){const scope={channel:'instagram',store_id:'barreiros',audience:'women-25-35',format:'reel'};const observations=['e1','e2','e3'].map(evidence_ref=>({direction:'support',evidence_ref,scope}));const r=runGoalCycle({strategy:{objective:'increase direct sales',scope,research:[{evidence_ref:'research:1',current:true}]},conversion:{mission_id:'m1',lead:{lead_id:'l1',intent:'shoe',contact_channel:'whatsapp',consent_state:'granted'},offer:{price:199,stock:3}},learning:{claim:'Product-led Reel CTA improves qualified WhatsApp contacts',observations},diagnosis:{primary_bottleneck:'whatsapp_to_sale',next_test:{hypothesis:'Test improved WhatsApp qualification.',controlled_dimension:'qualification',primary_metric:'direct sales per WhatsApp contact'}}});assert.equal(r.status,'cycle_complete');assert.equal(r.external_execution,false);assert.ok(r.rule);assert.equal(r.replanning.selected_learning_refs.length,1);console.log('Marketing goal cycle simulation: PASS')}
if(require.main===module)main();module.exports={runGoalCycle};
