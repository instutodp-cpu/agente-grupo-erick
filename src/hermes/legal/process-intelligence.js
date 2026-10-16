const {sha256}=require('./provenance');
function normalizeProcessEvent({processId,sourceId,sourceSnapshotRef,externalEventRef,eventType,occurredAt,description=null,contentScope='metadata_only'}){
 if(!processId||!sourceId||!sourceSnapshotRef||!eventType||!occurredAt)throw new Error('incomplete_process_event');
 const stable=externalEventRef||sha256([processId,eventType,occurredAt,description||''].join('|'));
 return Object.freeze({event_id:'process-event:'+stable,process_id:processId,event_type:eventType,occurred_at:occurredAt,source_id:sourceId,source_snapshot_ref:sourceSnapshotRef,content_scope:contentScope,verification_status:'observed',external_event_ref:externalEventRef||null,description});
}
function buildTimeline(events){
 const seen=new Map();for(const e of events||[])if(!seen.has(e.event_id))seen.set(e.event_id,e);
 return [...seen.values()].sort((a,b)=>new Date(a.occurred_at)-new Date(b.occurred_at));
}
function assessProcessEvent(event){
 if(!event)return {can_certify_decision:false,can_confirm_deadline:false,reason:'missing_event'};
 if(event.content_scope==='metadata_only')return {can_certify_decision:false,can_confirm_deadline:false,reason:'metadata_requires_substantive_verification'};
 if(event.content_scope==='verified_decision'&&event.verification_status==='verified')return {can_certify_decision:true,can_confirm_deadline:false,reason:'verified_decision_content'};
 return {can_certify_decision:false,can_confirm_deadline:false,reason:'event_not_verified_for_effect'};
}
function detectDeadlineCandidate(event){
 return {candidate_id:'deadline-candidate:'+event.event_id,process_event_ref:event.event_id,status:'candidate',confirmed:false,reason:'process_event_requires_deadline_validation'};
}
module.exports={normalizeProcessEvent,buildTimeline,assessProcessEvent,detectDeadlineCandidate};
