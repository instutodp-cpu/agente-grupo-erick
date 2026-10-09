'use strict';
const VERSION='strong_human_reauth_email_delivery_receipt_v1';
function blocked(reason){return Object.freeze({ok:false,status:'EMAIL_REAUTH_DELIVERY_RECEIPT_BLOCKED',reason,execution_authorized:false,production_allowed:false});}
function bindGmailDelivery(handoff={},sent={},profile={},sentAt){
 if(handoff.ok!==true||handoff.status!=='EMAIL_REAUTH_PROVIDER_HANDOFF_READY'||handoff.provider!=='google')return blocked('ready_google_handoff_required');
 if(profile.authenticated!==true||profile.identity_alias!==handoff.identity_alias||typeof profile.email!=='string'||!profile.email.includes('@'))return blocked('authenticated_gmail_profile_required');
 if(typeof sent.id!=='string'||!sent.id.trim()||typeof sent.threadId!=='string'||!sent.threadId.trim())return blocked('gmail_message_and_thread_required');
 if(!Array.isArray(sent.labelIds)||!sent.labelIds.includes('SENT'))return blocked('gmail_sent_confirmation_required');
 if(typeof sentAt!=='string'||!Number.isFinite(Date.parse(sentAt)))return blocked('delivery_timestamp_required');
 return Object.freeze({ok:true,status:'EMAIL_REAUTH_GMAIL_DELIVERY_BOUND',version:VERSION,message_id:sent.id,thread_id:sent.threadId,delivery_reference:handoff.delivery_reference,email_ts:new Date(Date.parse(sentAt)).toISOString(),execution_authorized:false,production_allowed:false});
}
module.exports={VERSION,bindGmailDelivery};
