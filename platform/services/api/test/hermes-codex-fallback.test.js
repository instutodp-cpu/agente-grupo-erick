'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fallback=require('../src/runtime/hermes-codex-fallback');
const curator=require('../src/runtime/hermes-automemory-curator');
const bridge=require('../src/runtime/hermes-codex-login-bridge');
const core=require('../src/runtime/hermes-telegram-private-channel');
const now=Date.parse('2026-10-23T16:00:00Z');
const at=new Date(now-2000).toISOString();
const entry={schema:1,tenant_id:'grupo_erick',scope:'enterprise',pending:null,
 entries:[{id:'abcdef123456',area:'financeiro',source:'owner_confirmed_telegram',
 decision:'Conferir totais antes de assumir novos compromissos',
 rationale:'Dados empresariais históricos ainda não estão conciliados',
 proposed_at:at,confirmed_at:at}]};
const data=curator.curate({ownerDecisions:entry,now,
 policy:{enabled:true,tenant_id:'grupo_erick',decisions:true,aggregates:false}});
const question='Analise riscos financeiros e compromissos do Grupo Erick';
test('Codex failure categories classify sanitized provider diagnostics only',()=>{
 assert.equal(bridge.classifyFailure('model_exit','ERROR: usage limit reached'), 'quota_exhausted');
 assert.equal(bridge.classifyFailure('model_exit','ERROR: rate limit 429'),'rate_limited');
 assert.equal(bridge.classifyFailure('model_exit','ERROR: unauthorized'), 'auth_expired');
 assert.equal(bridge.classifyFailure('model_exit','unexpected private text'), 'provider_unavailable');
 assert.equal(bridge.classifyFailure('codex_bridge_timeout',''), 'timeout');
 assert.equal(bridge.errorCode(Error('secret-account-private')), 'provider_unavailable');
});
test('fallback is bounded, read-only and never claims a complete analysis',()=>{
 const answer=fallback.compose({store:data,question,code:'codex_login_provider_unavailable',now});
 assert.match(answer,/leitura histórica disponível/);
 assert.match(answer,/Conferir totais/);
 assert.match(answer,/NÃO consultei dados atuais/);
 assert.doesNotMatch(answer,/acabei de consultar|dados atuais confirmados/);
 assert.throws(()=>fallback.compose({store:data,question,code:'agent_auto_memory_context_unsafe',now}),/reason_denied/);
 assert.throws(()=>fallback.compose({store:{...data,tenant_id:'client::other'},question,code:'codex_login_provider_unavailable',now}),/store_invalid/);
 assert.throws(()=>fallback.compose({store:data,question,code:'codex_login_provider_unavailable',now:now+181*86400000}),/no_relevant/);
});
const msg=id=>({update_id:800,message:{message_id:5,chat:{id,type:'private'},from:{id,is_bot:false},text:question}});
test('owner receives deterministic fallback, unauthorized user never reads corporate memory',async()=>{
 const sent=[];let reads=0;
 const options={ownerId:777,update:msg(777),agentEnabled:true,
  query:async()=>{throw Error('unknown_tool')},send:async(_,s)=>sent.push(s),
  readAgent:async()=>{throw Error('codex_login_provider_unavailable')},
  readGovernedFallback:async(q,code)=>{reads++;return fallback.compose({store:data,question:q,code,now})}};
 const owner=await core.processUpdate(options);
 assert.equal(owner.kind,'answered');
 assert.equal(owner.intent,'governed_agent');
 assert.equal(owner.failure_code,'codex_login_provider_unavailable');
 assert.equal(reads,1);assert.match(sent[0],/Conferir totais/);
 const stranger=await core.processUpdate({...options,update:msg(999)});
 assert.equal(stranger.kind,'unauthorized');assert.equal(reads,1);
});
test('permission and validation failures cannot trigger fallback',async()=>{
 const sent=[];let reads=0;
 const res=await core.processUpdate({ownerId:777,update:msg(777),agentEnabled:true,
  query:async()=>{throw Error('unused')},send:async(_,x)=>sent.push(x),
  readAgent:async()=>{throw Error('agent_auto_memory_context_unsafe')},
  readGovernedFallback:async()=>{reads++;return 'unsafe'}});
 assert.equal(res.failure_code,'validation_denied');
 assert.equal(reads,0);
 assert.match(sent[0],/não pôde ser concluída/);
});
