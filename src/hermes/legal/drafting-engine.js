const {sha256}=require('./provenance');
const MATERIAL=new Set(['LEGAL_AUTHORITY','PRECEDENT','RECOMMENDATION']);
function assessDraftInputs({bundle,sections=[]}){
 if(!bundle)return {allowed:false,reason:'missing_evidence_bundle'};
 if(bundle.status!=='verified')return {allowed:false,reason:'evidence_bundle_not_verified'};
 for(const s of sections){
   if(MATERIAL.has(s.label)&&!(s.claim_refs||[]).length)return {allowed:false,reason:'material_section_without_claim_provenance',section_id:s.section_id};
 }
 return {allowed:true,reason:'draft_inputs_traceable'};
}
function createLegalDraft(input){
 const gate=assessDraftInputs(input);if(!gate.allowed)return {status:'blocked_evidence',external_execution:false,reason:gate.reason};
 const body={matter_scope:input.matterScope,draft_type:input.draftType,template_ref:input.templateRef,template_version:input.templateVersion,evidence_bundle_ref:input.bundle.bundle_id,sections:input.sections};
 const hash=sha256(JSON.stringify(body));
 return Object.freeze({draft_id:'legal-draft:'+hash,...body,status:'ready_for_review',external_execution:false,review_run_ref:null,artifact_hash:hash});
}
function assertDraftBoundary(draft){
 if(!draft)return {allowed:false,reason:'missing_draft'};
 if(draft.external_execution!==false)return {allowed:false,reason:'draft_must_not_execute'};
 if(['signed','sent','filed','approved'].includes(draft.status))return {allowed:false,reason:'invalid_draft_lifecycle_state'};
 return {allowed:true,reason:'draft_only_boundary_preserved'};
}
function linkReview(draft,reviewRunId){
 if(!reviewRunId)return {allowed:false,reason:'missing_review_run'};
 if(reviewRunId===draft.draft_run_ref)return {allowed:false,reason:'review_must_be_independent'};
 return {...draft,review_run_ref:reviewRunId};
}
module.exports={assessDraftInputs,createLegalDraft,assertDraftBoundary,linkReview};
