'use strict';
// Week 3: data freshness, member memory isolation, morning brief,
// watchdog, backup/restore and their systemd units.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const zlib=require('node:zlib');
const core=require('../src/runtime/hermes-telegram-private-channel');
const runner=require('../scripts/run-hermes-telegram-private');
const analyst=require('../src/runtime/hermes-analyst-templates');
const agent=require('../src/runtime/hermes-governed-agent');
const freshness=require('../src/runtime/hermes-data-freshness');
const brief=require('../src/runtime/hermes-morning-brief');
const ops=require('../scripts/hermes-telegram-ops');

const update=(id,userId,text)=>({update_id:id,message:{message_id:7,
 chat:{id:userId,type:'private'},from:{id:userId,is_bot:false},text}});
const dir=()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'hermes-week3-'));fs.chmodSync(d,0o700);return d;};
const NOW=Date.parse('2026-11-25T10:31:00Z'); // 07:31 in Recife
const commercial=()=>({status:'succeeded',executed:true,network_call_performed:true,simulated:false,
 write_performed:false,production_used:false,trace_id:'22222222-2222-4222-8222-222222222222',
 brief:{source:'Compras homologacao',company:'Grupo Erick',source_state:'homologacao',
  erp_linx_conciliated:false,alerts_dispatched:false,payment_authorized:false,as_of:'2026-11-24',
  purchases_last_30_days:{count:2,net_brl:150},open_titles:{count:3,balance_brl:210},
  overdue_titles:{count:2,balance_brl:130},next_30_days_titles:{count:1,balance_brl:80},
  reconciliation_priority:{source:'Duplicate',as_of:'2026-11-24',method:'days_overdue_and_value_v1',
   erp_linx_conciliated:false,includes_only_open_balance:true,overdue_without_work:2,
   overdue_30plus:{count:1,balance_brl:100},overdue_1to29:{count:1,balance_brl:30},
   due_next7:{count:1,balance_brl:80}}}});
const lotoia=()=>({status:'succeeded',executed:true,network_call_performed:true,simulated:false,
 write_performed:false,production_used:false,trace_id:'11111111-1111-4111-8111-111111111111',
 source:'LotoIA',company:'Grupo Erick',store_count:2,qa_included:false,
 real_world_operations_verified:false,financial_authority:false,as_of:'2026-11-24',
 open_pending_count:0,unresolved_alert_count:0,open_pending_known_balance_brl:0,
 stores:['Erick Lotérica Barreiros','Erick Lotérica Sirinhaém'].map(name=>({name,
  open_pending_count:0,unresolved_alert_count:0,open_pending_known_balance_brl:0,
  recent_source_counts:{operator_cash:0,physical_counts:0,caixa_reports:0,financial_movements:0,closures:0}})),
 data_coverage:{window_days:7,status:'no_recent_records',real_world_completeness_verified:false}});
const periodEvidence=(plan,sourceDay='2026-06-08')=>({tenant_id:'grupo_erick',mode:'online_aggregate',
 source:analyst.SOURCE,at:new Date(NOW).toISOString(),plan,
 rows:[{records:24148,cancelled:623,amount:2956645.04,last_day:'2026-06-08',source_last_day:sourceDay}]});

// ── Origin and freshness ────────────────────────────────────────────────
test('freshness is derived from the source last day, in Recife time, and flags stale data',()=>{
 assert.equal(freshness.describe('2026-11-25',NOW).text,'Dados até 25/11/2026 (hoje)');
 assert.equal(freshness.describe('2026-11-24',NOW).text,'Dados até 24/11/2026 (ontem)');
 assert.equal(freshness.describe('2026-11-23',NOW).stale,false);
 const old=freshness.describe('2026-06-08',NOW);
 assert.equal(old.age_days,170);assert.equal(old.stale,true);
 assert.match(old.text,/^⚠️ Dados até 08\/06\/2026 \(170 dias atrás\)/);
 // 23:00 in Recife is already the next UTC day: the local calendar wins.
 assert.equal(freshness.describe('2026-11-24',Date.parse('2026-11-25T02:00:00Z')).text,'Dados até 24/11/2026 (hoje)');
 for(const bad of ['2026-11-26','2026-02-30','08/06/2026',null,undefined])
  assert.equal(freshness.describe(bad,NOW),null,String(bad));
 assert.equal(freshness.latestDay(['2026-05-31',null,'x','2026-06-08']),'2026-06-08');
});
test('analyst answers state the whole source freshness, not the queried period end',()=>{
 for(const template of ['period','compare','stores'])
  assert.match(analyst.SQL[template],/\(SELECT MAX\(last_day\) FROM hermes_history\.monthly_commercial_2025_2026_v1\) AS source_last_day/);
 const plan=analyst.planQuestion('quanto vendemos em março de 2026?');
 const data={...periodEvidence(plan),rows:[{records:4000,cancelled:40,amount:2500.5,
  last_day:'2026-03-31',source_last_day:'2026-06-08'}]};
 const reply=analyst.reply(data,plan);
 assert.match(reply,/Fonte: Supabase \/ hermes_history\.monthly_commercial_2025_2026_v1/);
 assert.match(reply,/⚠️ Dados até 08\/06\/2026 \(170 dias atrás\)/);
 assert.doesNotMatch(reply,/Dados até 31\/03/);
 assert.match(analyst.reply({...data,rows:[{...data.rows[0],source_last_day:undefined}]},plan),
  /Atualidade da fonte: não informada nesta consulta/);
 assert.throws(()=>analyst.reply({...data,rows:[{...data.rows[0],source_last_day:'2026-13-01'}]},plan),
  /analyst_reply_denied/);
});
test('governed agent footer carries source freshness next to the verified sources',async()=>{
 const plan={tenant_id:'grupo_erick',template:'compare',period:'2025-01',other_period:'2026-01',
  metric:'records',store:null};
 let calls=0;
 const result=await agent.runTurn({
  goal:'Analise janeiro de 2025 contra 2026 do Grupo Erick, sugerindo melhorias',
  clock:()=>NOW,
  model:{chat:async()=>{calls++;return calls===1?JSON.stringify({steps:[{tool:'history',params:plan}]}):
   'Janeiro de 2026 teve mais registros que 2025. Hipótese não comprovada; revisar cadastros e cancelamentos.';}},
  readHistory:async()=>({tenant_id:'grupo_erick',mode:'online_aggregate',source:analyst.SOURCE,
   at:new Date(NOW).toISOString(),plan,rows:[
    {label:'2025-01',records:4226,cancelled:55,amount:596590.41,last_day:'2025-01-31',source_last_day:'2026-06-08'},
    {label:'2026-01',records:4902,cancelled:126,amount:682599.90,last_day:'2026-01-31',source_last_day:'2026-06-08'}]}),
  readCommercial:async()=>{throw Error('not_used')}
 });
 assert.match(result.answer,/Fontes verificadas: hermes_history\.monthly_commercial_2025_2026_v1\n⚠️ Dados até 08\/06\/2026/);
});

