'use strict';
const {composeProviderEvidence}=require('./public-web-canary-email-reauth-provider-evidence-composer');
const {buildDurableEvidenceReceipt}=require('./strong-human-reauth-email-durable-evidence-receipt');
const VERSION='public_web_canary_email_reauth_provider_evidence_persistence_v1';
function fail(reason,extra={}){return Object.freeze({ok:false,status:'PUBLIC_WEB_CANARY_EMAIL_REAUTH_PROVIDER_EVIDENCE_PERSISTENCE_BLOCKED',reason,...extra,execution_authorized:false,external_network_called:false,production_allowed:false});}
async function persistProviderEvidence(input={},deps={}){
 if(!deps.evidenceStore||typeof deps.evidenceStore.createIfAbsent!=='function')return fail('evidence_store_required');
 const composed=composeProviderEvidence(input);if(!composed.ok)return fail('provider_evidence_invalid');
 const persisted=await deps.evidenceStore.createIfAbsent(composed.envelope);
 const receipt=buildDurableEvidenceReceipt(composed.envelope,persisted);
 if(!receipt.ok)return fail('durable_evidence_not_new',{receipt});
 return Object.freeze({ok:true,status:'PUBLIC_WEB_CANARY_EMAIL_REAUTH_PROVIDER_EVIDENCE_DURABLE',version:VERSION,receipt,execution_authorized:false,external_network_called:false,production_allowed:false});
}
module.exports={VERSION,persistProviderEvidence};
