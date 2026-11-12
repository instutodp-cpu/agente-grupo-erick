'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const curator=require('../src/runtime/hermes-automemory-curator');
const agent=require('../src/runtime/hermes-governed-agent');
const analyst=require('../src/runtime/hermes-analyst-templates');
const now=Date.parse('2026-10-23T16:00:00Z');
const at=new Date(now-3600000).toISOString();
const decisions={schema:1,tenant_id:'grupo_erick',scope:'enterprise',pending:null,
 entries:[{id:'abcdef123456',area:'financeiro',
 decision:'Exigir conciliação antes de assumir novos compromissos',
 rationale:'Os totais empresariais precisam ser verificados no Linx',
 source:'owner_confirmed_telegram',proposed_at:at,confirmed_at:at}]};
const policy={enabled:true,tenant_id:'grupo_erick',decisions:true,aggregates:false};
const memory=curator.curate({ownerDecisions:decisions,now,policy});
test('automatic business memory selects a relevant decision, not random unrelated context',()=>{
 const relevant=JSON.parse(curator.context(memory,'Analise os compromissos financeiros do Grupo Erick',now));
 assert.equal(relevant.length,1);
 assert.equal(relevant[0].visibility,'owner_only');
 assert.equal(relevant[0].tenant_id,'grupo_erick');
 assert.match(relevant[0].summary,/conciliação/);
 assert.equal(curator.context(memory,'Vamos analisar campanhas publicitárias',now),'[]');
 assert.equal(curator.context(memory,'Analise os compromissos financeiros do Grupo Erick',now+181*86400000),'[]');
});
test('governed analyst uses memory as scoped context, but still requires verified fresh evidence',async()=>{
 const calls=[];
 const plan={tenant_id:'grupo_erick',template:'compare',period:'2025-01',other_period:'2026-01',metric:'records',store:null};
 const evidence={tenant_id:'grupo_erick',mode:'online_aggregate',source:analyst.SOURCE,
  at,plan,rows:[
   {label:'2025-01',records:4226,cancelled:55,noncancelled:4171,amount:596590.41,last_day:'2025-01-31'},
   {label:'2026-01',records:4902,cancelled:126,noncancelled:4776,amount:682599.90,last_day:'2026-01-31'}
  ]};
 let historyReads=0,cacheReads=0;
 const result=await agent.runTurn({
  goal:'Analise os compromissos financeiros do Grupo Erick',
  clock:()=>now,
  model:{chat:async(messages)=>{
   calls.push(messages);
   if(calls.length===1)return JSON.stringify({steps:[{tool:'history',params:plan}]});
   return 'Os dados históricos não comprovam a situação atual de caixa. Há uma decisão confirmada sobre conciliação. Sugiro validar os compromissos com o Linx antes de assumir novos pagamentos.';
  }},
  readHistory:async()=>{historyReads++;return evidence;},
  readCommercial:async()=>{throw Error('unexpected_commercial');},
  readDecisionContext:()=> '[]',
  readAutoMemoryContext:q=>curator.context(memory,q,now),
  readCachedAnswer:()=>{cacheReads++;return null;}
 });
 assert.equal(historyReads,1);
 assert.equal(calls.length,2);
 assert.equal(cacheReads,0);
 assert.match(calls[1][1].content,/Memória curada do proprietário/);
 assert.match(calls[1][1].content,/Exigir conciliação/);
 assert.match(calls[1][0].content,/NÃO comprovação atual/);
 assert.ok(!result.sources.includes('owner_confirmed_telegram'));
 assert.ok(result.sources.includes(analyst.SOURCE));
});
test('cross-tenant forged memory is denied before model synthesis',async()=>{
 const forged=[{...JSON.parse(curator.context(memory,'Analise os riscos financeiros do Grupo Erick',now))[0],
  tenant_id:'client::outsider'}];
 let calls=0;
 await assert.rejects(()=>agent.runTurn({
  goal:'Analise os riscos financeiros do Grupo Erick',clock:()=>now,
  model:{chat:async()=>{calls++;return JSON.stringify({steps:[{tool:'compras',params:{}}]})}},
  readHistory:async()=>{throw Error('unused_history')},
  readCommercial:async()=> '📦 Compras — Grupo Erick (homologação) Somente leitura. Rastreio: test',
  readAutoMemoryContext:()=>JSON.stringify(forged),
  readDecisionContext:()=> '[]'
 }),/auto_memory_context_unsafe/);
 assert.equal(calls,1);
});
