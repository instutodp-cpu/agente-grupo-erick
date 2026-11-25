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
// A source that holds sales since March 2011 (what the audited view should give).
const since2011=coverage.fromRows([
 {scope:'commercial',first_month:'2011-03',last_month:'2026-06',last_day:'2026-06-08'},
 {scope:'products',first_month:'2018-01',last_month:'2026-06',last_day:null}],NOW);
const evidence=(plan,rows,extra={})=>({tenant_id:'grupo_erick',mode:'online_aggregate',
 source:analyst.SOURCE,at:new Date(NOW).toISOString(),plan,rows,...extra});
const row=(o)=>({records:100,cancelled:10,amount:9000,last_day:'2026-05-31',source_last_day:'2026-06-08',...o});

// ── Coverage: read from the source, validated, fail closed ──────────────
test('coverage readings are validated; the verified baseline applies otherwise',()=>{
 assert.equal(since2011.origin,'source');
 assert.equal(since2011.commercial.first_month,'2011-03');
 assert.equal(coverage.validate(JSON.parse(JSON.stringify(since2011)),NOW).commercial.last_day,'2026-06-08');
 const bad=[
  [{scope:'commercial',first_month:'2026-07',last_month:'2026-06',last_day:'2026-06-08'}],          // inverted
  [{scope:'commercial',first_month:'2011-01',last_month:'2027-01',last_day:'2027-01-02'}],          // future
  [{scope:'commercial',first_month:'2011-01',last_month:'2026-06',last_day:'2026-07-01'}],          // day outside month
  [{scope:'commercial',first_month:'2011-01',last_month:'2026-06',last_day:null}],                  // no last day
  [{scope:'commercial',first_month:'1999-12',last_month:'2026-06',last_day:'2026-06-08'}],          // before 2000
  [{scope:'commercial',first_month:'2011-1',last_month:'2026-06',last_day:'2026-06-08'}]];          // malformed
 for(const commercial of bad)
  assert.throws(()=>coverage.fromRows([...commercial,
   {scope:'products',first_month:'2026-01',last_month:'2026-06',last_day:null}],NOW),/coverage_/);
 assert.throws(()=>coverage.fromRows([{scope:'commercial',first_month:'2011-01',last_month:'2026-06',
  last_day:'2026-06-08'}],NOW),/coverage_rows_invalid/);
 assert.throws(()=>coverage.validate({origin:'forged'},NOW),/coverage_invalid/);
 // Baseline = what was verified before week 4: 2025-01..2026-06, products 2026.
 assert.deepEqual({...coverage.BASELINE.commercial},{first_month:'2025-01',last_month:'2026-06',last_day:'2026-06-08'});
});
test('complete months and year windows follow the source last day, not a fixed calendar',()=>{
 const c=since2011.commercial;
 assert.deepEqual(coverage.completeMonths(c,'2011'),{from:3,to:12});   // starts in March
 assert.deepEqual(coverage.completeMonths(c,'2026'),{from:1,to:5});    // June has only 8 days
 assert.deepEqual(coverage.yearWindow(c,'2011','2012'),{from:'03',to:'12'});
 assert.deepEqual(coverage.yearWindow(c,'2019','2020'),{from:'01',to:'12'});
 assert.deepEqual(coverage.yearWindow(c,'2025','2026'),{from:'01',to:'05'});
 const closedJune={...c,last_day:'2026-06-30'};
 assert.deepEqual(coverage.yearWindow(closedJune,'2025','2026'),{from:'01',to:'06'});
 assert.equal(coverage.isPartial(c,'2026-06'),true);
 assert.equal(coverage.isPartial(closedJune,'2026-06'),false);
 assert.equal(coverage.yearForMonth(c,'07'),'2025');   // "julho" = the latest July held
 assert.equal(coverage.yearForMonth(c,'03'),'2026');
 assert.equal(coverage.windowText({from:'01',to:'05'}),'janeiro a maio');
});
test('the analyst accepts every period the source holds, since 2011, and nothing else',()=>{
 const p=analyst.planQuestion('quanto vendemos em março de 2015?',null,since2011);
 assert.deepEqual({...p},{tenant_id:'grupo_erick',template:'period',period:'2015-03',other_period:null,metric:'money',store:null});
 assert.equal(analyst.planQuestion('quanto vendemos em março de 2015?'),null); // baseline: not verified yet
 assert.equal(analyst.planQuestion('quanto vendemos em março de 2010?',null,since2011),null);
 assert.equal(analyst.planQuestion('quanto vendemos em fevereiro de 2011?',null,since2011),null); // before first month
 assert.equal(analyst.planQuestion('vendas de julho',null,since2011).period,'2025-07');
 const cmp=analyst.planQuestion('compare as vendas de 2012 e 2011',null,since2011);
 assert.equal(cmp.template,'compare');assert.equal(cmp.period,'2012');assert.equal(cmp.other_period,'2011');
 // compare a single month: the same month one year earlier.
 const one=analyst.planQuestion('compare as vendas de abril de 2014',null,since2011);
 assert.deepEqual([one.period,one.other_period],['2013-04','2014-04']);
 assert.throws(()=>analyst.validate({...p,period:'2010-12'},since2011),/analyst_period_not_covered/);
 assert.throws(()=>analyst.validate({tenant_id:'grupo_erick',template:'compare',period:'2025-06',
  other_period:'2026-06',metric:'records',store:null},since2011),/analyst_partial_month_comparison_denied/);
 assert.throws(()=>analyst.validate({tenant_id:'grupo_erick',template:'products',period:'2017-05',
  other_period:null,metric:'records',store:null},since2011),/analyst_products_denied/);
 assert.doesNotThrow(()=>analyst.validate({tenant_id:'grupo_erick',template:'products',period:'2019-05',
  other_period:null,metric:'records',store:null},since2011));
});
test('year comparisons bind the complete-month window and say which months were compared',async()=>{
 const p={tenant_id:'grupo_erick',template:'compare',period:'2011',other_period:'2012',metric:'records',store:null};
 let sent;
 const data=await analyst.execute({query:async q=>{sent=q;return {rows:[
  {label:'2011',records:'900',cancelled:'9',noncancelled:'891',amount:'1000.00',last_day:'2011-12-31',source_last_day:'2026-06-08'},
  {label:'2012',records:'1000',cancelled:'10',noncancelled:'990',amount:'1100.00',last_day:'2012-12-31',source_last_day:'2026-06-08'}]};}},
  p,()=>new Date(NOW),since2011);
 assert.deepEqual(sent.values,['2011','2012',null,'03','12']);
 assert.deepEqual(data.window,{from:'03',to:'12'});
 const txt=analyst.reply(data,p,since2011);
 assert.match(txt,/📅 Cobertura equivalente: março a dezembro de cada ano \(meses completos\)/);
 assert.match(txt,/• 2011 \(março a dezembro\): 900/);
 assert.match(txt,/a comparação usa apenas março a dezembro completos nos dois anos/);
 // A year comparison without its window, or a month comparison with one, is refused.
 assert.throws(()=>analyst.reply({...data,window:undefined},p,since2011),/analyst_reply_denied/);
 assert.throws(()=>analyst.reply({...data,window:{from:'05',to:'03'}},p,since2011),/analyst_reply_denied/);
 const month={...p,period:'2019-03',other_period:'2020-03'};
 assert.throws(()=>analyst.reply({...data,plan:month,rows:[{...data.rows[0],label:'2019-03'},
  {...data.rows[1],label:'2020-03'}]},month,since2011),/analyst_reply_denied/);
 // The SQL holds no calendar: the window is bound as $4/$5.
 assert.match(analyst.SQL.compare,/BETWEEN \$4::text AND \$5::text/);
 assert.doesNotMatch(analyst.SQL.compare,/'0[1-9]'|'1[0-2]'/);
});
test('partial periods are flagged from the source own last day',()=>{
 const year={tenant_id:'grupo_erick',template:'period',period:'2026',other_period:null,metric:'records',store:null};
 assert.match(analyst.reply(evidence(year,[row({})]),year),/⚠️ 2026 é parcial: dados só até 08\/06\/2026\./);
 const june={...year,period:'2026-06'};
 assert.match(analyst.reply(evidence(june,[row({last_day:'2026-06-08'})]),june),/⚠️ junho\/2026 é parcial: dados só até 08\/06\/2026\./);
 const march={...year,period:'2026-03'};
 assert.doesNotMatch(analyst.reply(evidence(march,[row({last_day:'2026-03-31'})]),march),/parcial/);
 // Without the source day (older evidence), the verified coverage still warns.
 assert.match(analyst.reply(evidence(june,[row({last_day:'2026-06-08',source_last_day:undefined})]),june),/junho\/2026 é parcial/);
});
test('the agent planner is told the coverage read from the source and validates against it',()=>{
 const prompt=agent.planPrompt(since2011);
 assert.match(prompt,/period AAAA-MM de 2011-03 a 2026-06 ou ano AAAA de 2011 a 2026/);
 assert.match(prompt,/Histórico de vendas: março\/2011 a junho\/2026 \(dados até 08\/06\/2026\)/);
 assert.doesNotMatch(prompt,/2025-01\.\.2025-12|Produtos só 2026|oito dias/);
 const plan={steps:[{tool:'history',params:{tenant_id:'grupo_erick',template:'compare',period:'2014',
  other_period:'2015',metric:'records',store:null}}]};
 assert.equal(agent.validateToolPlan(plan,since2011).length,1);
 assert.throws(()=>agent.validateToolPlan(plan),/analyst_period_not_covered/);
 // Two separate annual totals still cannot replace one window-bound comparison.
 assert.throws(()=>agent.validateToolPlan({steps:[2014,2015].map(y=>({tool:'history',params:{tenant_id:'grupo_erick',
  template:'period',period:String(y),other_period:null,metric:'records',store:null}}))},since2011),
  /agent_unmatched_year_coverage_denied/);
});
test('the cancellation-rate route follows the coverage and the named month range',()=>{
 const plan=core.cancellationRatePlan('Compare as taxas de cancelamento de janeiro a dezembro de 2019 e 2020',since2011);
 assert.deepEqual({...plan},{tenant_id:'grupo_erick',template:'compare',period:'2019',other_period:'2020',
  metric:'cancelled',store:null});
 assert.equal(core.cancellationRatePlan('Compare as taxas de cancelamento de janeiro a dezembro de 2019 e 2020'),null);
 assert.equal(core.cancellationRatePlan('Compare as taxas de cancelamento de janeiro a maio de 2019 e 2020',since2011),null);
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
 const readLive=async q=>{reads++;assert.equal(q.shape,'coverage');
  if(fail)throw Error('db_down');return [
   {scope:'commercial',first_month:'2011-03',last_month:'2026-06',last_day:'2026-06-08'},
   {scope:'products',first_month:'2018-01',last_month:'2026-06',last_day:null}];};
 const keeper=runner.createCoverageKeeper({stateDir:state,liveEnabled:true,clock:()=>clock,
  readLive:async q=>coverage.fromRows(await readLive(q),clock)});
 try{
  assert.equal((await keeper.current()).commercial.first_month,'2011-03');
  assert.equal(reads,1);
  clock+=3600000;await keeper.current();assert.equal(reads,1);     // same day: stored reading
  assert.equal(runner.loadState(state,'history-live-budget.json'),null); // never the question quota
  fail=true;clock+=24*3600000;
  assert.equal((await keeper.current()).commercial.first_month,'2011-03'); // failed refresh keeps it
  assert.equal(reads,2);
  clock+=3600000;await keeper.current();assert.equal(reads,2);     // retry only after 6 h
  clock+=6*3600000;await keeper.current();assert.equal(reads,3);
  clock=NOW+8*24*3600000;                                           // stored reading too old
  assert.equal(await keeper.current(),coverage.BASELINE);
  const audit=fs.readFileSync(path.join(state,'audit.jsonl'),'utf8');
  assert.match(audit,/"event":"history_coverage","first_month":"2011-03","last_month":"2026-06"/);
  assert.match(audit,/"event":"history_coverage","status":"failed"/);
  // Disabled live history never reads.
  const off=runner.createCoverageKeeper({stateDir:dir(),liveEnabled:false,clock:()=>NOW,
   readLive:async()=>{throw Error('MUST_NOT_READ')}});
  assert.equal(await off.current(),coverage.BASELINE);
 }finally{fs.rmSync(state,{recursive:true,force:true})}
});
test('a question about 2015 is answered once the source coverage includes it',async()=>{
 const state=dir();
 runner.saveState(state,'owner.json',{owner_id:700});
 const sent=[],reads=[];
 const poll=historyCoverage=>runner.pollOnce({stateDir:state,clock:()=>NOW,liveEnabled:true,historyCoverage,
  query:async()=>{throw Error('OTHER_DOMAIN')},
  readLive:async arg=>{reads.push(arg);return evidence(arg.plan,[row({last_day:'2015-03-31'})]);},
  api:async(m,p)=>{if(m==='getUpdates')return [update(700000+reads.length+sent.length,700,'quanto vendemos em março de 2015?')];
   if(m==='sendMessage')sent.push(p.text);}});
 try{
  await poll(coverage.BASELINE);
  assert.equal(reads.length,0);                 // not verified: no query, no number
  assert.doesNotMatch(sent[0],/R\$/);
  await poll(JSON.parse(JSON.stringify(since2011)));
  assert.equal(reads.length,1);
  assert.equal(reads[0].plan.period,'2015-03');
  assert.equal(reads[0].coverage.commercial.first_month,'2011-03');
  assert.match(sent[1],/Período: 2015-03/);
  await assert.rejects(runner.pollOnce({stateDir:state,clock:()=>NOW,liveEnabled:true,query:async()=>{},
   historyCoverage:{origin:'source',commercial:{first_month:'1990-01'}},api:async()=>[]}),/coverage_/);
 }finally{fs.rmSync(state,{recursive:true,force:true})}
});
test('the coverage query reads only MIN/MAX of the approved views',()=>{
 assert.match(analyst.SQL.coverage,/^SELECT 'commercial' AS scope,MIN\(month\) AS first_month,MAX\(month\) AS last_month,MAX\(last_day\) AS last_day FROM hermes_history\.monthly_commercial_2025_2026_v1 UNION ALL SELECT 'products',MIN\(month\),MAX\(month\),NULL FROM hermes_history\.monthly_product_activity_v1$/);
});
