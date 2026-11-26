'use strict';
// Week 4: periods from the source coverage (no fixed 2025/2026), ticket
// médio, credit (inadimplência) and seller templates awaiting the audited
// views, and the Seta adapter transports.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const coverage=require('../src/runtime/hermes-history-coverage');
const analyst=require('../src/runtime/hermes-analyst-templates');
const agent=require('../src/runtime/hermes-governed-agent');
const core=require('../src/runtime/hermes-telegram-private-channel');
const runner=require('../scripts/run-hermes-telegram-private');

const NOW=Date.parse('2026-11-25T15:00:00Z');
const dir=()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'hermes-week4-'));fs.chmodSync(d,0o700);return d;};
const update=(id,userId,text)=>({update_id:id,message:{message_id:7,
 chat:{id:userId,type:'private'},from:{id:userId,is_bot:false},text}});
// Coverage shaped like the real history found by the Supabase audit
// (softcom_import.cadastro_de_vendas): eight records on 12/04/2011, nothing
// from 2011-05 to 2019-06, then 08/07/2019 to 08/06/2026. Stores differ:
// MAGAZINE has no data in 2023-03, VARIEDADES opens mid-February 2021,
// SPORTS-(DESATIVADO) stops on 15/03/2022.
const monthList=(from,to)=>{const out=[];for(let i=coverage.index(from);i<=coverage.index(to);i++)out.push(coverage.monthAt(i));return out;};
function realRows(){
 const rows=[{scope:'commercial',raw_store:'CALCADOS',month:'2011-04',last_day:'2011-04-12'}];
 const add=(store,from,to,lastOf=m=>m==='2026-06'?'2026-06-08':coverage.monthEnd(m),skip=[])=>{
  for(const m of monthList(from,to))if(!skip.includes(m))rows.push({scope:'commercial',raw_store:store,month:m,last_day:lastOf(m)});
 };
 for(const store of ['CALCADOS','SIRINHAEM','ERICK SPORTS'])add(store,'2019-07','2026-06');
 add('MAGAZINE','2019-07','2026-06',undefined,['2023-03']);
 add('VARIEDADES','2021-02','2026-06');
 add('SPORTS-(DESATIVADO)','2019-07','2022-03',m=>m==='2022-03'?'2022-03-15':coverage.monthEnd(m));
 for(const m of monthList('2023-01','2026-06'))rows.push({scope:'products',raw_store:null,month:m,last_day:null});
 return rows;
}
const real=coverage.fromRows(realRows(),NOW);
const since2011=real; // older name kept for the credit and seller tests below
const evidence=(plan,rows,extra={})=>({tenant_id:'grupo_erick',mode:'online_aggregate',
 source:analyst.SOURCE,at:new Date(NOW).toISOString(),plan,rows,...extra});
const row=(o)=>({records:100,cancelled:10,amount:9000,last_day:'2026-05-31',source_last_day:'2026-06-08',...o});
const sales=(store=null)=>coverage.scopeOf(real,'commercial',store);