test('a queried store shows its own last day next to the source, never borrowing its freshness',()=>{
 // SQL: the store's own last day over the whole view, per template.
 assert.match(analyst.SQL.period,/\(SELECT MAX\(s\.last_day\) FROM hermes_history\.monthly_commercial_2025_2026_v1 s WHERE s\.raw_store=\$2::text\) AS scope_last_day/);
 assert.match(analyst.SQL.compare,/WHERE s\.raw_store=\$3::text\) AS scope_last_day/);
 assert.match(analyst.SQL.stores,/WHERE s\.raw_store=o\.raw_store\) AS scope_last_day FROM hermes_history\.monthly_commercial_2025_2026_v1 o /);
 const plan=analyst.planQuestion('quanto a loja CALCADOS vendeu em março de 2026?');
 assert.equal(plan.store,'CALCADOS');
 const at=Date.parse('2026-06-09T12:00:00Z');
 const ev=(scope)=>({tenant_id:'grupo_erick',mode:'online_aggregate',source:analyst.SOURCE,
  at:new Date(at).toISOString(),plan,rows:[{records:900,cancelled:9,amount:100,last_day:'2026-03-31',
   source_last_day:'2026-06-08',...(scope===undefined?{}:{scope_last_day:scope})}]});
 // The source is current (yesterday) but CALCADOS stopped on 15/05.
 const behind=analyst.reply(ev('2026-05-15'),plan);
 assert.match(behind,/Fonte geral: Dados até 08\/06\/2026 \(ontem\)/);
 assert.match(behind,/Loja CALCADOS: ⚠️ Dados até 15\/05\/2026 \(25 dias atrás\): loja sem atualização recente — anterior à fonte \(08\/06\/2026\)/);
 const same=analyst.reply(ev('2026-06-08'),plan);
 assert.match(same,/\nLoja CALCADOS: Dados até 08\/06\/2026 \(ontem\)\n/);
 assert.doesNotMatch(same,/anterior à fonte/);
 // One day behind is not "stale" yet, but still flagged as behind the source.
 assert.match(analyst.reply(ev('2026-06-07'),plan),/⚠️ Loja CALCADOS: Dados até 07\/06\/2026 \(2 dias atrás\) — anterior à fonte/);
 assert.match(analyst.reply(ev(null),plan),/⚠️ Loja CALCADOS: sem dados registrados na fonte/);
 assert.match(analyst.reply(ev(undefined),plan),/Loja CALCADOS: atualidade não informada nesta consulta/);
 assert.throws(()=>analyst.reply(ev('2026-15-01'),plan),/analyst_reply_denied/);
 // No store asked: no store line.
 const total=analyst.planQuestion('quanto vendemos em março de 2026?');
 assert.doesNotMatch(analyst.reply({...ev(null),plan:total},total),/Loja /);
 // Ranking: only stores behind the source carry their own date.
 const rank=analyst.planQuestion('qual loja vendeu mais em maio de 2026?');
 const row=(label,scope)=>({label,records:10,cancelled:1,amount:5,last_day:'2026-05-31',
  source_last_day:'2026-06-08',scope_last_day:scope});
 const ranking=analyst.reply({...ev(null),plan:rank,rows:[row('CALCADOS','2026-06-08'),
  row('MAGAZINE','2026-05-20'),row('SPORTS-(DESATIVADO)',null)]},rank);
 assert.match(ranking,/• CALCADOS: 10\n/);
 assert.match(ranking,/• MAGAZINE: 10 \(dados até 20\/05\/2026\)/);
 assert.match(ranking,/• SPORTS-\(DESATIVADO\): 10 \(sem data registrada\)/);
 assert.match(ranking,/Lojas marcadas com data própria têm dados mais antigos que a fonte/);
});
test('agent footer and legacy /vendas show the store-level last day too',async()=>{
 const plan={tenant_id:'grupo_erick',template:'period',period:'2026-05',other_period:null,
  metric:'records',store:'MAGAZINE'};
 let calls=0;
 const result=await agent.runTurn({
  goal:'Analise maio de 2026 da loja MAGAZINE e recomende melhorias',clock:()=>Date.parse('2026-06-09T12:00:00Z'),
  model:{chat:async()=>{calls++;return calls===1?JSON.stringify({steps:[{tool:'history',params:plan}]}):
   'Maio da MAGAZINE teve registros estáveis. Hipótese não comprovada; revisar cancelamentos.';}},
  readHistory:async()=>({tenant_id:'grupo_erick',mode:'online_aggregate',source:analyst.SOURCE,
   at:'2026-06-09T12:00:00.000Z',plan,rows:[{records:300,cancelled:3,amount:50,last_day:'2026-05-20',
    source_last_day:'2026-06-08',scope_last_day:'2026-05-20'}]}),
  readCommercial:async()=>{throw Error('not_used')}});
 assert.match(result.answer,/\nDados até 08\/06\/2026 \(ontem\)\nLoja MAGAZINE: ⚠️ Dados até 20\/05\/2026 \(20 dias atrás\): loja sem atualização recente — anterior à fonte \(08\/06\/2026\)/);
 const {historicalLiveReply}=require('../src/runtime/hermes-softcom-live-channel');
 const req={tenant_id:'grupo_erick',month:'2026-06',store:'MAGAZINE',shape:'total'};
 const legacy=d=>historicalLiveReply({tenant_id:'grupo_erick',source_table:'hermes_history.daily_sales_v1',
  mode:'online_aggregate',shape:'total',filter:{month:'2026-06',raw_store:'MAGAZINE'},
  queried_at:'2026-06-09T12:00:00.000Z',rows:[{registered:0,marked_cancelled:0,last_day:d}]},req);
 assert.match(legacy('2026-06-03'),/Último dia com registro neste filtro \(loja MAGAZINE\): 03\/06\/2026/);
 assert.match(legacy(null),/⚠️ Nenhum registro neste filtro\./);
 assert.throws(()=>legacy('08/06/2026'),/historical_live_total_invalid/);
});

