'use strict';
const {computeCanonicalContentDigest}=require('./canonical-content-digest');
const VERSION='strong_human_reauth_email_provider_handoff_v1';
function blocked(reason){return Object.freeze({ok:false,status:'EMAIL_REAUTH_PROVIDER_HANDOFF_BLOCKED',reason,delivery_authorized:false,execution_authorized:false,credential_material_present:false,production_allowed:false});}
function prepareEmailProviderHandoff(challenge={},identity={}){
 if(challenge.ok!==true||challenge.status!=='STRONG_HUMAN_REAUTH_EMAIL_CHALLENGE_PREPARED')return blocked('prepared_challenge_required');
 if(!identity.provider||identity.provider!=='google'||!identity.identity_alias||!identity.email_identity_reference)return blocked('authenticated_google_identity_alias_required');
 if(identity.email_identity_reference!==challenge.email_identity_reference)return blocked('email_identity_reference_mismatch');
 if(identity.email_address!=null||identity.provider_subject_id!=null||identity.access_token!=null||identity.refresh_token!=null)return blocked('raw_email_oauth_identity_or_secret_forbidden');
 const delivery_reference='email-reauth-delivery:'+computeCanonicalContentDigest([VERSION,challenge.challenge_id,identity.provider,identity.identity_alias]);
 return Object.freeze({ok:true,status:'EMAIL_REAUTH_PROVIDER_HANDOFF_READY',version:VERSION,challenge_id:challenge.challenge_id,subject_id:challenge.subject_id,action_digest:challenge.action_digest,email_identity_reference:challenge.email_identity_reference,provider:'google',identity_alias:identity.identity_alias,delivery_reference,delivery_authorized:true,execution_authorized:false,credential_material_present:false,production_allowed:false});
}
function acceptEmailProviderEvidence(handoff={},event={}){
 if(handoff.ok!==true||handoff.status!=='EMAIL_REAUTH_PROVIDER_HANDOFF_READY')return blocked('ready_handoff_required');
 if(event.provider!=='google'||event.provider_authenticated!==true||event.identity_alias!==handoff.identity_alias)return blocked('authenticated_provider_subject_mismatch');
 if(event.delivery_reference!==handoff.delivery_reference||event.challenge_id!==handoff.challenge_id||event.action_digest!==handoff.action_digest)return blocked('provider_event_binding_mismatch');
 if(!event.provider_event_id||!event.verified_at||event.single_use!==true)return blocked('single_use_provider_event_required');
 return Object.freeze({ok:true,status:'EMAIL_REAUTH_PROVIDER_EVIDENCE_ACCEPTED',provider_authenticated:true,channel:'email',provider_event_id:event.provider_event_id,authenticated_subject_id:handoff.subject_id,email_identity_reference:handoff.email_identity_reference,challenge_id:handoff.challenge_id,action_digest:handoff.action_digest,single_use:true,consumed:false,verified_at:event.verified_at,execution_authorized:false,production_allowed:false});
}
module.exports={VERSION,prepareEmailProviderHandoff,acceptEmailProviderEvidence};
