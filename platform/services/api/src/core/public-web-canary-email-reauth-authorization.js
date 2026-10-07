'use strict';
const {computeCanonicalContentDigest}=require('./canonical-content-digest');
const VERSION='public_web_canary_email_reauth_authorization_v1';
function blocked(reason){return Object.freeze({ok:false,status:'PUBLIC_WEB_CANARY_EMAIL_REAUTH_AUTHORIZATION_BLOCKED',reason,authorization_granted:false,execution_reservation_created:false,execution_authorized:false,execution_started:false,external_network_called:false,production_allowed:false});}
function authorizePublicWebCanaryWithEmailReauth(input={}){
 const r=input.reauth||{};
 if(r.ok!==true||r.status!=='STRONG_HUMAN_REAUTH_EMAIL_VERIFIED_SINGLE_USE_NOT_CONSUMED'||r.verified!==true||r.consumed!==false)return blocked('verified_unconsumed_email_reauth_required');
 if(!input.operator_id||input.operator_id!==r.subject_id)return blocked('operator_subject_binding_required');
 if(input.environment!=='staging'||input.authorization_scope!=='PUBLIC_WEB_CANARY_SINGLE_EXECUTION_NON_PRODUCTION')return blocked('staging_single_execution_scope_required');
 if(input.target_origin!=='https://example.com'||input.target_path!=='/'||input.method!=='GET'||input.port!==443||input.maximum_requests!==1||input.redirects_allowed!==false)return blocked('exact_canary_target_required');
 if(input.production_allowed!==false)return blocked('production_must_remain_blocked');
 if(!input.replay_key||!input.request_reference||!input.grant_nonce||!input.reservation_nonce||input.grant_nonce===input.reservation_nonce)return blocked('single_use_identity_required');
 const material={version:VERSION,reauth_challenge_id:r.challenge_id,provider_event_id:r.provider_event_id,subject_id:r.subject_id,action_digest:r.action_digest,environment:'staging',target_origin:'https://example.com',target_path:'/',method:'GET',port:443,maximum_requests:1,replay_key:input.replay_key,request_reference:input.request_reference,grant_nonce:input.grant_nonce,reservation_nonce:input.reservation_nonce};
 const authorization_grant_id='public_web_canary_email_reauth_grant:'+computeCanonicalContentDigest(['grant',material]);
 const execution_reservation_id='public_web_canary_email_reauth_reservation:'+computeCanonicalContentDigest(['reservation',authorization_grant_id,material]);
 return Object.freeze({ok:true,status:'PUBLIC_WEB_CANARY_EMAIL_REAUTH_SINGLE_USE_GRANT_READY',version:VERSION,approval_mode:'STRONG_HUMAN_REAUTH_EMAIL',grant_mode:'EMAIL_REAUTH_SINGLE_USE',operator_id:r.subject_id,reauth_challenge_id:r.challenge_id,provider_event_id:r.provider_event_id,action_digest:r.action_digest,authorization_grant_id,execution_reservation_id,replay_key:input.replay_key,request_reference:input.request_reference,grant_nonce:input.grant_nonce,reservation_nonce:input.reservation_nonce,authorization_granted:true,execution_reservation_created:true,single_use:true,remaining_execution_count:1,reauth_consumption_required:true,execution_authorized:false,execution_started:false,external_network_called:false,production_allowed:false});
}
module.exports={VERSION,authorizePublicWebCanaryWithEmailReauth};