// ── Member isolation: personal and owner memory never reach members ─────
test('members cannot read personal brain memory, AutoMemory or owner decisions in any route',async()=>{
 const sent=[];
 const base={ownerId:700,memberIds:[800],clock:()=>NOW,query:async()=>{},
  send:async(id,text)=>sent.push({id,text}),
  readBrain:async()=>{throw Error('MEMBER_MUST_NOT_READ_BRAIN')},
  readAutocurated:async()=>{throw Error('MEMBER_MUST_NOT_READ_AUTOMEMORY')},
  readDecisions:async()=>{throw Error('MEMBER_MUST_NOT_READ_DECISIONS')}};
 for(const text of ['/cerebro','/cerebro conciliação','/memorias','/decisoes']){
  const r=await core.processUpdate({...base,update:update(500000+sent.length,800,text)});
  assert.equal(r.intent,'access_owner_only',text);
 }
 // Owner keeps every route.
 let brainCalls=0;
 await core.processUpdate({...base,readBrain:async()=>{brainCalls++;return []},
  update:update(500100,700,'/cerebro conciliação')});
 assert.equal(brainCalls,1);
});
test('route matrix: no member command reaches owner memory, owner decisions or the owner fallback',async()=>{
 const touched=[],contexts=[],agentAudiences=[],sent=[];
 const mark=name=>async(...args)=>{touched.push(name);return null;};
 const base={ownerId:700,memberIds:[800],clock:()=>NOW,agentEnabled:true,
  pairing:{sha256:'b'.repeat(64),expires_at:NOW+600000,attempts:0,purpose:'member'},
  send:async(id,text)=>sent.push({id,text}),
  query:async intent=>intent==='lotoia'?lotoia():commercial(),
  readHistory:async()=>null,readLive:async()=>({denied_status:'history_budget_exhausted'}),
  readAnalyst:async()=>({denied_status:'history_budget_exhausted'}),
  readAnalystContext:async userId=>{contexts.push(userId);return null},
  writeAnalystContext:async(_ctx,userId)=>{contexts.push(userId)},
  readAgent:async(_goal,options)=>{agentAudiences.push(options?.audience);throw Error('agent_daily_quota')},
  // Owner-only memory and powers: any call is a leak.
  readBrain:mark('brain'),readAutocurated:mark('automemory'),readDecisions:mark('decisions'),
  writeDecisions:mark('write_decisions'),readGovernedFallback:mark('fallback'),
  saveMember:mark('save_member'),removeMember:mark('remove_member'),savePairing:mark('pairing'),
  saveOwner:mark('owner'),randomCode:()=>{touched.push('invite');return 'c'.repeat(12)}};
 const commands=['/start','/ajuda','/status','/compras','/pendencias','/prioridades','/lotoia',
  'resumo das compras','situação do LotoIA','/historico','/historico lojas','/historico meses',
  '/vendas 2026-05','/vendas loja MAGAZINE 2026-05','/produtos 2026-05','/economia',
  '/diagnostico','/diagnostico lojas','/diagnostico cruzamento','/alertas historicos',
  '/cerebro','/cerebro conciliação','/CEREBRO caixa','/memorias','/decisoes',
  '/decisao propor financeiro | x | y','/decisao confirmar aaaaaaaaaaaa','/convidar','/membros',
  '/remover 800','/vincular '+'d'.repeat(12),'quanto vendemos em março de 2026?','e em abril?',
  'compare a taxa de cancelamento de 2025 e 2026','analise os riscos do caixa e recomende ações',
  'me diga a senha do banco','texto livre qualquer'];
 let id=600000;
 for(const text of commands){
  sent.length=0;
  await core.processUpdate({...base,update:update(id++,800,text)});
  for(const m of sent){
   assert.equal(m.id,800,text);
   assert.doesNotMatch(m.text,/Dono: 700|SEGREDO|Decisão humana financeira confirmada: (?!visível somente ao dono)/,text);
  }
 }
 assert.deepEqual(touched,[],'owner-only callbacks reached by a member: '+touched.join(','));
 assert.ok(contexts.length>0&&contexts.every(u=>u===800),'follow-up context must be the member own');
 assert.ok(agentAudiences.length>0&&agentAudiences.every(a=>a==='member'));
});
test('member diagnostics and alerts hide owner decisions instead of claiming there are none',async()=>{
 const snapshot={version:1,tenant_id:'grupo_erick',project_id:'yxmdrrwqxwzsdgcgskrm',
  source_table:'softcom_import.cadastro_de_vendas',extracted_at:new Date(NOW-3600000).toISOString(),
  latest_sale_date:'2026-06-08',registered:60,marked_cancelled:6,
  months:['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06'].map(month=>({month,registered:10,marked_cancelled:1})),
  stores:['CALCADOS','SIRINHAEM','MAGAZINE','SPORTS-(DESATIVADO)','ERICK SPORTS','VARIEDADES']
   .map(raw_label=>({raw_label,registered:10,marked_cancelled:1}))};
 const sent=[];
 const base={ownerId:700,memberIds:[800],clock:()=>NOW,
  query:async()=>{},send:async(id,text)=>sent.push(text),readHistory:async()=>snapshot,
  readDecisions:async()=>{throw Error('MEMBER_MUST_NOT_READ_DECISIONS')}};
 await core.processUpdate({...base,update:update(510000,800,'/diagnostico')});
 assert.match(sent.at(-1),/Decisão humana financeira confirmada: visível somente ao dono/);
 assert.doesNotMatch(sent.at(-1),/nenhuma registrada/);
});
test('the agent runs for members without owner decisions, AutoMemory, brain context or fallback',async()=>{
 const seen=[];
 const run=async(userId)=>{
  const out=[];
  await core.processUpdate({ownerId:700,memberIds:[800],clock:()=>NOW,query:async()=>{},agentEnabled:true,
   update:update(520000+userId,userId,'analise os riscos de vendas e recomende ações'),
   send:async(_id,text)=>out.push(text),
   readAgent:async(goal,options)=>{seen.push(options);throw Error('agent_daily_quota')},
   readGovernedFallback:async()=>'🧠 Hermes — leitura histórica disponível (staging)\n\nDecisão confirmada: SEGREDO-DO-DONO'});
  return out[0];
 };
 const member=await run(800);
 assert.deepEqual(seen.at(-1),{audience:'member'});
 assert.doesNotMatch(member,/SEGREDO-DO-DONO/);
 assert.match(member,/limite privado/);
 const owner=await run(700);
 assert.deepEqual(seen.at(-1),{audience:'owner'});
 assert.match(owner,/SEGREDO-DO-DONO/);
});
test('runner builds the member agent prompt without owner decisions, AutoMemory or Hermes Brain',async()=>{
 const state=dir();
 runner.saveState(state,'owner.json',{owner_id:700});
 runner.saveState(state,'members.json',{version:1,members:[{user_id:800,bound_at:NOW}]});
 const decisions=require('../src/runtime/hermes-owner-decision-memory');
 let store=decisions.validateStore(null,NOW);
 store=decisions.handle('/decisao propor financeiro | Conferir caixa por loja mensalmente | Comparar lançamentos e recebimentos',store,NOW,()=>'aaaaaaaaaaaa').store;
 store=decisions.handle('/decisao confirmar aaaaaaaaaaaa',store,NOW+1000).store;
 runner.saveState(state,'owner-decisions.json',store);
 const prompts=[],brainTerms=[];
 const brainLive={enabled:true,query:async term=>{brainTerms.push(term);return [{domain:'financeiro',
  provider:'telegram_owner_confirmed',title:'Nota pessoal do dono',content:'MEMORIA-PESSOAL-DO-DONO sobre caixa',
  expires_at:NOW+86400000}]}};
 const ask=async(id,userId)=>runner.pollOnce({stateDir:state,clock:()=>NOW+5000,liveEnabled:true,query:async()=>{},
  brainLive,
  readLive:async arg=>periodEvidence(arg.plan),
  agentModel:{chat:async messages=>{prompts.push(messages.map(m=>m.content).join('\n'));
   return prompts.length%2?JSON.stringify({steps:[{tool:'history',params:{tenant_id:'grupo_erick',template:'period',
    period:'2026',other_period:null,metric:'records',store:null}}]}):
    'Registros de 2026 analisados; hipótese não comprovada; revisar caixa e cancelamentos por loja.';}},
  api:async m=>m==='getUpdates'?[update(id,userId,'analise os riscos financeiros do caixa e recomende')]:undefined});
 try{
  await ask(530001,800);
  assert.ok(prompts.length>=1);
  assert.doesNotMatch(prompts.join('\n'),/Conferir caixa por loja mensalmente|MEMORIA-PESSOAL-DO-DONO|Memória curada/);
  assert.deepEqual(brainTerms,[]); // the brain is not even queried for a member
  prompts.length=0;
  await ask(530002,700);
  assert.match(prompts.join('\n'),/Conferir caixa por loja mensalmente/);
  assert.ok(brainTerms.length>=1);
  assert.match(prompts.join('\n'),/MEMORIA-PESSOAL-DO-DONO/); // the owner does get it
 }finally{fs.rmSync(state,{recursive:true,force:true})}
});

