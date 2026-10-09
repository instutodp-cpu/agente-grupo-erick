'use strict';
function createAtomicEmailEvidencePostgres({pool}={}){
 if(!pool||typeof pool.connect!=='function')throw new TypeError('email_evidence_pool_invalid');
 return Object.freeze({persistAndConsume:async e=>{
  if(e?.ok!==true||e.status!=='EMAIL_REAUTH_EVIDENCE_ENVELOPE_READY'||e.single_use!==true||e.contains_provider_identifier!==false)return {ok:false,reason:'verified_opaque_envelope_required'};
  const c=await pool.connect();let began=false;
  try{
   await c.query('BEGIN');began=true;
   const consumed=await c.query(`UPDATE hermes.strong_human_reauth_email_challenges SET state='CONSUMED',provider_event_id=$2,verified_at=$3,consumed_at=CURRENT_TIMESTAMP WHERE challenge_id=$1 AND subject_id=$4 AND action_digest=$5 AND email_identity_reference=$6 AND state='PENDING' AND expires_at>CURRENT_TIMESTAMP AND $3::timestamptz<=CURRENT_TIMESTAMP RETURNING challenge_id`,[e.challenge_id,e.provider_event_reference,e.verified_at,e.subject_id,e.action_digest,e.email_identity_reference]);
   if(consumed.rowCount!==1)throw new Error('challenge_expired_replayed_or_binding_mismatch');
   const inserted=await c.query(`INSERT INTO hermes.strong_human_reauth_email_evidence(evidence_key,challenge_id,subject_id,action_digest,email_identity_reference,provider_event_reference,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING evidence_key`,[e.envelope_digest,e.challenge_id,e.subject_id,e.action_digest,e.email_identity_reference,e.provider_event_reference,e.verified_at]);
   if(inserted.rowCount!==1)throw new Error('evidence_duplicate_or_not_durable');
   await c.query('COMMIT');began=false;
   return Object.freeze({ok:true,status:'EMAIL_REAUTH_ATOMIC_DURABLE_CONSUMED',challenge_id:e.challenge_id,evidence_key:e.envelope_digest,verified_at:e.verified_at,consumed:true,durable:true,execution_authorized:false,production_allowed:false});
  }catch(err){if(began)try{await c.query('ROLLBACK');}catch{}return Object.freeze({ok:false,status:'EMAIL_REAUTH_ATOMIC_BLOCKED',reason:err.message,consumed:false,durable:false,execution_authorized:false,production_allowed:false});}finally{c.release();}
 }});
}
module.exports={createAtomicEmailEvidencePostgres};
