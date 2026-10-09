'use strict';
const {computeCanonicalContentDigest}=require('./canonical-content-digest');
const VERSION='strong_human_reauth_email_evidence_envelope_v1';
function blocked(reason){return Object.freeze({ok:false,status:'EMAIL_REAUTH_EVIDENCE_ENVELOPE_BLOCKED',reason,contains_provider_identifier:false,execution_authorized:false,production_allowed:false});}
function buildEmailReauthEvidenceEnvelope(proof={}){
 if(proof.ok!==true||proof.status!=='EMAIL_REAUTH_REPLY_PROOF_VERIFIED'||proof.provider_authenticated!==true)return blocked('verified_reply_proof_required');
 if(!proof.challenge_id||!proof.action_digest||!proof.verified_at||proof.single_use!==true)return blocked('proof_binding_incomplete');
 if(!proof.provider_event_id)return blocked('provider_event_required');
 const provider_event_reference=computeCanonicalContentDigest({version:VERSION,provider:'google',provider_event_id:proof.provider_event_id,challenge_id:proof.challenge_id});
 const envelope_digest=computeCanonicalContentDigest({version:VERSION,challenge_id:proof.challenge_id,action_digest:proof.action_digest,verified_at:proof.verified_at,provider_event_reference});
 return Object.freeze({ok:true,status:'EMAIL_REAUTH_EVIDENCE_ENVELOPE_READY',version:VERSION,challenge_id:proof.challenge_id,action_digest:proof.action_digest,email_identity_reference:'owner-primary-email',subject_id:'human:owner',provider_event_reference,verified_at:proof.verified_at,envelope_digest,single_use:true,contains_provider_identifier:false,execution_authorized:false,production_allowed:false});
}
module.exports={VERSION,buildEmailReauthEvidenceEnvelope};
