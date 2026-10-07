'use strict';
const VERSION='strong_human_reauth_email_reply_proof_v1';
const EXACT_REPLY='APROVAR REAUTENTICACAO HERMES';
function blocked(reason){return Object.freeze({ok:false,status:'EMAIL_REAUTH_REPLY_PROOF_BLOCKED',reason,provider_authenticated:false,single_use:false,execution_authorized:false,production_allowed:false});}
function validateEmailReplyProof(handoff={},delivery={},reply={},profile={}){
 if(handoff.ok!==true||handoff.status!=='EMAIL_REAUTH_PROVIDER_HANDOFF_READY')return blocked('ready_handoff_required');
 if(profile.authenticated!==true||profile.identity_alias!==handoff.identity_alias)return blocked('authenticated_profile_alias_mismatch');
 if(!delivery.message_id||!delivery.thread_id||delivery.delivery_reference!==handoff.delivery_reference)return blocked('delivery_binding_required');
 if(!reply.id||reply.id===delivery.message_id||reply.thread_id!==delivery.thread_id)return blocked('distinct_reply_in_same_thread_required');
 if(reply.from!==profile.email)return blocked('reply_sender_must_match_authenticated_profile');
 if(typeof reply.body!=='string'||reply.body.trim()!==EXACT_REPLY)return blocked('exact_reply_phrase_required');
 if(!reply.email_ts||!delivery.email_ts||Date.parse(reply.email_ts)<=Date.parse(delivery.email_ts))return blocked('reply_must_follow_delivery');
 return Object.freeze({ok:true,status:'EMAIL_REAUTH_REPLY_PROOF_VERIFIED',provider:'google',provider_authenticated:true,identity_alias:handoff.identity_alias,provider_event_id:'gmail-message:'+reply.id,delivery_reference:handoff.delivery_reference,challenge_id:handoff.challenge_id,action_digest:handoff.action_digest,verified_at:new Date(Date.parse(reply.email_ts)).toISOString(),single_use:true,execution_authorized:false,production_allowed:false});
}
module.exports={VERSION,EXACT_REPLY,validateEmailReplyProof};
