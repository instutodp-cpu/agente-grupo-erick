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
 assert.throws(()=>a.curate({ownerDecisions:data,now,policy}),/decision_text_denied/);
});

test('historic summaries keep actual comparison numbers rather than a truncated preamble',()=>{
 const analyst=require('../src/runtime/hermes-analyst-templates');
 const evidence=require('../src/runtime/hermes-business-evidence-memory');
 const at=new Date(now-3600000).toISOString();
 const plan={tenant_id:'grupo_erick',template:'compare',period:'2025',other_period:'2026',metric:'records',store:null};
 const data={tenant_id:'grupo_erick',mode:'online_aggregate',source:analyst.SOURCE,at,plan,
  rows:[{label:'2025',records:4122,cancelled:120,amount:91000},
        {label:'2026',records:4999,cancelled:125,amount:102000}]};
 const observed=evidence.observe(null,data,plan,now);
 const snapshot=a.curate({ownerDecisions:null,businessEvidence:observed,now,
  policy:{enabled:true,tenant_id:'grupo_erick',decisions:false,aggregates:true}});
 assert.equal(snapshot.items.length,1);
 const summary=snapshot.items[0].text;
 assert.match(summary,/Comparação — registros de vendas/);
 assert.match(summary,/4\.122/);
 assert.match(summary,/4\.999/);
 assert.match(summary,/Diferença: \+877/);
 assert.doesNotMatch(summary,/Consultado em:|Fonte:|Comparação — regi$/);
 assert.match(a.render(snapshot,now),/Diferença: \+877/);
});