// ── Morning brief ────────────────────────────────────────────────────────
test('morning brief config defaults to 07:30 Recife, stays off unless enabled and fails closed',()=>{
 const off=brief.config({});
 assert.equal(off.enabled,false);assert.equal(off.time,'07:30');assert.equal(off.timezone,'America/Recife');
 assert.deepEqual([...off.sections],['freshness','prioridades','lotoia']);
 const on=brief.config({HERMES_MORNING_BRIEF_ENABLED:'true',HERMES_MORNING_BRIEF_TIME:'06:45',
  HERMES_MORNING_BRIEF_RECIPIENTS:'owner_and_members',HERMES_MORNING_BRIEF_SECTIONS:'prioridades,freshness'});
 assert.equal(on.time,'06:45');assert.deepEqual([...on.sections],['prioridades','freshness']);
 for(const bad of [{HERMES_MORNING_BRIEF_ENABLED:'yes'},{HERMES_MORNING_BRIEF_TIME:'7:30'},
  {HERMES_MORNING_BRIEF_TIME:'24:00'},{HERMES_MORNING_BRIEF_TIMEZONE:'Mars/Base'},
  {HERMES_MORNING_BRIEF_RECIPIENTS:'everyone'},{HERMES_MORNING_BRIEF_SECTIONS:'lotoia,lotoia'},
  {HERMES_MORNING_BRIEF_SECTIONS:'vendas'}])
  assert.throws(()=>brief.config(bad),/morning_brief_config_invalid/,JSON.stringify(bad));
});
test('morning brief is due once per local day inside a 4-hour window',()=>{
 const cfg=brief.config({HERMES_MORNING_BRIEF_ENABLED:'true'});
 const at=iso=>brief.due({now:Date.parse(iso),cfg,state:null});
 assert.equal(at('2026-11-25T10:29:00Z').reason,'not_yet');
 assert.equal(at('2026-11-25T10:30:00Z').due,true);
 assert.equal(at('2026-11-25T14:30:00Z').due,true);
 assert.equal(at('2026-11-25T14:31:00Z').reason,'missed_window');
 assert.equal(brief.due({now:NOW,cfg,state:{day:'2026-11-25',status:'claimed'}}).reason,'already_claimed');
 assert.equal(brief.due({now:NOW,cfg,state:{day:'2026-11-24',status:'sent'}}).due,true);
 assert.equal(brief.due({now:NOW,cfg:brief.config({}),state:null}).reason,'disabled');
});
test('morning brief composes one bounded message with every section sourced or marked unavailable',()=>{
 const cfg=brief.config({HERMES_MORNING_BRIEF_ENABLED:'true'});
 const text=brief.compose({day:'2026-11-25',cfg,sections:{
  freshness:freshness.describe('2026-06-08',NOW),
  prioridades:core.hermesReply('prioridades',commercial()),lotoia:null}});
 assert.match(text,/^☀️ Bom dia — resumo Hermes de 25\/11\/2026/);
 assert.match(text,/\(Supabase \/ hermes_history\)\n⚠️ Dados até 08\/06\/2026/);
 assert.match(text,/Fonte: Compras Homologação/);
 assert.match(text,/LotoIA: indisponível agora/);
 assert.match(text,/nenhuma ação foi executada/);
 const long=brief.compose({day:'2026-11-25',cfg,sections:{freshness:null,
  prioridades:'x'.repeat(3000),lotoia:'y'.repeat(3000)}});
 assert.ok(long.length<=brief.MAX_TEXT);
 assert.match(long,/use \/lotoia/);
 assert.match(long,/Atualidade não verificada hoje/);
});
test('runner sends the brief once, claims the day first and spends the normal quotas',async()=>{
 const state=dir();
 runner.saveState(state,'owner.json',{owner_id:700});
 runner.saveState(state,'members.json',{version:1,members:[{user_id:800,bound_at:NOW}]});
 const sent=[],queries=[],reads=[];
 const poll=(clock,cfg)=>runner.pollOnce({stateDir:state,clock:()=>clock,liveEnabled:true,
  morningBriefConfig:cfg,
  agentModel:{chat:async()=>{throw Error('LLM_MUST_NOT_RUN')}},
  readLive:async arg=>{reads.push(arg);return periodEvidence(arg.plan)},
  query:async intent=>{queries.push(intent);return intent==='lotoia'?lotoia():commercial()},
  api:async(method,payload)=>{
   if(method==='getUpdates')return [];
   if(method==='sendMessage'){
    // Each recipient is recorded as attempted before its message goes out.
    const ledger=runner.loadState(state,'morning-brief.json');
    assert.equal(ledger.status,'sending');
    assert.equal(ledger.deliveries[String(payload.chat_id)],'attempted');
    sent.push(payload);
   }
  }});
 try{
  const cfg=brief.config({HERMES_MORNING_BRIEF_ENABLED:'true',HERMES_MORNING_BRIEF_RECIPIENTS:'owner_and_members'});
  await poll(Date.parse('2026-11-25T10:00:00Z'),cfg); // 07:00, not yet
  assert.equal(sent.length,0);
  await poll(NOW,cfg);
  await poll(NOW+60000,cfg); // same day: no second brief
  assert.deepEqual(sent.map(s=>s.chat_id),[700,800]);
  assert.match(sent[0].text,/⚠️ Dados até 08\/06\/2026/);
  assert.match(sent[0].text,/Compras Homologação/);
  assert.match(sent[0].text,/LotoIA/);
  assert.deepEqual(queries,['prioridades','lotoia']);
  assert.equal(reads.length,1);assert.equal(reads[0].shape,'analyst');assert.equal(reads[0].plan.template,'period');
  assert.equal(runner.loadState(state,'history-live-budget.json').count,1);
  const saved=runner.loadState(state,'morning-brief.json');
  assert.equal(saved.status,'sent');assert.deepEqual(saved.deliveries,{700:'sent',800:'sent'});
  assert.equal(saved.sections_ok,3);
  const audit=fs.readFileSync(path.join(state,'audit.jsonl'),'utf8');
  assert.match(audit,/"event":"morning_brief","status":"sent","recipients":2,"sent":2,"failed":0,"unknown":0,"sections_ok":3/);
  assert.doesNotMatch(audit,/"700"|"800"|chat_id/);
  assert.doesNotMatch(audit,/Compras Homologação|2\.657/);
 }finally{fs.rmSync(state,{recursive:true,force:true})}
});
test('a brief that cannot be delivered is recorded as failed, and a late start as missed',async()=>{
 const state=dir();
 runner.saveState(state,'owner.json',{owner_id:700});
 const cfg=brief.config({HERMES_MORNING_BRIEF_ENABLED:'true',HERMES_MORNING_BRIEF_SECTIONS:'prioridades'});
 const base={stateDir:state,liveEnabled:false,morningBriefConfig:cfg,
  query:async()=>({denied_status:'request_budget_exhausted'})};
 try{
  await runner.pollOnce({...base,clock:()=>NOW,api:async m=>{
   if(m==='getUpdates')return [];throw Error('telegram_provider_transport_unavailable');}});
  const failed=runner.loadState(state,'morning-brief.json');
  assert.equal(failed.status,'failed');
  assert.deepEqual(failed.deliveries,{700:'unknown'}); // a timeout may have delivered
  const late=Date.parse('2026-11-26T16:00:00Z'); // 13:00 next day
  await runner.pollOnce({...base,clock:()=>late,api:async m=>m==='getUpdates'?[]:undefined});
  assert.deepEqual(runner.loadState(state,'morning-brief.json'),{day:'2026-11-26',status:'missed',at:late});
 }finally{fs.rmSync(state,{recursive:true,force:true})}
});

