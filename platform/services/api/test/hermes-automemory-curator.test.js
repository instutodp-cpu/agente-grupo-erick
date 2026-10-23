'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const a=require('../src/runtime/hermes-automemory-curator');
const now=Date.parse('2026-10-23T12:00:00Z');
const policy={enabled:true,tenant_id:'grupo_erick',decisions:true,aggregates:false};
const entry=()=>{const at=new Date(now-3600000).toISOString();return {
 schema:1,tenant_id:'grupo_erick',scope:'enterprise',pending:null,entries:[{
 id:'aabbccddeeff',area:'operacoes',decision:'Priorizar atendimento consultivo nas lojas',
 rationale:'Ajuste de atendimento confirmado pelo proprietário',source:'owner_confirmed_telegram',
 proposed_at:at,confirmed_at:at}]};};
test('automatically consolidates already-confirmed authorized source and idempotently persists its shape',()=>{
 const first=a.curate({ownerDecisions:entry(),now,policy});
 assert.equal(first.items.length,1);assert.equal(first.items[0].retention,'durable');
 assert.equal(first.items[0].visibility,'owner_only');
 assert.deepEqual(a.curate({ownerDecisions:entry(),now,policy,previous:first}),first);
 assert.match(a.render(first,now),/Priorizar atendimento consultivo/);
});
test('fails closed on unauthorized tenants and disabled sources',()=>{
 for(const x of [{...policy,tenant_id:'client::other'},{...policy,enabled:false},{...policy,decisions:'true'}])
 assert.throws(()=>a.curate({ownerDecisions:entry(),now,policy:x}),/policy_denied/);
});
test('retention and isolated store enforced',()=>{
 const result=a.curate({ownerDecisions:entry(),now,policy});
 assert.doesNotMatch(a.render(result,now+181*86400000),/Priorizar atendimento/);
 assert.throws(()=>a.check({...result,tenant_id:'personal::other'},now),/store_invalid/);
 assert.throws(()=>a.check({...result,items:[{...result.items[0],visibility:'tenant_shared'}]},now),/item_invalid/);
});
test('sensitive content is discarded and never kept in memory',()=>{
 const data=entry();data.entries[0].decision='A senha do sistema financeiro foi alterada';
 assert.equal(a.curate({ownerDecisions:data,now,policy}).items.length,0);
});
