'use strict';

const { computeCanonicalContentDigest } = require('./canonical-content-digest');

const VERSION = 'strong_human_reauth_email_v1';
const MAX_TTL_SECONDS = 600;

function blocked(reason) {
  return Object.freeze({ok:false,status:'STRONG_HUMAN_REAUTH_EMAIL_BLOCKED',reason,verified:false,consumed:false,execution_authorized:false,credential_material_present:false,production_allowed:false});
}

function prepareStrongHumanReauthEmail(input = {}, options = {}) {
  if (!input.subject_id || !input.action_digest || !input.email_identity_reference) return blocked('bound_identity_and_action_required');
  if (input.email_address != null || input.password != null || input.token != null || input.otp != null) return blocked('raw_identity_or_secret_material_forbidden');
  const ttl = Number(input.ttl_seconds);
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > MAX_TTL_SECONDS) return blocked('ttl_out_of_bounds');
  if (input.production_allowed !== false) return blocked('production_must_remain_blocked');
  const clock = typeof options.clock === 'function' ? options.clock : () => new Date().toISOString();
  const issuedAt = String(clock());
  const challengeId = computeCanonicalContentDigest([VERSION,input.subject_id,input.action_digest,input.email_identity_reference,issuedAt]);
  return Object.freeze({ok:true,status:'STRONG_HUMAN_REAUTH_EMAIL_CHALLENGE_PREPARED',version:VERSION,challenge_id:challengeId,subject_id:input.subject_id,action_digest:input.action_digest,email_identity_reference:input.email_identity_reference,issued_at:issuedAt,ttl_seconds:ttl,delivery_required:true,delivery_performed:false,verified:false,consumed:false,execution_authorized:false,credential_material_present:false,production_allowed:false});
}

function verifyStrongHumanReauthEmail(challenge = {}, evidence = {}, options = {}) {
  if (challenge.status !== 'STRONG_HUMAN_REAUTH_EMAIL_CHALLENGE_PREPARED' || challenge.ok !== true) return blocked('prepared_challenge_required');
  if (evidence.provider_authenticated !== true || evidence.channel !== 'email') return blocked('authenticated_email_provider_evidence_required');
  if (!evidence.provider_event_id || !evidence.authenticated_subject_id || !evidence.email_identity_reference) return blocked('provider_evidence_identity_required');
  if (evidence.authenticated_subject_id !== challenge.subject_id || evidence.email_identity_reference !== challenge.email_identity_reference) return blocked('authenticated_identity_mismatch');
  if (evidence.challenge_id !== challenge.challenge_id || evidence.action_digest !== challenge.action_digest) return blocked('challenge_binding_mismatch');
  if (evidence.single_use !== true || evidence.consumed === true) return blocked('fresh_single_use_evidence_required');
  const clock = typeof options.clock === 'function' ? options.clock : () => new Date().toISOString();
  const now = Date.parse(String(clock())); const issued = Date.parse(challenge.issued_at); const verified = Date.parse(String(evidence.verified_at || ''));
  if (![now,issued,verified].every(Number.isFinite) || verified < issued || verified > now || now - issued > challenge.ttl_seconds * 1000) return blocked('reauth_evidence_expired_or_invalid');
  return Object.freeze({ok:true,status:'STRONG_HUMAN_REAUTH_EMAIL_VERIFIED_SINGLE_USE_NOT_CONSUMED',version:VERSION,challenge_id:challenge.challenge_id,subject_id:challenge.subject_id,action_digest:challenge.action_digest,email_identity_reference:challenge.email_identity_reference,provider_event_id:evidence.provider_event_id,verified_at:new Date(verified).toISOString(),verified:true,consumed:false,execution_authorized:false,credential_material_present:false,production_allowed:false});
}

module.exports={VERSION,MAX_TTL_SECONDS,prepareStrongHumanReauthEmail,verifyStrongHumanReauthEmail};