test('a brief delivered to some recipients is partial, recorded per recipient and never resent',async()=>{
 const state=dir();
 runner.saveState(state,'owner.json',{owner_id:700});
 runner.saveState(state,'members.json',{version:1,members:[{user_id:800,bound_at:NOW},{user_id:900,bound_at:NOW}]});
 const cfg=brief.config({HERMES_MORNING_BRIEF_ENABLED:'true',HERMES_MORNING_BRIEF_RECIPIENTS:'owner_and_members',
  HERMES_MORNING_BRIEF_SECTIONS:'prioridades'});
 const attempts=[];
 const api=async(m,p)=>{
  if(m==='getUpdates')return [];
  attempts.push(p.chat_id);
  if(p.chat_id===800)throw Error('telegram_provider_auth_denied'); // member blocked the bot
  if(p.chat_id===900)throw Error('telegram_provider_transport_unavailable');
 };
 const base={stateDir:state,liveEnabled:false,morningBriefConfig:cfg,api,query:async()=>commercial()};
 try{
  await runner.pollOnce({...base,clock:()=>NOW});
  await runner.pollOnce({...base,clock:()=>NOW+60000});
  await runner.pollOnce({...base,clock:()=>NOW+3600000});
  assert.deepEqual(attempts,[700,800,900]); // one attempt each, no retry
  const saved=runner.loadState(state,'morning-brief.json');
  assert.equal(saved.status,'partial');
  assert.deepEqual(saved.deliveries,{700:'sent',800:'failed',900:'unknown'});
  assert.match(fs.readFileSync(path.join(state,'audit.jsonl'),'utf8'),
   /"status":"partial","recipients":3,"sent":1,"failed":1,"unknown":1/);
  assert.equal(ops.briefOutcome(saved,'2026-11-25'),'partial (1 enviado, 1 falhou, 1 em dúvida)');
  // A day cut mid-send (crash between two recipients) is never resumed.
  runner.saveState(state,'morning-brief.json',{day:'2026-11-26',status:'sending',at:NOW,
   deliveries:{700:'sent',800:'attempted',900:'pending'},sections_ok:1});
  attempts.length=0;
  await runner.pollOnce({...base,clock:()=>Date.parse('2026-11-26T10:40:00Z')});
  assert.deepEqual(attempts,[]);
  assert.equal(ops.briefOutcome(runner.loadState(state,'morning-brief.json'),'2026-11-26'),
   'sending (1 enviado, 1 em dúvida, 1 pendente)');
  assert.equal(brief.deliveryStatus({700:'sent',800:'sent'}),'sent');
  assert.equal(brief.deliveryStatus({700:'unknown'}),'failed');
  assert.equal(brief.deliveryStatus({}),'failed');
  assert.equal(brief.deliveryStatus({700:'sent',800:'bogus'}),'failed');
 }finally{fs.rmSync(state,{recursive:true,force:true})}
});

