'use strict';
const {adaptEmailReauthGrantForBridge}=require('./public-web-canary-email-reauth-bridge-grant-adapter');
const {composeEmailReauthOperationalBridge}=require('./public-web-canary-email-reauth-operational-composer');
const {prepareEmailReauthOperationalCanarySession}=require('../pilots/public-web-canary-trial-dry-run');
const VERSION='public_web_canary_email_reauth_operational_preparation_v1';
function blocked(reason,extra={}){return Object.freeze({ok:false,status:'PUBLIC_WEB_CANARY_EMAIL_REAUTH_OPERATIONAL_PREPARATION_BLOCKED',reason,...extra,execution_authorized:false,external_network_called:false,production_allowed:false});}
function prepareEmailReauthOperationalExecution({durableComposition,plan,operationalContext,requested_at}={}){
 if(!durableComposition||durableComposition.ok!==true||durableComposition.status!=='PUBLIC_WEB_CANARY_EMAIL_REAUTH_DURABLE_GRANT_READY_NOT_EXECUTED')return blocked('durable_composition_required');
 if(!operationalContext||operationalContext.production_allowed===true)return blocked('operational_context_required');
 const grantResult=adaptEmailReauthGrantForBridge({authorization:durableComposition.authorization,runtimeBinding:durableComposition.runtimeBinding,environment:'staging',production_allowed:false,issued_at:requested_at});
 if(!grantResult.ok)return blocked('bridge_grant_blocked',{grantResult});
 const operationalComposition=composeEmailReauthOperationalBridge({grantResult,runtimeBinding:durableComposition.runtimeBinding,requested_at});
 if(!operationalComposition.ok)return blocked('operational_composition_blocked',{grantResult,operationalComposition});
 if(!plan||plan.canary_session_id!==operationalComposition.bridgeInput?.runner_request?.canary_session_id||plan.tenant_id!==durableComposition.runtimeBinding.tenant_id)return blocked('plan_binding_mismatch',{grantResult,operationalComposition});
 const lifecycle=prepareEmailReauthOperationalCanarySession(plan,operationalContext,operationalComposition);
 if(!lifecycle.ok)return blocked('lifecycle_materialization_blocked',{grantResult,operationalComposition,lifecycle});
 return Object.freeze({ok:true,status:'PUBLIC_WEB_CANARY_EMAIL_REAUTH_OPERATIONAL_PREPARED_ACTIVE_NOT_EXECUTED',version:VERSION,grantResult,operationalComposition,lifecycle,execution_authorized:false,execution_started:false,external_network_called:false,production_allowed:false});
}
module.exports={VERSION,prepareEmailReauthOperationalExecution};
