'use strict';
const STATES=Object.freeze(['challenge_created','send_requested','provider_sent','reply_verified']);
function transitionDeliveryState(current={},event={}){
 const fail=reason=>Object.freeze({ok:false,status:'EMAIL_REAUTH_DELIVERY_STATE_BLOCKED',reason,execution_authorized:false});
 if(!STATES.includes(current.state)||typeof current.challenge_id!=='string'||!current.challenge_id)return fail('valid_current_state_required');
 if(event.challenge_id!==current.challenge_id)return fail('challenge_binding_required');
 const next={challenge_created:'send_requested',send_requested:'provider_sent',provider_sent:'reply_verified'}[current.state];
 if(!next||event.type!==next)return fail('invalid_or_replayed_transition');
 if(next==='provider_sent'&&(!event.message_id||!event.thread_id||event.provider_confirmed!==true))return fail('real_provider_confirmation_required');
 if(next==='reply_verified'&&(!event.reply_id||event.reply_id===current.message_id||event.thread_id!==current.thread_id||event.proof_verified!==true))return fail('verified_reply_in_bound_thread_required');
 return Object.freeze({ok:true,status:'EMAIL_REAUTH_DELIVERY_STATE_ADVANCED',state:next,challenge_id:current.challenge_id,...(next==='provider_sent'?{message_id:event.message_id,thread_id:event.thread_id}:{}),...(next==='reply_verified'?{reply_id:event.reply_id,thread_id:current.thread_id,message_id:current.message_id}:{}),execution_authorized:false,production_allowed:false});
}
module.exports={STATES,transitionDeliveryState};
