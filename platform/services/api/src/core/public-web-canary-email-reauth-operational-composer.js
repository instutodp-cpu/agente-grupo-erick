'use strict';
const {computeCanonicalContentDigest}=require('./canonical-content-digest');
const VERSION='public_web_canary_email_reauth_operational_composer_v1';
function fail(reason){return Object.freeze({ok:false,status:'PUBLIC_WEB_CANARY_EMAIL_REAUTH_OPERATIONAL_COMPOSITION_BLOCKED',reason,execution_authorized:false,external_network_called:false,production_allowed:false});}
function composeEmailReauthOperationalBridge(input={}){
 const g=input.grantResult||{},b=input.runtimeBinding||{};
 if(g.ok!==true||g.status!=='PUBLIC_WEB_CANARY_EMAIL_REAUTH_BRIDGE_GRANT_READY_NOT_EXECUTED')return fail('bridge_grant_required');
 if(b.ok!==true||b.status!=='PUBLIC_WEB_CANARY_EMAIL_REAUTH_RUNTIME_BOUND')return fail('runtime_binding_required');
 const r=g.execution_reservation||{},a=g.authorization_grant||{};
 if(r.tenant_id!==b.tenant_id||r.trial_id!==b.trial_id||r.plan_hash!==b.plan_hash)return fail('grant_runtime_binding_mismatch');
 if(a.environment!=='staging'||b.environment!=='staging'||b.production_allowed!==false)return fail('staging_zero_production_required');
 const requested_at=input.requested_at;
 const requestedAtMs=Date.parse(requested_at);
 if(!Number.isFinite(requestedAtMs)||new Date(requestedAtMs).toISOString()!==requested_at)return fail('canonical_requested_at_required');
 const ids={execution_id:'public_web_email_canary_execution:'+computeCanonicalContentDigest(['execution',g.authorization_grant_id,g.execution_reservation_id,b.plan_hash,requested_at]),canary_session_id:'public_web_email_canary_session:'+computeCanonicalContentDigest(['session',b.tenant_id,b.trial_id,b.plan_hash]),trace_id:'public_web_email_canary_trace:'+computeCanonicalContentDigest(['trace',g.authorization_grant_id,requested_at]),request_id:'public_web_email_canary_request:'+computeCanonicalContentDigest(['request',g.execution_reservation_id,requested_at]),change_id:'public_web_email_canary_change:'+computeCanonicalContentDigest(['change',b.plan_hash,requested_at])};
 const bridgeInput=Object.freeze({authorization_grant_id:g.authorization_grant_id,execution_reservation_id:g.execution_reservation_id,grant_reservation_fingerprint:g.grant_reservation_fingerprint,replay_key:r.replay_key,reservation_nonce:r.reservation_nonce,environment:'staging',tenant_id:b.tenant_id,trial_id:b.trial_id,plan_hash:b.plan_hash,requested_at,execution_id:ids.execution_id,execution_count:1,single_process_manual_canary:true,write_allowed:false,action_allowed:false,send_allowed:false,publish_allowed:false,delete_allowed:false,runner_request:Object.freeze({canary_session_id:ids.canary_session_id,canary_execution_id:ids.execution_id,trace_id:ids.trace_id,request_id:ids.request_id,change_id:ids.change_id,target_path:'/'})});
 return Object.freeze({ok:true,status:'PUBLIC_WEB_CANARY_EMAIL_REAUTH_OPERATIONAL_BRIDGE_READY_NOT_CONFIRMED',version:VERSION,chain:Object.freeze({grantResult:g}),bridgeInput,execution_authorized:false,external_network_called:false,production_allowed:false});
}
module.exports={VERSION,composeEmailReauthOperationalBridge};