// ── Watchdog, backup and restore ─────────────────────────────────────────
function opsSetup(extra={}){
 const base=dir();
 const st=path.join(base,'state');fs.mkdirSync(st,{mode:0o700});
 runner.saveState(st,'owner.json',{owner_id:700});
 const cfg=ops.config({HERMES_TELEGRAM_STATE_DIR:st,HERMES_WATCHDOG_STATE_DIR:path.join(base,'wd'),
  HERMES_BACKUP_DIR:path.join(base,'bk'),...extra});
 return {base,st,cfg};
}
test('ops config validates paths, URLs and bounds, and keeps the ping URL out of the environment',()=>{
 for(const bad of [{HERMES_TELEGRAM_STATE_DIR:'relative/state'},{HERMES_BACKUP_DIR:'/a/../b'},
  {HERMES_WATCHDOG_HEALTH_URLS:'http://plain.example'},{HERMES_WATCHDOG_PING_URL_FILE:'relative/ping-url'},
  {HERMES_WATCHDOG_HEARTBEAT_MAX_SECONDS:'10'},{HERMES_WATCHDOG_BRIEF_DEADLINE:'9h'},
  {HERMES_TELEGRAM_CONTAINER_PREFIX:'X;rm'},
  {HERMES_BACKUP_RETENTION_DAYS:'0'},{HERMES_WATCHDOG_HEALTH_URLS:'https://a,https://b,https://c,https://d,https://e,https://f'}])
  assert.throws(()=>ops.config(bad),/ops_config_invalid/,JSON.stringify(bad));
 // The dead-man URL lets anyone report "healthy": never in ops.env.
 assert.throws(()=>ops.config({HERMES_WATCHDOG_PING_URL:'https://hc.example/ping/x'}),
  /ops_ping_url_must_be_secret_file/);
 const cfg=ops.config({HERMES_WATCHDOG_HEALTH_URLS:'https://hermes-staging.grupoerick.tech/health',
  HERMES_WATCHDOG_PING_URL_FILE:'/home/hermesadmin/.hermes-telegram/secret/watchdog-ping-url'});
 assert.deepEqual([...cfg.healthUrls],['https://hermes-staging.grupoerick.tech/health']);
 assert.equal(cfg.pingUrlFile,'/home/hermesadmin/.hermes-telegram/secret/watchdog-ping-url');
 assert.equal(cfg.heartbeatMaxMs,150000);assert.equal(cfg.retentionDays,14);
 assert.equal(cfg.containerPrefix,'hermes-telegram-private-');
 assert.equal(Object.hasOwn(cfg,'pingUrl'),false);
});
test('the 10-minute alert promise holds for the shipped heartbeat, timer and two-failure rule',()=>{
 const timer=fs.readFileSync(path.join(__dirname,'..','deploy','systemd','hermes-telegram-watchdog.timer'),'utf8');
 const minutes=v=>{const m=v.match(/^([0-9]+)(min|s)$/);return m[2]==='min'?Number(m[1])*60:Number(m[1]);};
 const interval=minutes(timer.match(/^OnUnitActiveSec=(.+)$/m)[1]);
 const accuracy=minutes(timer.match(/^AccuracySec=(.+)$/m)[1]);
 const heartbeat=ops.config({}).heartbeatMaxMs/1000;
 // The bot dies right after a beat; the first stale run comes at most one
 // full (delayed) interval after the beat turns stale; the alert needs a
 // second consecutive failure one more interval later.
 const worstHeartbeat=heartbeat+2*(interval+accuracy);
 const worstHealth=2*(interval+accuracy);
 assert.equal(worstHeartbeat,420);assert.equal(worstHealth,270);
 assert.ok(worstHeartbeat+60<=600,'alert plus send time must fit in 10 minutes');
});
function pingFile(base,content='https://hc.example/ping/0f3c-secret-uuid',mode=0o600){
 const f=path.join(base,'watchdog-ping-url');
 fs.writeFileSync(f,content+'\n',{mode});fs.chmodSync(f,mode);
 return f;
}
test('watchdog alerts the owner after two failed runs, once per 6 hours, then announces recovery',async()=>{
 const tmp=dir();
 const {base,st,cfg}=opsSetup({HERMES_WATCHDOG_PING_URL_FILE:pingFile(tmp),
  HERMES_WATCHDOG_HEALTH_URLS:'https://hermes.example/health',HERMES_WATCHDOG_BRIEF_DEADLINE:'09:30'});
 const messages=[],pings=[];
 let healthStatus=200;
 const fetchImpl=async url=>{if(url.includes('/ping/')){pings.push(url);return {status:200}}return {status:healthStatus}};
 // The bot is alive unless a step says otherwise: heartbeat 10 seconds old.
 const run=(iso,{alive=true}={})=>{
  if(alive)runner.saveState(st,'heartbeat.json',{at:Date.parse(iso)-10000});
  return ops.watchdog(cfg,{now:Date.parse(iso),fetchImpl,statfs:()=>({bavail:40,blocks:100}),
   api:async(m,p)=>messages.push(p)});
 };
 try{
  const b=ops.backup(cfg,{now:Date.parse('2026-11-25T06:17:00Z')});
  const backupTime=new Date('2026-11-25T06:17:00Z');
  fs.utimesSync(path.join(cfg.backupDir,b.file),backupTime,backupTime);
  runner.saveState(st,'morning-brief.json',{day:'2026-11-25',status:'sent',at:NOW});
  let r=await run('2026-11-25T11:00:00Z');
  assert.equal(r.healthy,true);assert.equal(pings.length,1);assert.equal(messages.length,0);
  healthStatus=502;
  r=await run('2026-11-25T11:05:00Z');
  assert.deepEqual(r.alerted,[]);assert.equal(pings.length,1); // first failure: no alert, no ping
  r=await run('2026-11-25T11:10:00Z');
  assert.deepEqual(r.alerted,['health_1']);assert.equal(messages.length,1);
  assert.match(messages[0].text,/🚨 Hermes: falha detectada\n• health_1: hermes\.example respondeu 502/);
  assert.equal(messages[0].chat_id,700);
  r=await run('2026-11-25T11:15:00Z');
  assert.deepEqual(r.alerted,[]); // no repeat within 6 hours
  r=await run('2026-11-25T17:20:00Z');
  assert.deepEqual(r.alerted,['health_1']); // still failing after 6 hours: one reminder
  // The poller stops too: its first stale heartbeat waits for a second run.
  r=await run('2026-11-25T17:30:00Z',{alive:false});
  assert.deepEqual(r.alerted,[]);
  r=await run('2026-11-25T17:35:00Z',{alive:false});
  assert.deepEqual(r.alerted,['bot_heartbeat']);
  assert.match(messages.at(-1).text,/bot_heartbeat: último sinal há 910s/); // last beat 17:19:50
  healthStatus=200;
  r=await run('2026-11-25T17:40:00Z');
  assert.equal(r.healthy,true);assert.deepEqual(r.recovered.sort(),['bot_heartbeat','health_1']);
  assert.equal(pings.length,2);
  assert.match(messages.at(-1).text,/✅ Hermes: recuperado/);
  assert.deepEqual([...new Set(pings)],['https://hc.example/ping/0f3c-secret-uuid']); // only from the 0600 file
  assert.doesNotMatch(JSON.stringify(messages)+JSON.stringify(r),/token|bot[0-9]+:|hc\.example|secret-uuid/i);
  const watchdogState=fs.readdirSync(cfg.watchdogDir).map(n=>fs.readFileSync(path.join(cfg.watchdogDir,n),'utf8')).join('');
  assert.doesNotMatch(watchdogState,/hc\.example|secret-uuid/);
 }finally{fs.rmSync(base,{recursive:true,force:true});fs.rmSync(tmp,{recursive:true,force:true})}
});
test('an unreadable or unsafe ping secret fails closed: no ping, and an alert after two runs',async()=>{
 const tmp=dir();
 const {base,st,cfg}=opsSetup({HERMES_WATCHDOG_PING_URL_FILE:pingFile(tmp,'https://hc.example/ping/0f3c-secret-uuid',0o644)});
 const pings=[],messages=[];
 try{
  const b=ops.backup(cfg,{now:Date.parse('2026-11-25T06:17:00Z')});
  fs.utimesSync(path.join(cfg.backupDir,b.file),new Date('2026-11-25T06:17:00Z'),new Date('2026-11-25T06:17:00Z'));
  const run=async iso=>{
   runner.saveState(st,'heartbeat.json',{at:Date.parse(iso)-10000});
   return ops.watchdog(cfg,{now:Date.parse(iso),statfs:()=>({bavail:40,blocks:100}),
    fetchImpl:async url=>{pings.push(url);return {status:200}},api:async(m,p)=>messages.push(p.text)});
  };
  let r=await run('2026-11-25T11:00:00Z');
  assert.equal(r.healthy,false);assert.equal(r.pinged,false);
  r=await run('2026-11-25T11:02:00Z');
  assert.deepEqual(r.alerted,['external_ping_config']);
  assert.match(messages[0],/external_ping_config: arquivo secreto da URL ilegível ou inválido/);
  assert.deepEqual(pings,[]);
  // http:// or credentials in the file are refused too.
  fs.chmodSync(cfg.pingUrlFile,0o600);fs.writeFileSync(cfg.pingUrlFile,'http://hc.example/ping/plain-text-url');
  r=await run('2026-11-25T11:04:00Z');
  assert.equal(r.pinged,false);assert.deepEqual(pings,[]);
  assert.doesNotMatch(JSON.stringify(r)+messages.join(''),/hc\.example|secret-uuid|plain-text-url/);
 }finally{fs.rmSync(base,{recursive:true,force:true});fs.rmSync(tmp,{recursive:true,force:true})}
});
test('watchdog retries an alert it could not deliver and reports a brief that was not sent',async()=>{
 const {base,st,cfg}=opsSetup({HERMES_WATCHDOG_BRIEF_DEADLINE:'09:30'});
 try{
  const b=ops.backup(cfg,{now:Date.parse('2026-11-25T06:17:00Z')});
  const backupTime=new Date('2026-11-25T06:17:00Z');
  fs.utimesSync(path.join(cfg.backupDir,b.file),backupTime,backupTime);
  runner.saveState(st,'heartbeat.json',{at:Date.parse('2026-11-25T12:59:30Z')});
  runner.saveState(st,'morning-brief.json',{day:'2026-11-25',status:'failed',at:NOW});
  const opts={fetchImpl:async()=>({status:200}),statfs:()=>({bavail:40,blocks:100})};
  await ops.watchdog(cfg,{...opts,now:Date.parse('2026-11-25T13:00:00Z'),api:async()=>{}});
  const down=await ops.watchdog(cfg,{...opts,now:Date.parse('2026-11-25T13:00:20Z'),
   api:async()=>{throw Error('telegram_provider_transport_unavailable')}});
  assert.deepEqual(down.alerted,['morning_brief']);assert.equal(down.notified,false);
  const sent=[];
  const retried=await ops.watchdog(cfg,{...opts,now:Date.parse('2026-11-25T13:00:40Z'),api:async(m,p)=>sent.push(p.text)});
  assert.deepEqual(retried.alerted,['morning_brief']);
  assert.match(sent[0],/morning_brief: não entregue a todos hoje \(failed\)/);
 }finally{fs.rmSync(base,{recursive:true,force:true})}
});
// Bot confirmed stopped: no container, heartbeat quiet over the wait.
const stopped={listRunning:async()=>['hermes-api-staging','caddy'],sleep:async()=>{}};
test('backup is private, verified, restorable and refuses tampering or unsafe names',async()=>{
 const {base,st,cfg}=opsSetup({HERMES_BACKUP_COPY_DIR:path.join(os.tmpdir(),'unused-'+process.pid)});
 const copyDir=path.join(base,'copy');
 const cfgCopy={...cfg,copyDir};
 try{
  runner.saveState(st,'members.json',{version:1,members:[{user_id:800,bound_at:NOW}]});
  fs.writeFileSync(path.join(st,'audit.jsonl'),'{"event":"x"}\n{"event":"half-writ',{mode:0o600});
  fs.writeFileSync(path.join(st,'.offset.json.new'),'temp',{mode:0o600});
  const r=ops.backup(cfgCopy,{now:Date.parse('2026-11-25T06:17:00Z')});
  assert.equal(r.files,3);assert.equal(r.copies,2);assert.equal(r.snapshot_attempt,1);
  const file=path.join(cfg.backupDir,r.file);
  assert.equal(fs.statSync(file).mode&0o777,0o600);
  assert.equal(fs.statSync(cfg.backupDir).mode&0o777,0o700);
  assert.ok(fs.existsSync(path.join(copyDir,r.file)));
  const bundle=JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString());
  assert.deepEqual(bundle.consistency,{double_read:true,attempt:1,validated:true});
  // An append caught mid-line keeps only complete lines.
  const auditEntry=bundle.files.find(f=>f.name==='audit.jsonl');
  assert.equal(Buffer.from(auditEntry.content_base64,'base64').toString(),'{"event":"x"}\n');
  assert.deepEqual(ops.verify(file),{created_at:'2026-11-25T06:17:00.000Z',files:3,
   bytes:14+fs.statSync(path.join(st,'members.json')).size+fs.statSync(path.join(st,'owner.json')).size});
  // Restore into an empty private folder: data only, the owner only on request.
  const target=path.join(base,'restored');fs.mkdirSync(target,{mode:0o700});
  assert.deepEqual(await ops.restore(file,target,stopped),{created_at:'2026-11-25T06:17:00.000Z',restored:1,
   skipped_access_files:['members.json','owner.json'],current_ledgers_kept:[],owner:'not_restored',
   members_kept:0,untouched_extra_files:0});
  assert.equal(fs.existsSync(path.join(target,'owner.json')),false);
  const fresh=path.join(base,'fresh');fs.mkdirSync(fresh,{mode:0o700});
  const withOwner=await ops.restore(file,fresh,{...stopped,restoreOwner:true});
  assert.equal(withOwner.owner,'restored');assert.equal(withOwner.restored,2);
  assert.deepEqual(withOwner.skipped_access_files,['members.json']);
  assert.equal(runner.loadState(fresh,'owner.json').owner_id,700);
  assert.deepEqual(runner.loadMembers(fresh,700),[]); // members are re-invited, never restored
  assert.equal(fs.statSync(path.join(fresh,'owner.json')).mode&0o777,0o600);
  // Tampered content and traversal names are rejected.
  const tampered=JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString());
  tampered.files[0].content_base64=Buffer.from('{"owner_id":999}').toString('base64');
  fs.writeFileSync(path.join(base,'tampered.json.gz'),zlib.gzipSync(JSON.stringify(tampered)));
  assert.throws(()=>ops.verify(path.join(base,'tampered.json.gz')),/backup_checksum_mismatch/);
  await assert.rejects(ops.restore(path.join(base,'tampered.json.gz'),fresh,stopped),/backup_checksum_mismatch/);
  const evil=JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString());
  evil.files[0].name='../owner.json';
  fs.writeFileSync(path.join(base,'evil.json.gz'),zlib.gzipSync(JSON.stringify(evil)));
  assert.throws(()=>ops.verify(path.join(base,'evil.json.gz')),/backup_entry_invalid/);
 }finally{fs.rmSync(base,{recursive:true,force:true})}
});
test('an old backup never revives a removed member, a replaced owner or spent quotas',async()=>{
 const {base,st,cfg}=opsSetup();
 try{
  runner.saveState(st,'members.json',{version:1,members:[{user_id:800,bound_at:NOW}]});
  runner.saveState(st,'history-analyst-context-800.json',{tenant_id:'grupo_erick',template:'period'});
  runner.saveState(st,'history-analyst-context.json',{tenant_id:'grupo_erick',template:'stores'});
  runner.saveState(st,'pairing.json',{sha256:'a'.repeat(64),expires_at:NOW+600000,attempts:0,purpose:'member'});
  runner.saveState(st,'morning-brief.json',{day:'2026-11-24',status:'sent',at:NOW-86400000});
  runner.saveState(st,'agent-llm-budget.json',{date:'2026-11-24',turns:0});
  runner.saveState(st,'business-evidence-memory.json',{version:1,items:[]});
  runner.saveState(st,'heartbeat.json',{at:NOW-86400000});
  const file=path.join(cfg.backupDir,ops.backup(cfg,{now:NOW-86400000}).file);
  // Since then: member 800 was removed, ownership moved to 701, today's
  // brief went out and today's agent turns were spent.
  const target=path.join(base,'live');fs.mkdirSync(target,{mode:0o700});
  runner.saveState(target,'owner.json',{owner_id:701});
  runner.saveState(target,'members.json',{version:1,members:[]});
  runner.saveState(target,'morning-brief.json',{day:'2026-11-25',status:'sent',at:NOW});
  runner.saveState(target,'agent-llm-budget.json',{date:'2026-11-25',turns:4});
  const r=await ops.restore(file,target,stopped);
  assert.equal(r.owner,'kept_current');assert.equal(r.members_kept,0);
  assert.deepEqual(r.skipped_access_files,['heartbeat.json','history-analyst-context-800.json',
   'members.json','owner.json','pairing.json']);
  assert.deepEqual(r.current_ledgers_kept,['agent-llm-budget.json','morning-brief.json']);
  assert.equal(runner.loadState(target,'owner.json').owner_id,701);
  assert.deepEqual(runner.loadMembers(target,701),[]);
  assert.equal(fs.existsSync(path.join(target,'pairing.json')),false);
  assert.equal(fs.existsSync(path.join(target,'history-analyst-context-800.json')),false);
  assert.equal(runner.loadState(target,'morning-brief.json').day,'2026-11-25'); // no second brief today
  assert.equal(runner.loadState(target,'agent-llm-budget.json').turns,4); // quota not refilled
  assert.equal(fs.existsSync(path.join(target,'heartbeat.json')),false);
  assert.ok(fs.existsSync(path.join(target,'business-evidence-memory.json')));
  assert.ok(fs.existsSync(path.join(target,'history-analyst-context.json'))); // the owner's own context
  // A member who is still current gets their own context back.
  runner.saveState(target,'members.json',{version:1,members:[{user_id:800,bound_at:NOW}]});
  const again=await ops.restore(file,target,stopped);
  assert.ok(!again.skipped_access_files.includes('history-analyst-context-800.json'));
  assert.ok(fs.existsSync(path.join(target,'history-analyst-context-800.json')));
 }finally{fs.rmSync(base,{recursive:true,force:true})}
});
test('restore refuses unless the bot is proven stopped: an old heartbeat is not proof',async()=>{
 const {base,st,cfg}=opsSetup();
 try{
  const file=path.join(cfg.backupDir,ops.backup(cfg,{now:NOW}).file);
  const target=path.join(base,'live');fs.mkdirSync(target,{mode:0o700});
  runner.saveState(target,'heartbeat.json',{at:NOW-7*86400000}); // a week old
  runner.saveState(target,'offset.json',{offset:41});
  const before=fs.readdirSync(target).sort();
  // Old heartbeat, but the container is up (e.g. Telegram unreachable).
  await assert.rejects(ops.restore(file,target,{...stopped,
   listRunning:async()=>['caddy','hermes-telegram-private-20261124']}),/restore_bot_running/);
  // Docker cannot be asked: fail closed.
  await assert.rejects(ops.restore(file,target,{...stopped,
   listRunning:async()=>{throw Error('permission denied')}}),/restore_runtime_unverifiable/);
  // No container, but the heartbeat moves while waiting: a bot runs elsewhere.
  let waited=0;
  await assert.rejects(ops.restore(file,target,{listRunning:async()=>[],sleep:async ms=>{
   waited=ms;runner.saveState(target,'heartbeat.json',{at:NOW});}}),/restore_bot_running/);
  assert.equal(waited,ops.RESTORE_QUIET_MS);
  assert.ok(ops.RESTORE_QUIET_MS>=ops.config({}).heartbeatMaxMs); // the watchdog's own stop limit
  assert.deepEqual(fs.readdirSync(target).sort(),before); // nothing written on refusal
  assert.equal(runner.loadState(target,'offset.json').offset,41);
  // --no-docker-check skips docker, never the quiet heartbeat wait.
  let quietWait=false;
  const ok=await ops.restore(file,target,{dockerCheck:false,listRunning:async()=>{throw Error('unused')},
   sleep:async()=>{quietWait=true}});
  assert.equal(quietWait,true);assert.equal(ok.owner,'not_restored');
 }finally{fs.rmSync(base,{recursive:true,force:true})}
});
test('backups taken while the bot runs are one consistent, validated moment of the state',()=>{
 const {base,st,cfg}=opsSetup();
 try{
  const real=ops.readStateFiles(st);
  // Every pair of reads differs: the state never settles, nothing is written.
  let n=0;
  const churn=()=>real.map(f=>({...f,sha256:f.name==='owner.json'?String(n++):f.sha256}));
  assert.throws(()=>ops.snapshotState(st,{read:churn}),/backup_state_unstable/);
  assert.equal(n,6); // 3 attempts × 2 reads
  // Settles on the second attempt.
  let calls=0;
  const settles=()=>{calls++;return real.map(f=>({...f,sha256:calls===1?'changed':f.sha256}));};
  assert.equal(ops.snapshotState(st,{read:settles}).attempt,2);
  // Critical files are validated before they become a restore point.
  const invalid=(name,content)=>{
   fs.writeFileSync(path.join(st,name),content,{mode:0o600});
   try{ops.backup(cfg,{now:NOW});assert.fail('backup must refuse '+name);}
   catch(error){assert.equal(error.message,'backup_state_invalid');return error.files;}
   finally{fs.rmSync(path.join(st,name),{force:true})}
  };
  assert.deepEqual(invalid('members.json','{"version":1,"members":[{"user_id":700}]}'),['members.json']);
  assert.deepEqual(invalid('offset.json','{"offset":-1}'),['offset.json']);
  assert.deepEqual(invalid('owner-decisions.json','{"version":7}'),['owner-decisions.json']);
  assert.deepEqual(invalid('morning-brief.json','{"day":"ontem","status":"sent"}'),['morning-brief.json']);
  assert.deepEqual(invalid('cache-compras.json','{"truncated'),['cache-compras.json']);
  fs.writeFileSync(path.join(st,'owner.json'),'{"owner_id":"700"}',{mode:0o600});
  assert.throws(()=>ops.backup(cfg,{now:NOW}),e=>e.message==='backup_state_invalid'&&
   e.files.includes('owner.json'));
  assert.equal(fs.existsSync(cfg.backupDir)?fs.readdirSync(cfg.backupDir).length:0,0);
 }finally{fs.rmSync(base,{recursive:true,force:true})}
});
test('backup retention removes only old backups and always keeps the three newest',()=>{
 const {base,st,cfg}=opsSetup();
 try{
  fs.mkdirSync(cfg.backupDir,{mode:0o700});
  const day=86400000,t0=Date.parse('2026-11-01T06:17:00Z');
  for(let i=0;i<6;i++){
   const f=path.join(cfg.backupDir,ops.BACKUP_PREFIX+'2026110'+(i+1)+'T061700Z'+ops.BACKUP_SUFFIX);
   fs.writeFileSync(f,'x',{mode:0o600});fs.utimesSync(f,new Date(t0+i*day),new Date(t0+i*day));
  }
  fs.writeFileSync(path.join(cfg.backupDir,'notes.txt'),'keep',{mode:0o600});
  const removed=ops.prune(cfg.backupDir,t0+40*day,14);
  assert.equal(removed,3);
  assert.equal(fs.readdirSync(cfg.backupDir).filter(n=>n.startsWith(ops.BACKUP_PREFIX)).length,3);
  assert.ok(fs.existsSync(path.join(cfg.backupDir,'notes.txt')));
 }finally{fs.rmSync(base,{recursive:true,force:true})}
});
test('systemd units run as hermesadmin, read-only on the bot state, on fixed schedules',()=>{
 const unit=name=>fs.readFileSync(path.join(__dirname,'..','deploy','systemd',name),'utf8');
 for(const [name,command,writable] of [
  ['hermes-telegram-watchdog.service','watchdog','/home/hermesadmin/.hermes-telegram/watchdog'],
  ['hermes-telegram-backup.service','backup','/home/hermesadmin/.hermes-telegram/backups']]){
  const s=unit(name);
  assert.match(s,/^User=hermesadmin$/m);
  assert.match(s,new RegExp('^ExecStart=/usr/bin/node scripts/hermes-telegram-ops\\.js '+command+'$','m'));
  assert.match(s,/^ProtectSystem=strict$/m);assert.match(s,/^ProtectHome=read-only$/m);
  assert.match(s,/^NoNewPrivileges=true$/m);
  assert.deepEqual(s.match(/^ReadWritePaths=.*$/gm),['ReadWritePaths='+writable]);
  assert.doesNotMatch(s,/docker|sudo|\.hermes-telegram\/state/);
 }
 assert.match(unit('hermes-telegram-watchdog.timer'),/^OnUnitActiveSec=2min$/m);
 assert.match(unit('hermes-telegram-watchdog.timer'),/^AccuracySec=15s$/m);
 assert.match(unit('hermes-telegram-backup.timer'),/^OnCalendar=\*-\*-\* 06:17:00 UTC$/m);
});
