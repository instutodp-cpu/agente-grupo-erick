const assert=require('node:assert/strict');
const {planResearch}=require('./marketing-research-sim');
const {strategyDecision}=require('./marketing-strategy-sim');
const {selectFormat}=require('./marketing-creative-engine-sim');
const {buildContentPackage}=require('./marketing-content-production-sim');
const {productionQA}=require('./marketing-production-qa-sim');
const {prepareIntent}=require('./marketing-distribution-sim');
const {planLeadConversion}=require('./marketing-lead-conversion-sim');
const {candidate,promote}=require('./marketing-learning-feedback-sim');
const {replan}=require('./marketing-replanning-sim');
function runGoalCycle(input){
 const trace=[];const research=planResearch(input.research||{});trace.push({stage:'research',status:research.status});
 if(research.status!=='sufficient')return {status:'blocked',blocked_stage:'research',trace,external_execution:false};
 const strategy=strategyDecision(input.strategy);trace.push({stage:'strategy',status:strategy.status});
 if(strategy.status!=='proposed')return {status:'blocked',blocked_stage:'strategy',trace,external_execution:false};
 const creative=selectFormat(input.creative);trace.push({stage:'creative',status:'proposed'});
 const content=buildContentPackage({...input.content,format:creative.selected_format});trace.push({stage:'content',status:'drafted'});
 const qa=productionQA(content,input.known_facts||{});trace.push({stage:'qa',status:qa.decision});
 if(qa.decision!=='pass')return {status:'blocked',blocked_stage:'qa',research,strategy,creative,content,qa,trace,external_execution:false};
 const distribution=prepareIntent(input.distribution.plan,input.distribution.target,input.distribution.approval,new Set());trace.push({stage:'distribution',status:distribution.status});
 if(distribution.status!=='prepared')return {status:'blocked',blocked_stage:'distribution',research,strategy,creative,content,qa,distribution,trace,external_execution:false};
 const conversion=planLeadConversion(input.conversion);trace.push({stage:'lead_conversion',status:conversion.status});
 if(conversion.status!=='planned')return {status:'blocked',blocked_stage:'lead_conversion',trace,external_execution:false};
 const learning=candidate(input.learning.claim,input.learning.observations);trace.push({stage:'learning',status:learning.status});
 const rule=promote(learning,input.learning.observations);const rules=rule?[rule]:[];
 const replanning=replan({objective:input.strategy.objective,scope:input.strategy.scope,rules,diagnosis:input.diagnosis});trace.push({stage:'replanning',status:'planned'});
 return {status:'cycle_complete',research,strategy,creative,content,qa,distribution,conversion,learning,rule,replanning,trace,external_execution:false,requires_human_boundary:conversion.execution_eligible||replanning.approval_required_for_execution};
}
function sample(){const scope={channel:'instagram',store_id:'barreiros',audience:'women-25-35',format:'reel'};const observations=['e1','e2','e3'].map(evidence_ref=>({direction:'support',evidence_ref,scope}));return {research:{dependencies:['trend'],evidence:[{evidence_id:'research:1',freshness:'current'}]},strategy:{objective:'increase direct sales',scope,research:[{evidence_ref:'research:1',current:true}]},creative:{commercial_goal:'increase qualified WhatsApp conversations',available_assets:['product_video']},content:{commercial_objective:'increase direct sales',price:199,discount:10,stock:3,cta:'Fale no WhatsApp'},known_facts:{price:199,discount:10,stock:3},distribution:{plan:{plan_id:'p1',artifact_hash:'a'.repeat(64)},target:{target_id:'t1',channel:'instagram',action:'draft'}},conversion:{mission_id:'m1',lead:{lead_id:'l1',intent:'shoe',contact_channel:'whatsapp',consent_state:'granted'},offer:{price:199,stock:3}},learning:{claim:'Product-led Reel CTA improves qualified WhatsApp contacts',observations},diagnosis:{primary_bottleneck:'whatsapp_to_sale',next_test:{hypothesis:'Test improved WhatsApp qualification.',controlled_dimension:'qualification',primary_metric:'direct sales per WhatsApp contact'}}}}
function main(){const r=runGoalCycle(sample());assert.equal(r.status,'cycle_complete');assert.equal(r.external_execution,false);assert.ok(r.rule);assert.equal(r.replanning.selected_learning_refs.length,1);console.log('Marketing goal cycle simulation: PASS')}
if(require.main===module)main();module.exports={runGoalCycle,sample};
