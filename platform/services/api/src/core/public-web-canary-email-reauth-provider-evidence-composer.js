'use strict';
const {validateEmailReplyProof}=require('./strong-human-reauth-email-reply-proof');
const {buildEmailReauthEvidenceEnvelope}=require('./strong-human-reauth-email-evidence-envelope');
const VERSION='public_web_canary_email_reauth_provider_evidence_composer_v1';
function fail(reason){return Object.freeze({ok:false,status:'PUBLIC_WEB_CANARY_EMAIL_REAUTH_PROVIDER_EVIDENCE_BLOCKED',reason,execution_authorized:false,external_network_called:false,production_allowed:false});}
function composeProviderEvidence({handoff,delivery,reply,profile}={}){
 const proof=validateEmailReplyProof(handoff,delivery,reply,profile);
 if(!proof.ok)return fail('reply_proof_invalid');
 const envelope=buildEmailReauthEvidenceEnvelope(proof);
 if(!envelope.ok)return fail('evidence_envelope_invalid');
 return Object.freeze({ok:true,status:'PUBLIC_WEB_CANARY_EMAIL_REAUTH_PROVIDER_EVIDENCE_READY',version:VERSION,proof,envelope,execution_authorized:false,external_network_called:false,production_allowed:false});
}
module.exports={VERSION,composeProviderEvidence};