// ── Coverage: months really held, gaps, partial months, per store ───────
test('coverage keeps the months really held, with gaps, per store and for the group',()=>{
 assert.equal(real.origin,'source');
 assert.deepEqual(real.commercial.runs.map(r=>[r.first,r.last,r.last_day]),
  [['2011-04','2011-04','2011-04-12'],['2019-07','2026-06','2026-06-08']]);
 assert.deepEqual(real.commercial.stores.MAGAZINE.map(r=>[r.first,r.last]),
  [['2019-07','2023-02'],['2023-04','2026-06']]);
 assert.deepEqual(real.commercial.stores['SPORTS-(DESATIVADO)'].map(r=>[r.first,r.last,r.last_day]),
  [['2019-07','2022-03','2022-03-15']]);
 // Stored and read back: re-validated, read time kept.
 const stored=coverage.validate(JSON.parse(JSON.stringify(real)),NOW+3600000);
 assert.equal(stored.read_at,real.read_at);
 const forged=JSON.parse(JSON.stringify(real));
 forged.commercial.runs=[{first:'2019-07',last:'2026-06',last_day:'2026-06-08',start_complete:false},
  {first:'2011-04',last:'2011-04',last_day:'2011-04-12',start_complete:false}];          // unsorted
 assert.throws(()=>coverage.validate(forged,NOW),/coverage_invalid/);
 forged.commercial.runs=[{first:'2019-07',last:'2020-01',last_day:'2020-01-31',start_complete:false},
  {first:'2020-02',last:'2026-06',last_day:'2026-06-08',start_complete:false}];          // touching runs
 assert.throws(()=>coverage.validate(forged,NOW),/coverage_invalid/);
 const bad=[
  {scope:'commercial',raw_store:'LOJA NOVA',month:'2020-01',last_day:'2020-01-31'},     // unknown store
  {scope:'commercial',raw_store:'CALCADOS',month:'2027-01',last_day:'2027-01-02'},      // future
  {scope:'commercial',raw_store:'CALCADOS',month:'2020-01',last_day:'2020-02-01'},      // day outside month
  {scope:'commercial',raw_store:'CALCADOS',month:'1999-12',last_day:'1999-12-31'},      // before 2000
  {scope:'commercial',raw_store:'CALCADOS',month:'2019-07',last_day:'2019-07-31'}];     // duplicate
 for(const b of bad)assert.throws(()=>coverage.fromRows([...realRows(),b],NOW),/coverage_/,JSON.stringify(b));
 assert.throws(()=>coverage.fromRows(realRows().filter(r=>r.scope==='commercial'),NOW),/coverage_rows_invalid/);
 assert.throws(()=>coverage.fromRows([{scope:'commercial',raw_store:'CALCADOS',month:'2026-06',last_day:null},
  {scope:'products',raw_store:null,month:'2026-06',last_day:null}],NOW),/coverage_last_day_required/);
 assert.throws(()=>coverage.validate({origin:'forged'},NOW),/coverage_invalid/);
 assert.deepEqual(coverage.BASELINE.commercial.runs.map(r=>[r.first,r.last,r.last_day]),[['2025-01','2026-06','2026-06-08']]);
});
test('a month is complete only with evidence: run starts and an open last month are partial',()=>{
 const g=sales();
 assert.equal(coverage.monthComplete(g,'2011-04'),false);   // eight records on one day
 assert.equal(coverage.monthComplete(g,'2019-07'),false);   // data starts on 08/07
 assert.equal(coverage.monthComplete(g,'2019-08'),true);
 assert.equal(coverage.monthComplete(g,'2026-05'),true);
 assert.equal(coverage.monthComplete(g,'2026-06'),false);   // until 08/06
 assert.equal(coverage.accepts(g,'2015-03'),false);         // gap: no data, not zero
 assert.equal(coverage.accepts(g,'2015'),false);
 assert.deepEqual(coverage.presentMonths(g,'2019'),['07','08','09','10','11','12']);
 assert.deepEqual(coverage.completeMonths(g,'2019'),['08','09','10','11','12']);
 assert.deepEqual(coverage.completeMonths(g,'2011'),[]);
 assert.deepEqual(coverage.yearWindow(g,'2019','2020'),{months:['08','09','10','11','12']});
 assert.equal(coverage.yearWindow(g,'2020','2021').months.length,12);
 assert.deepEqual(coverage.yearWindow(g,'2025','2026'),{months:['01','02','03','04','05']});
 assert.equal(coverage.yearWindow(g,'2011','2019'),null); // nothing complete in common
 // Per store: MAGAZINE's gap and restart are excluded, so the window skips months.
 assert.deepEqual(coverage.yearWindow(sales('MAGAZINE'),'2022','2023'),
  {months:['01','02','05','06','07','08','09','10','11','12']});
 assert.equal(coverage.windowText(coverage.yearWindow(sales('MAGAZINE'),'2022','2023')),'janeiro a fevereiro e maio a dezembro');
 assert.equal(coverage.monthComplete(sales('VARIEDADES'),'2021-02'),false);
 assert.equal(coverage.accepts(sales('VARIEDADES'),'2020'),false);
 assert.equal(coverage.monthComplete(sales('SPORTS-(DESATIVADO)'),'2022-03'),false);
 // The verified baseline's first month is a cut of continuous data (2024 exists).
 assert.equal(coverage.monthComplete(coverage.scopeOf(coverage.BASELINE,'commercial'),'2025-01'),true);
 assert.equal(coverage.yearForMonth(g,'07'),'2025');
 assert.equal(coverage.yearForMonth(g,'03'),'2026');
});
test('without per-store coverage the group months only locate the period: nothing is presumed for the store',()=>{
 // Baseline: no per-store reading. VARIEDADES had no records in 12/2024 and
 // 01/2025 (audit), so the group's coverage must not be read as the store's.
 const scope=coverage.scopeOf(coverage.BASELINE,'commercial','VARIEDADES');
 assert.equal(scope.unverified,true);
 assert.equal(coverage.accepts(scope,'2025-01'),true);            // located...
 assert.equal(coverage.monthComplete(scope,'2025-01'),false);     // ...never comparable
 assert.equal(coverage.yearWindow(scope,'2025','2026'),null);
 assert.match(coverage.periodNotes(scope,'2025-01','a loja VARIEDADES')[0],
  /Cobertura própria para a loja VARIEDADES não verificada: os meses do grupo só localizam o período/);
 const plan={tenant_id:'grupo_erick',template:'compare',period:'2025-03',other_period:'2026-03',metric:'records',store:'VARIEDADES'};
 assert.throws(()=>analyst.validate(plan),/analyst_partial_month_comparison_denied/);
 assert.doesNotThrow(()=>analyst.validate({...plan,store:null}));
 const total={tenant_id:'grupo_erick',template:'period',period:'2025-03',other_period:null,metric:'records',store:'VARIEDADES'};
 assert.match(analyst.reply(evidence(total,[row({last_day:'2025-03-31',scope_last_day:'2026-06-08'})]),total),
  /Cobertura própria para a loja VARIEDADES não verificada/);
 // A real per-store reading replaces the fallback.
 assert.equal(coverage.scopeOf(real,'commercial','VARIEDADES').unverified,undefined);
});
test('questions inside a gap are refused, never answered as zero; partial periods are flagged',()=>{
 assert.equal(analyst.planQuestion('quanto vendemos em março de 2015?',null,real),null);
 assert.equal(analyst.planQuestion('quanto vendemos em março de 2015?'),null);
 const jul=analyst.planQuestion('quanto vendemos em julho de 2019?',null,real);
 assert.equal(jul.period,'2019-07');
 assert.match(analyst.reply(evidence(jul,[row({last_day:'2019-07-31'})]),jul,real),
  /⚠️ julho\/2019 é parcial: os dados começam no meio do mês\./);
 const y2019=analyst.planQuestion('quanto vendemos em 2019?',null,real);
 const t2019=analyst.reply(evidence(y2019,[row({last_day:'2019-12-31'})]),y2019,real);
 assert.match(t2019,/⚠️ 2019: dados só de julho a dezembro; meses sem dados não significam venda zero\./);
 assert.match(t2019,/⚠️ 2019: julho parcial\./);
 const y2011=analyst.planQuestion('quanto vendemos em 2011?',null,real);
 assert.match(analyst.reply(evidence(y2011,[row({last_day:'2011-04-12'})]),y2011,real),/2011: dados só de abril/);
 const june=analyst.planQuestion('quanto vendemos em junho de 2026?',null,real);
 assert.match(analyst.reply(evidence(june,[row({last_day:'2026-06-08'})]),june,real),/junho\/2026 é parcial: dados só até 08\/06\/2026/);
 assert.doesNotMatch(analyst.reply(evidence({...june,period:'2026-03'},[row({last_day:'2026-03-31'})]),{...june,period:'2026-03'},real),/parcial/);
 // Store coverage: VARIEDADES did not exist in 2020 although the group did.
 const v={tenant_id:'grupo_erick',template:'period',period:'2020-05',other_period:null,metric:'records',store:'VARIEDADES'};
 assert.throws(()=>analyst.validate(v,real),/analyst_period_not_covered/);
 assert.doesNotThrow(()=>analyst.validate({...v,store:null},real));
 // Partial months are never compared as complete.
 assert.throws(()=>analyst.validate({tenant_id:'grupo_erick',template:'compare',period:'2019-07',
  other_period:'2020-07',metric:'records',store:null},real),/analyst_partial_month_comparison_denied/);
 assert.throws(()=>analyst.validate({tenant_id:'grupo_erick',template:'compare',period:'2011',
  other_period:'2019',metric:'records',store:null},real),/analyst_year_window_empty/);
 assert.throws(()=>analyst.validate({tenant_id:'grupo_erick',template:'compare',period:'2015',
  other_period:'2016',metric:'records',store:null},real),/analyst_period_not_covered/);
});
test('year comparisons bind only months complete in both years, even when they skip months',async()=>{
 const p={tenant_id:'grupo_erick',template:'compare',period:'2022',other_period:'2023',metric:'records',store:'MAGAZINE'};
 let sent;
 const data=await analyst.execute({query:async q=>{sent=q;return {rows:[
  {label:'2022',records:'900',cancelled:'9',noncancelled:'891',amount:'1000.00',last_day:'2022-12-31',source_last_day:'2026-06-08',scope_last_day:'2026-06-08'},
  {label:'2023',records:'800',cancelled:'8',noncancelled:'792',amount:'900.00',last_day:'2023-12-31',source_last_day:'2026-06-08',scope_last_day:'2026-06-08'}]};}},
  p,()=>new Date(NOW),real);
 assert.deepEqual(sent.values,['2022','2023','MAGAZINE',['01','02','05','06','07','08','09','10','11','12']]);
 assert.match(sent.text,/RIGHT\(month,2\)=ANY\(\$4::text\[\]\)/);
 const txt=analyst.reply(data,p,real);
 assert.match(txt,/📅 Cobertura equivalente: janeiro a fevereiro e maio a dezembro de cada ano \(meses com dados contínuos; a completude da exportação não está comprovada\)/);
 assert.match(txt,/A comparação usa apenas janeiro a fevereiro e maio a dezembro, meses com dados contínuos nos dois anos para a loja MAGAZINE/);
 const group=await analyst.execute({query:async q=>{sent=q;return {rows:[]};}},{...p,store:null,period:'2019',other_period:'2020'},()=>new Date(NOW),real)
  .catch(()=>null);
 assert.deepEqual(sent.values,['2019','2020',null,['08','09','10','11','12']]);
 assert.equal(group?.window?.months?.length??5,5);
 for(const bad of [{months:['05','01']},{months:['01','01']},{months:['13']},{months:[]},{months:['01'],from:'01'},{from:'01',to:'05'}])
  assert.throws(()=>analyst.reply({...data,window:bad},p,real),/analyst_reply_denied/,JSON.stringify(bad));
 assert.throws(()=>analyst.reply({...data,window:undefined},p,real),/analyst_reply_denied/);
 assert.doesNotMatch(analyst.SQL.compare,/'0[1-9]'|'1[0-2]'/);
});
test('a store ranking marks stores whose own coverage misses part of the period',()=>{
 const rank={tenant_id:'grupo_erick',template:'stores',period:'2021',other_period:null,metric:'records',store:null};
 const txt=analyst.reply(evidence(rank,[row({label:'CALCADOS',records:500,cancelled:5}),
  row({label:'VARIEDADES',records:300,cancelled:3})]),rank,real);
 assert.match(txt,/• VARIEDADES: 300 \(cobertura parcial nesta loja\)/);
 assert.doesNotMatch(txt,/• CALCADOS: 500 \(/);
 assert.match(txt,/o total menor não significa venda menor/);
});
test('the agent planner is told the months held, gaps included, and validates against them',()=>{
 const prompt=agent.planPrompt(real);
 assert.match(prompt,/Meses com dados de vendas: abril\/2011; julho\/2019 a junho\/2026 \(dados até 08\/06\/2026\)/);
 assert.match(prompt,/lacunas não têm dados nem valem zero/);
 assert.doesNotMatch(prompt,/2025-01\.\.2025-12|Produtos só 2026|oito dias/);
 const plan={steps:[{tool:'history',params:{tenant_id:'grupo_erick',template:'compare',period:'2020',
  other_period:'2021',metric:'records',store:null}}]};
 assert.equal(agent.validateToolPlan(plan,real).length,1);
 assert.throws(()=>agent.validateToolPlan(plan),/analyst_period_not_covered/);
 assert.throws(()=>agent.validateToolPlan({steps:[{tool:'history',params:{...plan.steps[0].params,period:'2015',other_period:'2016'}}]},real),
  /analyst_period_not_covered/);
 assert.throws(()=>agent.validateToolPlan({steps:[2020,2021].map(y=>({tool:'history',params:{tenant_id:'grupo_erick',
  template:'period',period:String(y),other_period:null,metric:'records',store:null}}))},real),
  /agent_unmatched_year_coverage_denied/);
});
test('the cancellation-rate route needs the named months to be the comparable ones',()=>{
 assert.deepEqual({...core.cancellationRatePlan('Compare as taxas de cancelamento de janeiro a dezembro de 2020 e 2021',real)},
  {tenant_id:'grupo_erick',template:'compare',period:'2020',other_period:'2021',metric:'cancelled',store:null});
 assert.equal(core.cancellationRatePlan('Compare as taxas de cancelamento de janeiro a dezembro de 2019 e 2020',real),null);
 assert.ok(core.cancellationRatePlan('Compare as taxas de cancelamento de agosto a dezembro de 2019 e 2020',real));
 assert.equal(core.cancellationRatePlan('Compare as taxas de cancelamento de janeiro a dezembro de 2020 e 2021'),null);
 assert.ok(core.cancellationRatePlan('Compare as taxas de cancelamento de janeiro a maio de 2025 e 2026'));
});

// ── Ticket médio on the existing templates ──────────────────────────────
test('ticket médio = valor_pago importado ÷ registros não cancelados, with its limits stated',async()=>{
 const p=analyst.planQuestion('qual o ticket médio em março de 2026?');
 assert.equal(p.metric,'ticket');assert.equal(p.template,'period');
 const data=await analyst.execute({query:async()=>({rows:[{records:'1000',cancelled:'100',noncancelled:'900',
  amount:'90450.00',last_day:'2026-03-31',source_last_day:'2026-06-08'}]})},p,()=>new Date(NOW));
 const txt=analyst.reply(data,p);
 assert.match(txt,/• ticket médio \(valor_pago importado ÷ registros não cancelados\): R\$\s?100,50/);
 assert.match(txt,/Soma importada de valor_pago \(não cancelados\): R\$\s?90\.450,00/);
 assert.match(txt,/não é faturamento líquido/);
 assert.match(txt,/Ticket por registro de venda importado \(cabeçalho\), não por cliente nem por item/);
 const zero=evidence(p,[row({records:5,cancelled:5,amount:0,last_day:'2026-03-31'})]);
 assert.match(analyst.reply(zero,p),/indefinido \(sem registros não cancelados\)/);
 // Ranking and comparison reuse the same templates.
 const rank=analyst.planQuestion('qual loja tem o maior ticket médio em maio de 2026?');
 assert.equal(rank.template,'stores');assert.equal(rank.metric,'ticket');
 const ranked=analyst.reply(evidence(rank,[row({label:'CALCADOS',records:10,cancelled:0,amount:500}),
  row({label:'MAGAZINE',records:10,cancelled:0,amount:900}),row({label:'VARIEDADES',records:3,cancelled:3,amount:0})]),rank);
 assert.ok(ranked.indexOf('• MAGAZINE: R$')<ranked.indexOf('• CALCADOS: R$'));
 assert.ok(ranked.indexOf('• CALCADOS')<ranked.indexOf('• VARIEDADES: indefinido'));
 const cmp=analyst.planQuestion('compare o ticket médio de março de 2025 e março de 2026');
 assert.equal(cmp.metric,'ticket');
 const compared=analyst.reply(evidence(cmp,[row({label:'2025-03',records:10,cancelled:0,amount:1000}),
  row({label:'2026-03',records:10,cancelled:0,amount:1200})]),cmp);
 assert.match(compared,/• Diferença: \+R\$\s?20,00 \(20%\)/);
 // Products have no ticket.
 assert.equal(analyst.planQuestion('ticket médio dos produtos em março de 2026'),null);
 assert.throws(()=>analyst.validate({tenant_id:'grupo_erick',template:'products',period:'2026-03',
  other_period:null,metric:'ticket',store:null}),/analyst_products_denied/);
});

// ── Runner: one coverage reading per day, outside the question quota ─────
test('the coverage keeper reads once a day, keeps a stored reading, then falls back to the baseline',async()=>{
 const state=dir();
 let clock=NOW,reads=0,fail=false;
 const keeper=runner.createCoverageKeeper({stateDir:state,liveEnabled:true,clock:()=>clock,
  readLive:async q=>{reads++;assert.equal(q.shape,'coverage');if(fail)throw Error('db_down');
   return coverage.fromRows(realRows(),clock);}});
 try{
  assert.equal((await keeper.current()).commercial.runs[0].first,'2011-04');
  assert.equal(reads,1);
  assert.ok(fs.statSync(path.join(state,'history-coverage.json')).size<8192);
  clock+=3600000;await keeper.current();assert.equal(reads,1);     // same day: stored reading
  assert.equal(runner.loadState(state,'history-live-budget.json'),null); // never the question quota
  fail=true;clock+=24*3600000;
  assert.equal((await keeper.current()).commercial.runs[1].first,'2019-07'); // failed refresh keeps it
  assert.equal(reads,2);
  clock+=3600000;await keeper.current();assert.equal(reads,2);     // retry only after 6 h
  clock+=6*3600000;await keeper.current();assert.equal(reads,3);
  clock=NOW+8*24*3600000;                                           // stored reading too old
  assert.equal(await keeper.current(),coverage.BASELINE);
  const audit=fs.readFileSync(path.join(state,'audit.jsonl'),'utf8');
  assert.match(audit,/"event":"history_coverage","first_month":"2011-04","last_month":"2026-06","runs":2/);
  assert.match(audit,/"event":"history_coverage","status":"failed"/);
  const off=runner.createCoverageKeeper({stateDir:dir(),liveEnabled:false,clock:()=>NOW,
   readLive:async()=>{throw Error('MUST_NOT_READ')}});
  assert.equal(await off.current(),coverage.BASELINE);
 }finally{fs.rmSync(state,{recursive:true,force:true})}
});
test('a question about 2020 is answered once the source coverage holds it; 2015 never is',async()=>{
 const state=dir();
 runner.saveState(state,'owner.json',{owner_id:700});
 const sent=[],reads=[];
 let id=700000;
 const poll=(historyCoverage,text)=>runner.pollOnce({stateDir:state,clock:()=>NOW,liveEnabled:true,historyCoverage,
  query:async()=>{throw Error('OTHER_DOMAIN')},
  readLive:async arg=>{reads.push(arg);return evidence(arg.plan,[row({last_day:'2020-03-31'})]);},
  api:async(m,p)=>{if(m==='getUpdates')return [update(id++,700,text)];if(m==='sendMessage')sent.push(p.text);}});
 try{
  await poll(coverage.BASELINE,'quanto vendemos em março de 2020?');
  assert.equal(reads.length,0);                 // not verified: no query, no number
  await poll(JSON.parse(JSON.stringify(real)),'quanto vendemos em março de 2015?');
  assert.equal(reads.length,0);                 // a gap: no query, no zero
  assert.doesNotMatch(sent.join('\n'),/R\$|: 0\b/);
  await poll(JSON.parse(JSON.stringify(real)),'quanto vendemos em março de 2020?');
  assert.equal(reads.length,1);
  assert.equal(reads[0].plan.period,'2020-03');
  assert.equal(reads[0].coverage.commercial.runs[0].first,'2011-04');
  assert.match(sent.at(-1),/Período: 2020-03/);
  await assert.rejects(runner.pollOnce({stateDir:state,clock:()=>NOW,liveEnabled:true,query:async()=>{},
   historyCoverage:{origin:'source',read_at:new Date(NOW).toISOString(),commercial:{runs:[]}},api:async()=>[]}),/coverage_/);
 }finally{fs.rmSync(state,{recursive:true,force:true})}
});
test('the coverage query lists every store and month held, not MIN/MAX',()=>{
 assert.match(analyst.SQL.coverage,/^SELECT 'commercial' AS scope,raw_store,month,MAX\(last_day\) AS last_day FROM hermes_history\.monthly_commercial_2025_2026_v1 WHERE month IS NOT NULL GROUP BY raw_store,month UNION ALL SELECT 'products',NULL,month,NULL FROM hermes_history\.monthly_product_activity_v1 WHERE month IS NOT NULL GROUP BY month ORDER BY 1,3,2 LIMIT 5000$/);
 assert.doesNotMatch(analyst.SQL.coverage,/MIN\(/);
});
// ── Credit (inadimplência): contract, templates, owner only, awaiting audit ─
const credit=require('../src/runtime/hermes-receivables-templates');
const sellers=require('../src/runtime/hermes-seller-templates');
const creditSources={position:'hermes_history.receivables_position_v1',recovery:'hermes_history.receivables_recovery_v1'};
const sellerView='hermes_history.monthly_seller_activity_v1';
test('credit questions plan deterministic templates and never reach a person',()=>{
 const plan=q=>credit.planQuestion(q,NOW);
 assert.deepEqual({...plan('qual a inadimplência?')},{tenant_id:'grupo_erick',template:'portfolio',period:null,store:null});
 assert.equal(plan('carteira vencida da loja MAGAZINE').store,'MAGAZINE');
 assert.equal(plan('faixas de atraso da carteira').template,'portfolio');
 assert.equal(plan('concentração da inadimplência por loja').template,'stores');
 assert.deepEqual({...plan('recuperação de crédito em maio de 2019')},{tenant_id:'grupo_erick',template:'recovery',period:'2019-05',store:null});
 assert.equal(plan('quanto recuperamos em 2025?').period,'2025');
 assert.equal(plan('recuperação em maio').period,'2026-05');
 assert.equal(credit.planQuestion('recuperação em dezembro',Date.parse('2026-06-10T12:00:00Z')).period,'2025-12');
 for(const q of ['quais clientes estão inadimplentes?','CPF dos devedores vencidos','telefone de quem está em atraso',
  'mande mensagem de cobrança para os atrasados','duplicatas vencidas das compras','situação do LotoIA vencida',
  'recuperação em 2019 e 2020','/inadimplencia'])
  assert.equal(plan(q),null,q);
 // Receipts coverage is not the sales coverage: a recovery period is only
 // checked for shape here; its coverage comes back with the answer.
 assert.doesNotThrow(()=>credit.validate({tenant_id:'grupo_erick',template:'recovery',period:'2015-05',store:null}));
 assert.throws(()=>credit.validate({tenant_id:'grupo_erick',template:'stores',period:null,store:'MAGAZINE'}),/credit_plan_denied/);
 assert.throws(()=>credit.validate({tenant_id:'outro',template:'portfolio',period:null,store:null}),/credit_plan_denied/);
});
test('credit views are allow-listed configuration; without them every template fails closed',async()=>{
 assert.deepEqual({...credit.sourcesFromEnv({})},{position:null,recovery:null});
 assert.deepEqual({...credit.sourcesFromEnv({HERMES_HISTORY_RECEIVABLES_POSITION_VIEW:creditSources.position,
  HERMES_HISTORY_RECEIVABLES_RECOVERY_VIEW:creditSources.recovery})},creditSources);
 for(const bad of ['public.vw_inadimplencia_por_faixa','hermes_history.x; drop table y','softcom_import.parcelas',
  'hermes_history.A'])
  assert.throws(()=>credit.sourcesFromEnv({HERMES_HISTORY_RECEIVABLES_POSITION_VIEW:bad}),/credit_source_config_invalid/,bad);
 const plan=credit.planQuestion('qual a inadimplência?');
 let queried=false;
 await assert.rejects(credit.execute({query:async()=>{queried=true}},plan,{sources:{position:null,recovery:null}}),
  /credit_source_awaiting_audit/);
 assert.equal(queried,false);
 // The SQL only reads the latest position, binds every filter and touches no customer column.
 const sql=credit.sqlFor('portfolio',creditSources);
 assert.match(sql,/WHERE as_of_day=\(SELECT MAX\(as_of_day\) FROM hermes_history\.receivables_position_v1\) AND \(\$1::text IS NULL OR raw_store=\$1::text\)/);
 for(const t of ['portfolio','stores','recovery'])
  assert.doesNotMatch(credit.sqlFor(t,creditSources),/cliente|cpf|cnpj|nome|softcom_import|select \*/i);
});
test('credit answers show source, position date, bands, risk, concentration and limits',async()=>{
 const at=()=>new Date(NOW);
 const plan=credit.planQuestion('qual a inadimplência da loja MAGAZINE?');
 const data=await credit.execute({query:async q=>{
  assert.deepEqual(q.values,['MAGAZINE']);
  return {rows:[{aging_bucket:'a_vencer',installments:'10',open_amount:'1000.00',as_of_day:'2026-11-24'},
   {aging_bucket:'1_30',installments:'4',open_amount:'200.00',as_of_day:'2026-11-24'},
   {aging_bucket:'91_180',installments:'2',open_amount:'300.00',as_of_day:'2026-11-24'}]};}},
  plan,{sources:creditSources,now:at});
 const txt=credit.reply(data,plan,{sources:creditSources});
 assert.match(txt,/^💳 Hermes — crédito e inadimplência Grupo Erick\nFonte: Supabase \/ hermes_history\.receivables_position_v1/);
 assert.match(txt,/Posição da carteira: Dados até 24\/11\/2026 \(ontem\)/);
 assert.match(txt,/• Carteira em aberto: R\$\s?1\.500,00/);
 assert.match(txt,/• Vencida: R\$\s?500,00 \(33,3% da carteira\)/);
 assert.match(txt,/– 1 a 30 dias: R\$\s?200,00 \(4 parcelas; 40,0% da vencida\)/);
 assert.match(txt,/• Risco: vencida há mais de 90 dias R\$\s?300,00 \(60,0% da vencida\)/);
 assert.match(txt,/sem dados de clientes; não conciliados com o ERP\/Linx/);
 assert.match(txt,/Atraso não é perda contábil: não é provisão para perdas nem previsão de recebimento/);
 assert.match(txt,/saldo na data da posição \(histórico da fonte, não saldo atual\)/);
 // Concentration by store.
 const stores=credit.planQuestion('concentração da inadimplência por loja');
 const ranked=credit.reply({tenant_id:'grupo_erick',mode:'online_aggregate',domain:'credit',source:creditSources.position,
  at:new Date(NOW).toISOString(),plan:stores,rows:[
   {label:'CALCADOS',overdue:80,over90:80,overdue_installments:1,open:130,as_of_day:'2026-11-24'},
   {label:'MAGAZINE',overdue:500,over90:300,overdue_installments:6,open:1500,as_of_day:'2026-11-24'}]},stores,{sources:creditSources});
 assert.ok(ranked.indexOf('• MAGAZINE')<ranked.indexOf('• CALCADOS'));
 assert.match(ranked,/• MAGAZINE: R\$\s?500,00 vencido \(86,2% do grupo; 60,0% há mais de 90 dias\)/);
 assert.match(ranked,/Maior concentração: MAGAZINE com 86,2% da carteira vencida/);
 // Recovery, with its own receipts coverage.
 const rec=credit.planQuestion('recuperação de crédito em maio de 2026');
 const recovered=await credit.execute({query:async q=>{assert.deepEqual(q.values,['2026-05',null]);
  return {rows:[{covered_months:['2026-05'],installments:'4',amount:'170.00',last_day:'2026-05-30',
   receipts_last_day:'2026-05-30',source_last_day:'2026-05-30'}]};}},rec,{sources:creditSources,now:at});
 const rtxt=credit.reply(recovered,rec,{sources:creditSources});
 assert.match(rtxt,/Fonte: Supabase \/ hermes_history\.receivables_recovery_v1/);
 assert.match(rtxt,/Recebimentos: ⚠️ Dados até 30\/05\/2026/);
 assert.match(rtxt,/• Recuperado \(parcelas vencidas recebidas\): R\$\s?170,00 em 4 parcelas/);
 assert.match(rtxt,/maio\/2026 é parcial: recebimentos só até 30\/05\/2026/);
 assert.match(rtxt,/Taxa de recuperação não calculada/);
 // A covered month with nothing recovered is a real zero...
 const zero=await credit.execute({query:async()=>({rows:[{covered_months:['2026-05'],installments:'0',amount:'0.00',
  last_day:null,receipts_last_day:'2026-05-31',source_last_day:'2026-06-08'}]})},rec,{sources:creditSources,now:at});
 assert.match(credit.reply(zero,rec,{sources:creditSources}),/R\$\s?0,00 em 0 parcelas/);
 // ...but no receipts coverage is never reported as zero.
 const uncovered=await credit.execute({query:async()=>({rows:[{covered_months:[],installments:'0',amount:'0.00',
  last_day:null,receipts_last_day:null,source_last_day:'2026-06-08'}]})},
  credit.planQuestion('recuperação de crédito em março de 2015',NOW),{sources:creditSources,now:at});
 const utxt=credit.reply(uncovered,credit.planQuestion('recuperação de crédito em março de 2015',NOW),{sources:creditSources});
 assert.match(utxt,/Sem cobertura de recebimentos na fonte para este período: isso não significa recuperação zero/);
 assert.doesNotMatch(utxt,/R\$\s?0,00/);
 // A year with receipts only in some months says so.
 const yr=credit.planQuestion('quanto recuperamos em 2019?',NOW);
 const partYear=await credit.execute({query:async()=>({rows:[{covered_months:['2019-07','2019-08','2019-09','2019-10','2019-11','2019-12'],
  installments:'40',amount:'4000.00',last_day:'2019-12-30',receipts_last_day:'2019-12-30',source_last_day:'2026-06-08'}]})},
  yr,{sources:creditSources,now:at});
 // A past month whose last receipt is the 30th is not partial: the data goes on.
 assert.doesNotMatch(credit.reply(partYear,yr,{sources:creditSources}),/dezembro\/2019 é parcial/);
 assert.match(credit.reply(partYear,yr,{sources:creditSources}),
  /Recebimentos registrados só em julho a dezembro de 2019; meses sem registro não significam recuperação zero/);
 // A view that reports money without any covered month broke its contract.
 await assert.rejects(credit.execute({query:async()=>({rows:[{covered_months:[],installments:'1',amount:'10.00',last_day:null,
  receipts_last_day:null,source_last_day:'2026-06-08'}]})},rec,{sources:creditSources,now:at}),/credit_totals_inconsistent/);
 assert.match(credit.sqlFor('recovery',creditSources),/^SELECT ARRAY\(SELECT DISTINCT r\.month FROM hermes_history\.receivables_recovery_v1 r WHERE .* AS covered_months,/);
 assert.match(credit.sqlFor('recovery',creditSources),/\(SELECT MAX\(receipts_last_day\) FROM hermes_history\.receivables_recovery_v1\) AS source_last_day/);
 // A store missing from the position is never shown as a clean portfolio.
 const none=credit.reply({...data,rows:[]},plan,{sources:creditSources});
 assert.match(none,/confirme se a loja está incluída antes de concluir que não há inadimplência/);
 // Tampered or foreign evidence is refused.
 for(const bad of [{...data,source:'public.vw_inadimplencia_por_faixa'},{...data,domain:'sales'},
  {...data,rows:[...data.rows,data.rows[0]]},{...data,rows:[{...data.rows[0],amount:-1}]},
  {...data,rows:[data.rows[0],{...data.rows[1],as_of_day:'2026-11-20'}]}])
  assert.throws(()=>credit.reply(bad,plan,{sources:creditSources}),/credit_reply_denied|credit_mixed_positions/);
 await assert.rejects(credit.execute({query:async()=>({rows:[{label:'CALCADOS',overdue_amount:'90',over90_amount:'100',
  overdue_installments:'1',open_amount:'130',as_of_day:'2026-11-24'}]})},stores,{sources:creditSources,now:at}),/credit_totals_inconsistent/);
});

// ── Seller ranking: reuses the analyst metrics, owner only ──────────────
test('seller rankings reuse periods and metrics, rank by the asked metric and need a configured view',async()=>{
 const plan=sellers.planQuestion('quais os melhores vendedores de maio de 2026?');
 assert.deepEqual({...plan},{tenant_id:'grupo_erick',template:'sellers',period:'2026-05',metric:'records',store:null});
 assert.equal(sellers.planQuestion('ranking de vendedores por ticket médio em 2019',since2011).metric,'ticket');
 assert.equal(sellers.planQuestion('ranking de vendedores por ticket médio em 2019'),null); // not verified yet
 assert.equal(sellers.planQuestion('qual vendedor faturou mais na loja MAGAZINE em março de 2026').store,'MAGAZINE');
 for(const q of ['telefone dos vendedores','salário dos vendedores em maio de 2026','comissão dos vendedores em maio de 2026'])
  assert.equal(sellers.planQuestion(q),null,q);
 assert.equal(sellers.sourceFromEnv({}),null);
 assert.throws(()=>sellers.sourceFromEnv({HERMES_HISTORY_SELLER_VIEW:'public.vw_itens_vendidos'}),/seller_source_config_invalid/);
 await assert.rejects(sellers.execute({query:async()=>{throw Error('MUST_NOT_QUERY')}},plan,{relation:null}),/seller_source_awaiting_audit/);
 // Seller identity is per store until validated: never merged across stores.
 assert.match(sellers.sqlFor('ticket',sellerView),/GROUP BY raw_store,seller_code HAVING SUM\(noncancelled\)>=10 ORDER BY SUM\(valor_pago_noncancelled_sum\)\/NULLIF\(SUM\(noncancelled\),0\) DESC NULLS LAST,raw_store ASC,seller_code ASC LIMIT 10$/);
 assert.match(sellers.sqlFor('records',sellerView),/GROUP BY raw_store,seller_code ORDER BY SUM\(noncancelled\) DESC,raw_store ASC,seller_code ASC LIMIT 10$/);
 const money=sellers.planQuestion('quais vendedores faturaram mais em maio de 2026?');
 const data=await sellers.execute({query:async q=>{assert.deepEqual(q.values,['2026-05',null]);return {rows:[
  {raw_store:'MAGAZINE',seller_code:'V1',seller_label:'ANA',records:'30',cancelled:'2',noncancelled:'28',amount:'2800.00',last_day:'2026-05-31',source_last_day:'2026-06-08'},
  {raw_store:'MAGAZINE',seller_code:'V2',seller_label:'BIA',records:'12',cancelled:'0',noncancelled:'12',amount:'2400.00',last_day:'2026-05-31',source_last_day:'2026-06-08'},
  {raw_store:'CALCADOS',seller_code:'V1',seller_label:'ANA',records:'5',cancelled:'0',noncancelled:'5',amount:'700.00',last_day:'2026-05-30',source_last_day:'2026-06-08'}]};}},
  money,{relation:sellerView,now:()=>new Date(NOW)});
 const txt=sellers.reply(data,money,{relation:sellerView});
 assert.match(txt,/^🏅 Hermes — ranking de vendedores Grupo Erick\nFonte: Supabase \/ hermes_history\.monthly_seller_activity_v1/);
 assert.match(txt,/⚠️ Dados até 08\/06\/2026/);
 assert.match(txt,/1\. ANA \(cód\. V1, MAGAZINE\): R\$\s?2\.800,00 em 28 vendas não canceladas/);
 // The same code in another store is another line, not a merged seller.
 assert.match(txt,/3\. ANA \(cód\. V1, CALCADOS\): R\$\s?700,00 em 5 vendas não canceladas/);
 assert.match(txt,/Vendedor identificado por loja/);
 assert.throws(()=>sellers.reply({...data,rows:[...data.rows,data.rows[0]]},money,{relation:sellerView}),/seller_reply_denied/);
 // A store-filtered ranking only shows that store.
 const one=sellers.planQuestion('melhores vendedores da loja MAGAZINE em maio de 2026');
 assert.throws(()=>sellers.reply({...data,plan:one},one,{relation:sellerView}),/seller_reply_denied/);
 assert.match(txt,/não é faturamento líquido nem base de comissão/);
 assert.match(txt,/Dados de vendedores visíveis só ao dono/);
 assert.throws(()=>sellers.reply({...data,source:'public.vw_itens_vendidos'},money,{relation:sellerView}),/seller_reply_denied/);
 await assert.rejects(sellers.execute({query:async()=>({rows:[{raw_store:'MAGAZINE',seller_code:'V1;drop',seller_label:'ANA',records:'1',
  cancelled:'0',noncancelled:'1',amount:'1',last_day:null}]})},money,{relation:sellerView}),/seller_row_denied/);
});

// ── Channel: owner only, awaiting source, before the AI agent ────────────
test('credit and seller questions are owner only, refused until configured and never sent to the AI agent',async()=>{
 const sent=[],reads=[];
 const base={ownerId:700,memberIds:[800],clock:()=>NOW,query:async()=>{},agentEnabled:true,
  send:async(id,text)=>sent.push(text),
  readAgent:async()=>{throw Error('AGENT_MUST_NOT_RUN')},
  readCredit:async plan=>{reads.push(plan);return {tenant_id:'grupo_erick',mode:'online_aggregate',domain:'credit',
   source:creditSources.position,at:new Date(NOW).toISOString(),plan,
   rows:[{bucket:'1_30',installments:2,amount:100,as_of_day:'2026-11-24'}]};}};
 let id=900000;
 const ask=(userId,text,extra={})=>core.processUpdate({...base,...extra,update:update(id++,userId,text)});
 // Member: refused, nothing read.
 assert.equal((await ask(800,'analise a inadimplência e recomende ações',{creditSources})).intent,'access_owner_only');
 assert.equal((await ask(800,'melhores vendedores de maio de 2026',{sellerSource:sellerView})).intent,'access_owner_only');
 assert.match(sent.at(-1),/visíveis somente ao dono/);
 // Owner without configured views: honest refusal, no query, no model.
 const waiting=await ask(700,'analise a inadimplência e recomende ações');
 assert.equal(waiting.intent,'business_credit_awaiting_source');
 assert.match(sent.at(-1),/aguarda a auditoria do banco das lojas.*Nenhum número foi estimado/);
 assert.equal((await ask(700,'melhores vendedores de maio de 2026')).intent,'business_sellers_awaiting_source');
 assert.equal(reads.length,0);
 // Owner with the view: deterministic answer, still no model call.
 const answered=await ask(700,'analise a inadimplência e recomende ações',{creditSources});
 assert.equal(answered.intent,'business_credit');
 assert.equal(reads.length,1);
 assert.match(sent.at(-1),/💳 Hermes — crédito e inadimplência/);
 // Payables keep the Compras route.
 assert.equal(core.intentFor('resumo das compras vencidas'),'compras');
});
test('runner reads credit through the history quota with the configured views only',async()=>{
 const state=dir();
 runner.saveState(state,'owner.json',{owner_id:700});
 const reads=[],sent=[];
 try{
  await runner.pollOnce({stateDir:state,clock:()=>NOW,liveEnabled:true,creditSources,
   query:async()=>{throw Error('OTHER')},
   readLive:async arg=>{reads.push(arg);return {tenant_id:'grupo_erick',mode:'online_aggregate',domain:'credit',
    source:creditSources.position,at:new Date(NOW).toISOString(),plan:arg.plan,
    rows:[{bucket:'a_vencer',installments:1,amount:50,as_of_day:'2026-11-24'}]};},
   api:async(m,p)=>{if(m==='getUpdates')return [update(910001,700,'qual a inadimplência?')];if(m==='sendMessage')sent.push(p.text);}});
  assert.equal(reads.length,1);assert.equal(reads[0].shape,'credit');
  assert.deepEqual({...reads[0].plan},{tenant_id:'grupo_erick',template:'portfolio',period:null,store:null});
  assert.equal(runner.loadState(state,'history-live-budget.json').count,1);
  assert.match(sent[0],/Carteira em aberto: R\$\s?50,00/);
  const audit=fs.readFileSync(path.join(state,'audit.jsonl'),'utf8');
  assert.doesNotMatch(audit,/inadimpl|50,00/);
 }finally{fs.rmSync(state,{recursive:true,force:true})}
});

// ── Security: the old public views are never a Hermes source ────────────
test('public views exposed to anon/authenticated are refused as sources and unused by the bot',()=>{
 // Confirmed by the Supabase audit: GRANT SELECT to anon and authenticated.
 const exposed=['public.vw_contas_a_receber','public.vw_faturamento_mensal',
  'public.vw_inadimplencia_por_faixa','public.vw_itens_vendidos'];
 for(const view of exposed){
  for(const name of ['HERMES_HISTORY_RECEIVABLES_POSITION_VIEW','HERMES_HISTORY_RECEIVABLES_RECOVERY_VIEW'])
   assert.throws(()=>credit.sourcesFromEnv({[name]:view}),/credit_source_config_invalid/,view);
  assert.throws(()=>sellers.sourceFromEnv({HERMES_HISTORY_SELLER_VIEW:view}),/seller_source_config_invalid/,view);
  // Source tables are not sources either: only the private hermes_history schema.
  assert.throws(()=>sellers.sourceFromEnv({HERMES_HISTORY_SELLER_VIEW:'softcom_import.cadastro_de_vendas'}),/seller_source_config_invalid/);
 }
 const roots=[path.join(__dirname,'..','src','runtime'),path.join(__dirname,'..','scripts')];
 const offenders=[];
 for(const root of roots)for(const name of fs.readdirSync(root)){
  if(!name.endsWith('.js'))continue;
  const text=fs.readFileSync(path.join(root,name),'utf8');
  if(/public\.vw_|vw_(contas_a_receber|faturamento_mensal|inadimplencia_por_faixa|itens_vendidos)/.test(text))offenders.push(name);
 }
 assert.deepEqual(offenders,[]);
 // Every SQL the bot runs reads hermes_history only.
 for(const t of ['period','compare','stores','products','coverage'])
  assert.doesNotMatch(analyst.SQL[t],/\b(public|softcom_import)\./);
});
