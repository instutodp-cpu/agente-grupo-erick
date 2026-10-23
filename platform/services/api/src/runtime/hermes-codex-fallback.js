'use strict';
// Answer ONLY from previously-curated, tenant-scoped, unexpired corporate memory.
// Fail closed on ambiguous sources. No model call, fresh data claim or user commands.
const memory=require('./hermes-automemory-curator');
const ALLOWED=new Set(['codex_login_quota_exhausted','codex_login_rate_limited',
 'codex_login_auth_expired','codex_login_timeout','codex_login_invalid_response',
 'codex_login_bridge_unreachable','codex_login_bridge_busy',
 'codex_login_provider_unavailable','agent_daily_quota']);
function permitted(code){return ALLOWED.has(code);}
function compose({store,question,code,now=Date.now()}={}){
 if(!permitted(code))throw Error('fallback_reason_denied');
 const entries=JSON.parse(memory.context(store,question,now));
 if(!entries.length)throw Error('fallback_no_relevant_verified_memory');
 const items=[];
 for(const e of entries){
  if(e.tenant_id!=='grupo_erick'||e.visibility!=='owner_only'||
    Date.parse(e.expires_at)<=now)throw Error('fallback_scope_denied');
  const type=e.kind==='confirmed_decision'?'Decisão confirmada':'Histórico agregado';
  // Whole, bounded, verified source records. Never cut metric lines in half.
  items.push('• '+type+' ['+e.domain+'] '+e.at.slice(0,10)+': '+e.summary);
 }
 const response='🧠 Hermes — leitura histórica disponível (staging)\n\n'+
  'A análise com IA não foi concluída. Seguem apenas registros empresariais já autorizados; NÃO consultei dados atuais:\n'+
  items.join('\n')+'\n\n⚠️ Memórias não provam conciliação nem autorizam compromissos. Confirme no ERP antes de decidir. Nenhuma ação foi executada.';
 if(response.length>1800)throw Error('fallback_response_oversize');
 return response;
}
module.exports={ALLOWED,permitted,compose};
