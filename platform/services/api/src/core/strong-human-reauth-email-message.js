'use strict';
const {EXACT_REPLY}=require('./strong-human-reauth-email-reply-proof');
function prepareGmailReauthMessage(challenge={},handoff={}){
 const blocked=(reason)=>Object.freeze({ok:false,status:'EMAIL_REAUTH_MESSAGE_BLOCKED',reason,execution_authorized:false});
 if(challenge.ok!==true||challenge.status!=='STRONG_HUMAN_REAUTH_EMAIL_CHALLENGE_PREPARED')return blocked('prepared_challenge_required');
 if(handoff.ok!==true||handoff.status!=='EMAIL_REAUTH_PROVIDER_HANDOFF_READY'||handoff.provider!=='google'||handoff.challenge_id!==challenge.challenge_id||handoff.action_digest!==challenge.action_digest)return blocked('matching_google_handoff_required');
 if(!Number.isFinite(Date.parse(challenge.issued_at))||!Number.isInteger(challenge.ttl_seconds)||challenge.ttl_seconds>600||challenge.ttl_seconds<60)return blocked('valid_expiration_required');
 return Object.freeze({ok:true,status:'EMAIL_REAUTH_MESSAGE_READY',subject:'Hermes | Reautenticação humana de staging',body:`Solicitação de reautenticação humana para uma ação de leitura pública em staging.\n\nDesafio: ${challenge.challenge_id}\nAção vinculada: ${challenge.action_digest}\nEmitido em: ${challenge.issued_at}\nValidade: ${challenge.ttl_seconds} segundos.\n\nPara confirmar, responda a ESTE e-mail com a frase exata na primeira linha:\n${EXACT_REPLY}\n\nNão compartilhe credenciais ou códigos. A resposta não autoriza execução automática.`,delivery_reference:handoff.delivery_reference,execution_authorized:false,production_allowed:false});
}
module.exports={prepareGmailReauthMessage};
