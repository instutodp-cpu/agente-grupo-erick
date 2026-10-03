const assert=require('node:assert/strict');const {runGoalCycle,sample:goalSample}=require('./marketing-goal-cycle-sim');
const stages=['objective','research','strategy','creative','production','qa','approval','distribution','lead_conversion','measurement','learning','replanning'];
function runMission(input){
 const results=[];for(const stage of stages){const gate=check(stage,input);results.push({stage,status:gate.ok?'passed':'blocked',evidence_ref:gate.evidence||null,reason:gate.reason||null});if(!gate.ok)return result(input,stage,results,'blocked')}
 return result(input,'completed',results,'completed');
}
function check(stage,i){
 if(stage==='objective'&&!i.objective)return no('objective_missing');
 if(stage==='research'&&!i.research_evidence)return no('research_evidence_missing');if(stage==='research')return yes(i.research_evidence);
 if(stage==='strategy'&&!i.strategy_ref)return no('strategy_missing');
 if(stage==='creative'&&!i.creative_ref)return no('creative_missing');
 if(stage==='production'&&!i.production_ref)return no('production_missing');
 if(stage==='qa'&&i.qa_passed!==true)return no('qa_failed');
 if(stage==='approval'&&['L2','L3'].includes(i.risk_level)&&i.approval_valid!==true)return no('approval_required');
 if(stage==='distribution'&&i.distribution_simulated!==true)return no('simulation_distribution_required');
 if(stage==='lead_conversion'&&!i.lead_conversion_ref)return no('lead_conversion_missing');
 if(stage==='measurement'&&!i.measurement_ref)return no('measurement_evidence_missing');
 if(stage==='learning'&&i.learning_eligible!==true)return no('learning_not_eligible');
 if(stage==='replanning'&&i.active_learning!==true)return no('active_learning_required');
 return yes(i[stage+'_ref']);
}
function runIntegratedMission(input){const mission=runMission(input.mission);if(mission.status!=='completed')return{status:'blocked',blocked_stage:'mission:'+mission.current_stage,mission,external_execution:false};const cycle=runGoalCycle(input.goal_cycle);return{status:cycle.status==='cycle_complete'?'completed':'blocked',blocked_stage:cycle.blocked_stage||null,mission,goal_cycle:cycle,external_execution:false}}
function yes(evidence){return{ok:true,evidence}}function no(reason){return{ok:false,reason}}
function result(i,current_stage,stage_results,status){return{run_id:i.run_id,mission_id:i.mission_id,mode:'simulation',current_stage,stage_results,status,external_execution:false}}
function sample(){return{run_id:'run1',mission_id:'m1',objective:'increase qualified WhatsApp demand',research_evidence:'research:1',strategy_ref:'strategy:1',creative_ref:'creative:1',production_ref:'content:1',qa_passed:true,risk_level:'L2',approval_valid:true,distribution_simulated:true,lead_conversion_ref:'lead:1',measurement_ref:'measure:1',learning_eligible:true,active_learning:true}}
function integratedSample(){return{mission:sample(),goal_cycle:goalSample()}}
function main(){const r=runIntegratedMission(integratedSample());assert.equal(r.status,'completed');assert.equal(r.external_execution,false);console.log('Marketing C09 integrated mission orchestration simulation: PASS')}if(require.main===module)main();module.exports={runMission,runIntegratedMission,sample,integratedSample};
