function isoDate(d){return d.toISOString().slice(0,10);}
function calculateDeadline({triggerDate,policy,calendar}){
 if(!triggerDate||!policy)return {status:'detected',due_date:null,reason:'missing_calculation_input'};
 if(policy.calendar_required&&!calendar)return {status:'detected',due_date:null,reason:'missing_versioned_calendar'};
 if(['procedural','regulatory'].includes(policy.deadline_type)&&!(policy.authority_refs||[]).length)return {status:'detected',due_date:null,reason:'missing_authority_basis'};
 const start=new Date(triggerDate+'T00:00:00Z');if(Number.isNaN(start.getTime()))return {status:'detected',due_date:null,reason:'invalid_trigger_date'};
 let d=new Date(start);if(policy.start_rule==='next_day')d.setUTCDate(d.getUTCDate()+1);
 let counted=0;
 while(counted<policy.days){
   const date=isoDate(d);
   const weekend=[0,6].includes(d.getUTCDay());
   const holiday=!!calendar?.holidays?.includes(date);
   if(policy.count_mode==='calendar_days'||(!weekend&&!holiday))counted++;
   if(counted<policy.days)d.setUTCDate(d.getUTCDate()+1);
 }
 return {status:'calculated',due_date:isoDate(d),reason:'deterministic_calculation',policy_ref:policy.policy_id,calendar_ref:calendar?.calendar_id||null};
}
function validateDeadline(deadline,{policyVerified=false,calendarVerified=false,basisVerified=false}={}){
 if(!deadline?.due_date)return {status:'detected',confirmable:false,reason:'deadline_not_calculated'};
 if(!policyVerified)return {status:'calculated',confirmable:false,reason:'policy_not_verified'};
 if(!calendarVerified)return {status:'calculated',confirmable:false,reason:'calendar_not_verified'};
 if(!basisVerified)return {status:'calculated',confirmable:false,reason:'basis_not_verified'};
 return {status:'validated',confirmable:true,reason:'deadline_inputs_verified'};
}
function confirmDeadline(deadline,validation,humanReview){
 if(!validation?.confirmable)return {status:validation?.status||'detected',confirmed:false,reason:'validation_incomplete'};
 if(!humanReview?.approved)return {status:'validated',confirmed:false,reason:'human_review_required'};
 return {status:'confirmed',confirmed:true,reason:'reviewed_deadline'};
}
function assessObligationForMonitoring(obligation){if(obligation?.review_status!=='verified')return {monitorable:false,reason:'obligation_not_verified'};if(!obligation.fragment_refs?.length)return {monitorable:false,reason:'missing_obligation_provenance'};return {monitorable:true,reason:'verified_traceable_obligation'};}
module.exports={calculateDeadline,validateDeadline,confirmDeadline,assessObligationForMonitoring};
