'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const secondary=require('../src/runtime/hermes-openrouter-secondary');
const runner=require('../scripts/run-hermes-telegram-private');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const now=Date.parse('2026-10-23T18:00:00Z');
const validKey='sk-or-v1-'+'a'.repeat(48);
test('OpenRouter stays disabled with no key; staging only and read-only gate',()=>{
 assert.equal(secondary.makeOpenRouter({enabled:false}),null);
 assert.throws(()=>secondary.makeOpenRouter({enabled:true,stage:'production',killSwitch:true,key:validKey}),/configuration_denied/);
 assert.throws(()=>secondary.makeOpenRouter({enabled:true,stage:'staging',killSwitch:false,key:validKey}),/configuration_denied/);
 assert.equal(secondary.tierForTask('Resuma os indicadores históricos da empresa'),'low');
 assert.equal(secondary.tierForTask('Analise o risco financeiro de conciliação'),'medium');
});
test('OpenRouter cost tier, strict price, ZDR and data policy are enforced',async()=>{
 const requests=[];
 const provider=secondary.makeOpenRouter({enabled:true,stage:'staging',killSwitch:true,key:validKey,
  fetchImpl:async (url,request)=>{
   requests.push({url,...request});
   return new Response(JSON.stringify({model:'google/gemini-2.5-flash',
    choices:[{message:{content:requests.length===1?'{"steps":[]}':'Resposta segura e verificável.'}}]}),
    {status:200,headers:{'Content-Type':'application/json'}});
  }});
 const task=provider.forTask('Analise riscos financeiros e compromissos');
 const msg=[{role:'system',content:'Regras de resposta.'},{role:'user',content:'Dados autorizados e agregados.'}];
 assert.equal(await task.chat(msg,{maxTokens:650,jsonMode:true}),'{"steps":[]}');
 assert.equal(await task.chat(msg,{maxTokens:950,jsonMode:false}),'Resposta segura e verificável.');
 assert.equal(requests.length,2);
 const a=JSON.parse(requests[0].body),b=JSON.parse(requests[1].body);
 assert.equal(requests[0].url,'https://openrouter.ai/api/v1/chat/completions');
 assert.equal(a.model,'openrouter/auto');
 assert.deepEqual(a.plugins,[{id:'auto-router',cost_tier:'medium'}]);
 assert.equal(a.provider.zdr,true);assert.equal(a.provider.data_collection,'deny');
 assert.ok(a.provider.max_price.completion<=4);
 assert.equal(a.max_tokens,650);
 assert.equal(b.model,'google/gemini-2.5-flash');
 assert.ok(!('plugins' in b));
 await assert.rejects(()=>task.chat(msg,{maxTokens:650}),/task_cap/);
 assert.equal(requests[0].headers.Authorization,'Bearer '+validKey);
});
test('Codex fallback only for allowed provider errors, not authorization/validation',()=>{
 for(const name of ['codex_login_quota_exhausted','codex_login_provider_unavailable','codex_login_timeout'])
  assert(secondary.isFallbackEligible(Error(name)));
 for(const name of ['agent_auto_memory_context_unsafe','agent_daily_quota','codex_login_auth_expired'])
  assert(!secondary.isFallbackEligible(Error(name)));
});
test('four-turn Codex pilot quota activates only explicitly enabled secondary provider',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hermes-router-'));
 fs.chmodSync(dir,0o700);
 const goal='Analise os riscos financeiros e nossa conciliação';
 const update={update_id:10,message:{chat:{id:777,type:'private'},from:{id:777,is_bot:false},message_id:1,text:goal}};
 let primary=0,secondaryCalls=0;
 const router={forTask:()=>({chat:async(messages,{jsonMode=false})=>{
  secondaryCalls++;return jsonMode?JSON.stringify({steps:[{tool:'compras',params:{}}]}):
   'Não há conciliação comprovada; consulte dados atuais antes de assumir compromissos.';}})};
 runner.saveState(dir,'owner.json',{owner_id:777}); // owned state only
 runner.saveState(dir,'agent-llm-budget.json',{date:'2026-10-23',turns:4});
 try{
  // read state without external Telegram/SQL: simulated history response is bounded and verified.
  const sent=[];
  await runner.pollOnce({stateDir:dir,api:async m=>m==='getUpdates'?[update]:[],
   query:async()=>({ok:true}),clock:()=>now,liveEnabled:true,
   agentModel:{chat:async()=>{primary++;throw Error('codex_login_quota_exhausted')}},
   secondaryProvider:router,readLive:async()=>{throw Error('no live calls')},
   autoMemoryEnabled:false});
  assert.equal(primary,0);
  assert.ok(secondaryCalls>=1);
  assert.equal(runner.loadState(dir,'agent-llm-budget.json').turns,4);
  assert.equal(runner.loadState(dir,'agent-openrouter-budget.json').count,secondaryCalls);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
