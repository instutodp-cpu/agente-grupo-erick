'use strict';
// Governed, reusable business query templates. Text never reaches SQL.
const freshness=require('./hermes-data-freshness');
const coverage=require('./hermes-history-coverage');
const TENANT='grupo_erick';
const SOURCE='hermes_history.monthly_commercial_2025_2026_v1';
const PRODUCT_SOURCE='hermes_history.monthly_product_activity_v1';
const COMMERCIAL_V2_SOURCE='hermes_history.monthly_commercial_v2';
const RELATION=/^hermes_history\\.[a-z][a-z0-9_]{2,62}$/;
const COMMERCIAL_SOURCES=Object.freeze([SOURCE,COMMERCIAL_V2_SOURCE]);
const PRODUCT_SOURCES=Object.freeze([PRODUCT_SOURCE]);

// Source switches are reviewed, exact allowlisted relations. A commercial
// source switch also switches its evidence-derived cut start; an override
// must match that contract or startup fails closed.
function sourceConfigFromEnv(env=process.env){
 if(!env||typeof env!=='object')throw Error('history_source_config_invalid');
 const commercial=env.HERMES_HISTORY_COMMERCIAL_VIEW==null||env.HERMES_HISTORY_COMMERCIAL_VIEW===''?
  SOURCE:env.HERMES_HISTORY_COMMERCIAL_VIEW;
 const products=env.HERMES_HISTORY_PRODUCT_VIEW==null||env.HERMES_HISTORY_PRODUCT_VIEW===''?
  PRODUCT_SOURCE:env.HERMES_HISTORY_PRODUCT_VIEW;
 if(!RELATION.test(commercial)||!COMMERCIAL_SOURCES.includes(commercial))
  throw Error('history_commercial_source_invalid');
 if(!RELATION.test(products)||!PRODUCT_SOURCES.includes(products))
  throw Error('history_product_source_invalid');
 const commercialCut=commercial===COMMERCIAL_V2_SOURCE?null:'2025-01';
 const requestedCut=env.HERMES_HISTORY_COMMERCIAL_CUT_START;
 if(requestedCut!==undefined&&((requestedCut===''?null:requestedCut)!==commercialCut))
  throw Error('history_cut_start_mismatch');
 return Object.freeze({commercial,products,cutStarts:Object.freeze({
  commercial:commercialCut,products:'2026-01'
 })});
}
const STORES=['CALCADOS','SIRINHAEM','MAGAZINE','SPORTS-(DESATIVADO)','ERICK SPORTS','VARIEDADES'];
const MONTHS={janeiro:1,fevereiro:2,marco:3,abril:4,maio:5,junho:6,julho:7,agosto:8,setembro:9,outubro:10,novembro:11,dezembro:12};
const normalize=t=>t.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const METRICS=['records','cancelled','money','ticket'];
// Period FORMAT (a year or a month, from 2000 on). Whether the source holds
// it is a separate check against the coverage read from the source.
const isPeriodFormat=p=>typeof p==='string'&&(/^20[0-9]{2}$/.test(p)||coverage.validMonth(p));
const sales=(c,store=null)=>coverage.scopeOf(c,'commercial',store);
// The views' first months are cuts of continuous data (per the Supabase
// audit the source table holds sales before 2025-01 and before 2026-01),
// so those first months are complete. A new view must state its own.
const CUT_STARTS=Object.freeze({commercial:'2025-01',products:'2026-01'});
const productScope=c=>coverage.scopeOf(c,'products');
const isPeriod=(p,c)=>isPeriodFormat(p)&&coverage.accepts(sales(c),p);
const YEAR='(20[0-9]{2})';
function periodsOf(text,c){
 const out=[],add=p=>{if(!out.includes(p))out.push(p)};
 for(const x of text.matchAll(new RegExp('\\b'+YEAR+'-(0[1-9]|1[0-2])\\b','g')))add(x[1]+'-'+x[2]);
 for(const x of text.matchAll(new RegExp('\\b(0?[1-9]|1[0-2])\\/'+YEAR+'\\b','g')))add(x[2]+'-'+x[1].padStart(2,'0'));
 for(const x of text.matchAll(new RegExp('\\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\\s+(?:(?:de|do|em)\\s+)?'+YEAR+'\\b','g')))add(x[2]+'-'+String(MONTHS[x[1]]).padStart(2,'0'));
 const m=text.match(/\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/);
 const years=[...new Set([...text.matchAll(/\b20[0-9]{2}\b/g)].map(x=>x[0]))];
 if(m&&years.length===2)for(const y of years)add(y+'-'+String(MONTHS[m[1]]).padStart(2,'0'));
 if(out.length===0&&m&&years.length===1)add(years[0]+'-'+String(MONTHS[m[1]]).padStart(2,'0'));
 if(out.length===0&&years.length===1)add(years[0]);
 if(out.length===0&&m&&years.length===0){
  // No year: the most recent such month the source holds.
  const mm=String(MONTHS[m[1]]).padStart(2,'0'),y=coverage.yearForMonth(sales(c),mm);
  if(y)add(y+'-'+mm);
 }
 if(out.length===0&&years.length===2)for(const y of years)add(y);
 return out;
}
function safeContext(x,c){
 if(!x||x.tenant_id!==TENANT||!['period','compare','stores','products'].includes(x.template)||
  !isPeriod(x.period,c)||!METRICS.includes(x.metric)||
  x.store!=null&&!STORES.includes(x.store))return null;
 if(x.template==='compare'&&(!isPeriod(x.other_period,c)||x.other_period.length!==x.period.length||
   x.other_period===x.period))return null;
 if(x.template!=='compare'&&x.other_period!=null)return null;
 if(x.template==='products'&&(!coverage.accepts(productScope(c),x.period)||x.store||x.metric==='ticket'))return null;
 if(x.template==='stores'&&x.store)return null;
 return {tenant_id:TENANT,template:x.template,period:x.period,other_period:x.other_period||null,
  metric:x.metric,store:x.store||null};
}
function planQuestion(text,context=null,c=coverage.BASELINE){
 if(typeof text!=='string'||text.length>600||text.trim().length<2)return null;
 const q=normalize(text),prior=safeContext(context,c);
 if(/^\/|(\b(cpf|cnpj|senha|token|pix|transferencia|deletar|apagar|publicar|pagar)\b)/.test(q))return null;
 const follow=/^(e\b|mas\b|agora\b|compare\b|comparando\b)/.test(q);
 if(!/\b(venda|vendas|vendeu|vendemos|vendido|vendidos|faturamento|faturou|valor|receita|canceladas|cancelados|loja|lojas|produto|produtos|mercadoria|mercadorias|compare|comparar|comparacao|comparando|diferenca|mais|quanto|quantas|qual|quais|registros|evolucao|cresceu|crescimento|total|ticket)\b/.test(q)&&!(prior&&follow))return null;
 let periods=periodsOf(q,c);
 if(!periods.length&&prior&&follow){
  const named=q.match(/\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/);
  const oldYear=/\b(ano passado|ano anterior)\b/.test(q);
  const year=oldYear?String(Number(prior.period.slice(0,4))-1):prior.period.slice(0,4);
  periods=[named?year+'-'+String(MONTHS[named[1]]).padStart(2,'0'):prior.period];
 }
 if(prior&&follow&&periods.length===1&&periods[0].length===4&&prior.period.length===7)periods=[periods[0]+prior.period.slice(4)];
 if(!periods.length||periods.some(p=>!isPeriod(p,c))||periods.length>2)return null;
 let metric=/\bticket\b/.test(q)?'ticket':/\bcancelad(as|os|a|o)\b/.test(q)?'cancelled':
  /\b(faturamento|faturou|receita|valor|dinheiro|reais)\b|\bquanto\s+(vendeu|vendemos|venderam)\b|\b(vendeu|vendemos)\s+quanto\b/.test(q)?'money':'records';
 if(follow&&prior&&!/\b(cancelad|faturamento|faturou|receita|valor|quanto|registros|quantas|ticket)\b/.test(q))metric=prior.metric;
 const compare=/\b(compare|comparar|comparacao|comparando|diferenca|versus|vs|cresceu|crescimento|evolucao)\b/.test(q);
 if(compare&&periods.length===1&&prior&&prior.period!==periods[0])periods=[prior.period,periods[0]];
 if(compare&&periods.length===1&&periods[0].length===7){
  // "compare março de 2026": the same month one year earlier, if held.
  const before=(Number(periods[0].slice(0,4))-1)+periods[0].slice(4);
  if(isPeriod(before,c))periods=[before,periods[0]];
 }
 const product=/\b(produto|produtos|mercadoria|mercadorias)\b/.test(q);
 const storeWord=/\b(loja|lojas)\b/.test(q);
 const explicitBusinessMetric=/\b(venda|vendas|vendeu|vendemos|vendido|vendidos|faturamento|faturou|valor|receita|canceladas|cancelados|registros|quantas|ticket)\b/.test(q);
 // A dimensionless follow-up inherits the previous subject, not merely its metric.
 const inheritTopic=Boolean(follow&&prior&&!product&&!storeWord&&!explicitBusinessMetric&&
  !/^(compare|comparando)\b/.test(q));
 if(inheritTopic&&prior.template==='compare'&&periods.length===1&&
   periods[0].length===7&&prior.period.length===7&&prior.other_period?.length===7){
  const mm=periods[0].slice(4);
  periods=[prior.period.slice(0,4)+mm,prior.other_period.slice(0,4)+mm];
 }
 const explicitStore=STORES.find(s=>q.includes(normalize(s)))||null;
 const store=explicitStore||(inheritTopic&&prior.template==='period'?prior.store:null);
 const storeRanking=storeWord&&!store&&/\b(qual|quais|mais|maior|ranking|por|cada|melhor|pior)\b/.test(q);
 const template=product?'products':storeRanking?'stores':
  inheritTopic&&['products','stores','compare'].includes(prior.template)?prior.template:
  periods.length===2||compare?'compare':'period';
 if(template==='compare'&&(periods.length!==2||periods[0].length!==periods[1].length||periods[0]===periods[1]))return null;
 if(template==='products'&&(!coverage.accepts(productScope(c),periods[0])||periods.length!==1||store||metric==='ticket'))return null;
 if(template!=='compare'&&periods.length!==1)return null;
 if(storeWord&&!store&&!storeRanking&&/\b(barreiros|erick|sports|magazine|variedades|calcados|sirinhaem)\b/.test(q))return null;
 return Object.freeze({tenant_id:TENANT,template,period:periods[0],other_period:template==='compare'?periods[1]:null,metric,store});
}
// Shape only: what any stored or returned plan must look like.
function validateShape(p){
 if(!p||p.tenant_id!==TENANT||!['period','compare','stores','products'].includes(p.template)||
   !isPeriodFormat(p.period)||!METRICS.includes(p.metric)||
   p.store!=null&&!STORES.includes(p.store))throw Error('analyst_plan_denied');
 if(p.template==='compare'?(!isPeriodFormat(p.other_period)||p.other_period.length!==p.period.length||p.other_period===p.period):p.other_period!=null)throw Error('analyst_comparison_denied');
 if(p.template==='products'&&(p.store||p.metric==='ticket'))throw Error('analyst_products_denied');
 if(p.template==='stores'&&p.store)throw Error('analyst_stores_denied');
 return p;
}
// Shape plus coverage: every period must be held by the source, a partial
// month is never compared as if complete, and year against year needs
// months complete in both years.
function validate(p,c=coverage.BASELINE){
 validateShape(p);
 // A store question follows that store's own coverage.
 const scope=sales(c,p.store);
 if(p.template==='products'){
  if(!coverage.accepts(productScope(c),p.period))throw Error('analyst_products_denied');
  return p;
 }
 if(!coverage.accepts(scope,p.period)||p.template==='compare'&&!coverage.accepts(scope,p.other_period))
  throw Error('analyst_period_not_covered');
 if(p.template==='compare'){
  if(p.period.length===7&&[p.period,p.other_period].some(x=>!coverage.monthComplete(scope,x)))
   throw Error('analyst_partial_month_comparison_denied');
  if(p.period.length===4&&!coverage.yearWindow(scope,p.period,p.other_period))
   throw Error('analyst_year_window_empty');
 }
 return p;
}
const ALL_MONTHS=Object.freeze(['01','02','03','04','05','06','07','08','09','10','11','12']);
function validWindow(w){
 return Boolean(w)&&Object.keys(w).join()==='months'&&Array.isArray(w.months)&&w.months.length>=1&&
  w.months.length<=12&&w.months.every((m,i)=>ALL_MONTHS.includes(m)&&(i===0||m>w.months[i-1]));
}
function compareWindow(p,c){
 return p.template==='compare'&&p.period.length===4?coverage.yearWindow(sales(c,p.store),p.period,p.other_period):null;
}
const matchPeriod='(month=$1::text OR (length($1::text)=4 AND LEFT(month,4)=$1::text))';
// source_last_day is the freshness of the WHOLE view (same view, read-only),
// not of the filtered period: "março/2026" ends on 31/03, the source may not.
function sqlFor(config=sourceConfigFromEnv()){
 const source=config.commercial,productSource=config.products;
 const agg='SUM(registered)::bigint AS records,SUM(cancelled)::bigint AS cancelled,'+
  'SUM(noncancelled)::bigint AS noncancelled,SUM(valor_pago_noncancelled_sum)::numeric(18,2) AS amount,MAX(last_day) AS last_day,'+
  '(SELECT MAX(last_day) FROM '+source+') AS source_last_day';
 const scopeDay=ref=>'(SELECT MAX(s.last_day) FROM '+source+' s WHERE s.raw_store='+ref+') AS scope_last_day';
 return {
  period:'SELECT '+agg+','+scopeDay('$2::text')+' FROM '+source+' WHERE '+matchPeriod+' AND ($2::text IS NULL OR raw_store=$2::text)',
  compare:'SELECT CASE WHEN length($1::text)=4 THEN LEFT(month,4) ELSE month END AS label,'+agg+','+scopeDay('$3::text')+
   ' FROM '+source+' WHERE (month IN ($1::text,$2::text) OR (length($1::text)=4 AND LEFT(month,4) IN ($1::text,$2::text)))'+
   ' AND ($3::text IS NULL OR raw_store=$3::text)'+
   ' AND (length($1::text)<>4 OR RIGHT(month,2)=ANY($4::text[]))'+
   ' GROUP BY 1 ORDER BY 1 LIMIT 2',
  stores:'SELECT o.raw_store AS label,'+agg+','+scopeDay('o.raw_store')+' FROM '+source+' o WHERE '+matchPeriod+' GROUP BY o.raw_store ORDER BY o.raw_store LIMIT 6',
  products:'SELECT product_code,MIN(product_label) AS product_label,SUM(not_marked_cancelled)::bigint AS item_records'+
   ' FROM '+productSource+' WHERE '+matchPeriod+' GROUP BY product_code ORDER BY item_records DESC,product_code ASC LIMIT 5',
  coverage:"SELECT 'commercial' AS scope,raw_store,month,MAX(last_day) AS last_day FROM "+source+
   " WHERE month IS NOT NULL GROUP BY raw_store,month"+
   " UNION ALL SELECT 'products',NULL,month,NULL FROM "+productSource+" WHERE month IS NOT NULL GROUP BY month"+
   " ORDER BY 1,3,2 LIMIT 5000"
 };
}
const SQL=Object.freeze(sqlFor());
function integer(n){
 if(!/^(0|[1-9][0-9]{0,8})$/.test(String(n)))throw Error('analyst_invalid_integer');
 return Number(n);
}
function money(n){
 if(!/^[0-9]{1,13}(\.[0-9]{1,2})?$/.test(String(n)))throw Error('analyst_invalid_amount');
 return Number(n);
}
const validImportedDay=day=>coverage.validDay(day)&&day>=coverage.MIN_MONTH;
function row(r,template){
 if(!r||typeof r!=='object')throw Error('analyst_bad_row');
 if(template==='products'){
  if(!/^[0-9]{1,12}$/.test(r.product_code||'')||typeof r.product_label!=='string'||r.product_label.length>100||
   !/^[\p{L}\p{N} .,:;()\-+\/%ºª°&_']+$/u.test(r.product_label))throw Error('analyst_product_denied');
  return {code:r.product_code,name:r.product_label,items:integer(r.item_records)};
 }
 const o={records:integer(r.records),cancelled:integer(r.cancelled),amount:money(r.amount),last_day:r.last_day};
 if(o.cancelled>o.records||o.last_day!==null&&!validImportedDay(o.last_day))throw Error('analyst_counts_invalid');
 // Every store must reconcile registered = cancelled + noncancelled;
 // a ranking must never display an inconsistent source aggregate.
 if(integer(r.noncancelled)!==o.records-o.cancelled)throw Error('analyst_counts_invalid');
 if(template!=='period'){
  if(template==='stores'?!STORES.includes(r.label):!isPeriodFormat(r.label))throw Error('analyst_label_invalid');
  o.label=r.label;
 }
 for(const key of ['source_last_day','scope_last_day']){
  if(r[key]===undefined)continue;
  if(r[key]!==null&&!freshness.validDay(r[key]))throw Error('analyst_source_day_invalid');
  o[key]=r[key];
 }
 return o;
}
async function execute(client,params,now=()=>new Date(),c=coverage.BASELINE,env=process.env){
 const cfg=sourceConfigFromEnv(env);
 const p=validate(params,c);
 if(typeof client?.query!=='function')throw Error('analyst_no_client');
 const window=compareWindow(p,c);
 const values=p.template==='compare'?[p.period,p.other_period,p.store,window?[...window.months]:[...ALL_MONTHS]]:
  p.template==='period'?[p.period,p.store]:[p.period];
 const res=await client.query({text:sqlFor(cfg)[p.template],values,query_timeout:5000});
 const max=p.template==='compare'?2:p.template==='stores'?6:p.template==='products'?5:1;
 if(!Array.isArray(res?.rows)||res.rows.length>max||p.template==='period'&&res.rows.length!==1)throw Error('analyst_cardinality_denied');
 const rows=res.rows.map(r=>row(r,p.template));
 const seen=new Set();
 for(const r of rows){
  const id=r.code||r.label;
  if(id){if(seen.has(id))throw Error('analyst_duplicate');seen.add(id);}
 }
 if(p.template==='compare'&&rows.some(r=>r.label!==p.period&&r.label!==p.other_period))throw Error('analyst_extra_period');
 const at=now();if(!(at instanceof Date)||!Number.isFinite(at.getTime()))throw Error('analyst_time_invalid');
 return {tenant_id:TENANT,mode:'online_aggregate',source:p.template==='products'?cfg.products:cfg.commercial,
  at:at.toISOString(),plan:p,rows,...(window?{window}:{})};
}
// Reads what the sources hold. One bounded query, no parameters.
async function readCoverage(client,now=()=>Date.now(),env=process.env){
 if(typeof client?.query!=='function')throw Error('analyst_no_client');
 const cfg=sourceConfigFromEnv(env);
 const res=await client.query({text:sqlFor(cfg).coverage,values:[],query_timeout:5000});
 return coverage.fromRows(res?.rows,now(),{cutStarts:cfg.cutStarts});
}
const nf=new Intl.NumberFormat('pt-BR');
const mf=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
// Ticket médio = valor_pago importado ÷ registros não cancelados (null when
// there is no non-cancelled record: never a division by zero shown as 0).
const ticketOf=r=>r.records-r.cancelled>0?Math.round(r.amount/(r.records-r.cancelled)*100)/100:null;
const measure=(r,m)=>m==='cancelled'?r.cancelled:m==='money'?r.amount:m==='ticket'?ticketOf(r):r.records;
const f=(n,m)=>n===null?'indefinido (sem registros não cancelados)':m==='money'||m==='ticket'?mf.format(n):nf.format(n);
const label=m=>m==='cancelled'?'registros marcados como cancelados':m==='money'?'soma importada de valor_pago (não cancelados)':
 m==='ticket'?'ticket médio (valor_pago importado ÷ registros não cancelados)':'registros de vendas';
const dayLabel=d=>d.slice(8,10)+'/'+d.slice(5,7)+'/'+d.slice(0,4);
// What part of each asked period the source really holds (months present,
// gaps, partial months), from the coverage read from the source, for the
// asked store when there is one. Never silent.
function coverageNotes(p,data,sourceDay,c){
 if(p.template==='products'){
  const scope=productScope(c);
  return coverage.isPartial(scope,p.period)?
   ['⚠️ Período parcial na fonte de produtos (cobertura: '+coverage.describe(scope)+').']:[];
 }
 const scope=sales(c,p.store),who=p.store?'a loja '+p.store:'';
 if(data.window){
  return data.window.months.length===12?[]:['⚠️ A comparação usa apenas '+coverage.windowText(data.window)+
   ', meses com dados contínuos nos dois anos'+(who?' para '+who:'')+'; os demais estão parciais ou sem dados.'];
 }
 return [p.period,p.other_period].filter(Boolean).flatMap(x=>coverage.periodNotes(scope,x,who));
}
function reply(data,requested,c=coverage.BASELINE,env=process.env){
 const cfg=sourceConfigFromEnv(env);
 const p=validateShape(requested);
 if(!data||data.tenant_id!==TENANT||data.mode!=='online_aggregate'||
 data.source!==(p.template==='products'?cfg.products:cfg.commercial)||
 !data.plan||data.plan.tenant_id!==TENANT||
 data.plan.template!==p.template||data.plan.period!==p.period||
 data.plan.other_period!==p.other_period||data.plan.metric!==p.metric||
 data.plan.store!==p.store||!Array.isArray(data.rows)||
 data.rows.length>(p.template==='compare'?2:p.template==='stores'?6:
  p.template==='products'?5:1)||
 typeof data.at!=='string'||!Number.isFinite(Date.parse(data.at)))
 throw Error('analyst_reply_denied');
 // A year comparison must say which months it compared; nothing else may.
 const yearCompare=p.template==='compare'&&p.period.length===4;
 if(yearCompare?!validWindow(data.window):data.window!==undefined)throw Error('analyst_reply_denied');
 // Cached or injected evidence must not introduce duplicate/foreign dimensions.
 const seenEvidence=new Set();
 for(const r of data.rows){
  if(!r||typeof r!=='object'||Array.isArray(r))throw Error('analyst_reply_denied');
  const dimension=p.template==='products'?r.code:p.template==='period'?null:r.label;
  if(p.template==='stores'&&!STORES.includes(dimension)||
     p.template==='compare'&&dimension!==p.period&&dimension!==p.other_period||
     p.template==='products'&&(typeof dimension!=='string'||
       !/^[0-9]{1,12}$/.test(dimension))||
     dimension!==null&&seenEvidence.has(dimension))throw Error('analyst_reply_denied');
  if(dimension!==null)seenEvidence.add(dimension);
  if(p.template==='products'){
   if(typeof r.name!=='string'||r.name.length>100||
      !/^[\p{L}\p{N} .,:;()\-+\/%ºª°&_']+$/u.test(r.name)||
      !Number.isSafeInteger(r.items)||r.items<0)
     throw Error('analyst_reply_denied');
  }else if(!Number.isSafeInteger(r.records)||r.records<0||
     !Number.isSafeInteger(r.cancelled)||r.cancelled<0||
     r.cancelled>r.records||typeof r.amount!=='number'||
     !Number.isFinite(r.amount)||r.amount<0||
     r.last_day!==null&&!validImportedDay(r.last_day)||
     ['source_last_day','scope_last_day'].some(k=>r[k]!==undefined&&r[k]!==null&&
      !freshness.validDay(r[k])))
   throw Error('analyst_reply_denied');
 }
 const lines=['📊 Hermes — análise histórica Grupo Erick',
  'Fonte: Supabase / '+data.source,
  'Consultado em: '+new Date(data.at).toLocaleString('pt-BR',{timeZone:'America/Recife',hour12:false})];
 const at=Date.parse(data.at);
 const sourceDay=p.template==='products'?null:
  freshness.latestDay(data.rows.map(r=>r.source_last_day));
 if(p.template!=='products'){
  const fresh=freshness.describe(sourceDay,at);
  lines.push(fresh?(p.store?'Fonte geral: ':'')+fresh.text:'Atualidade da fonte: não informada nesta consulta');
  if(p.store){
   // All rows of one store carry the same scope day; any row may be absent.
   const days=data.rows.map(r=>r.scope_last_day);
   const known=days.filter(d=>d!==undefined);
   const storeDay=known.length?(known.some(d=>d!==null)?
    freshness.latestDay(known):null):undefined;
   lines.push(freshness.storeLine(p.store,storeDay,sourceDay,at));
  }
 }
 // A ranked store whose own data ends before the source is marked inline.
 const behindNote=r=>{
  if(r.scope_last_day===undefined||!freshness.validDay(sourceDay))return '';
  if(r.scope_last_day===null)return ' (sem data registrada)';
  return r.scope_last_day<sourceDay?' (dados até '+freshness.shownDay(r.scope_last_day)+')':'';
 };
 if(p.template==='products'){
  lines.push('Produtos por registros de itens não cancelados — '+p.period+':');
  for(const r of data.rows)lines.push('• '+r.name+' (cód. '+r.code+'): '+nf.format(r.items));
  lines.push('⚠️ Não são unidades líquidas vendidas, faturamento nem estoque. Códigos genéricos podem distorcer rankings.');
 }else if(p.template==='compare'){
  const map=new Map(data.rows.map(r=>[r.label,r]));const a=map.get(p.period),b=map.get(p.other_period);
  if(!a||!b)throw Error('analyst_comparison_missing');
  const x=measure(a,p.metric),y=measure(b,p.metric);
  const delta=x===null||y===null?null:Math.round((y-x)*100)/100;
  const pct=delta===null||x===0?'indefinida':new Intl.NumberFormat('pt-BR',{style:'percent',maximumFractionDigits:1}).format(delta/x);
  const span=yearCompare?' ('+coverage.windowText(data.window)+')':'';
  if(yearCompare)
   lines.push('📅 Cobertura equivalente: '+coverage.windowText(data.window)+' de cada ano (meses com dados contínuos;'+
    ' a completude da exportação não está comprovada).');
  lines.push('Comparação — '+label(p.metric)+':',
   '• '+p.period+span+': '+f(x,p.metric),
   '• '+p.other_period+span+': '+f(y,p.metric),
   '• Diferença: '+(delta===null?'indefinida':(delta>0?'+':'')+f(delta,p.metric))+' ('+pct+')');
  if(p.metric==='cancelled'){
   // The verified aggregate always provides both the numerator and the base.
   // Never claim that a cancellation rate cannot be calculated when both exist.
   const rate=r=>r.records===0?null:r.cancelled/r.records;
   const aRate=rate(a),bRate=rate(b);
   const formatRate=r=>r===null?'indefinida (sem registros)':
    new Intl.NumberFormat('pt-BR',{style:'percent',minimumFractionDigits:2,maximumFractionDigits:2}).format(r);
   lines.push('• Base dos registros: '+p.period+' '+nf.format(a.records)+' registros; '+
    p.other_period+' '+nf.format(b.records)+' registros.',
    '• Taxa de registros marcados como cancelados: '+p.period+' '+formatRate(aRate)+
    '; '+p.other_period+' '+formatRate(bRate)+'.');
   if(aRate!==null&&bRate!==null){
    const points=(bRate-aRate)*100;
    const formatted=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(points);
    lines.push('• Variação da taxa: '+(points>0?'+':'')+formatted+' pontos percentuais.');
   }
   lines.push('⚠️ Taxa sobre cabeçalhos importados marcados como cancelados; não mede perda financeira.');
  }
 }else if(p.template==='stores'){
  const rank=r=>measure(r,p.metric)??-1; // undefined tickets go last
  const sorted=[...data.rows].sort((a,b)=>rank(b)-rank(a)||a.label.localeCompare(b.label));
  lines.push('Ranking das lojas por '+label(p.metric)+' — '+p.period+':');
  // A store whose own coverage misses part of the period is marked: its
  // smaller total is missing data, not lower sales.
  // Without a per-store reading, stores are not marked one by one: one
  // line says their own coverage was not verified.
  const unverified=sorted.some(r=>sales(c,r.label).unverified);
  const gap=r=>!unverified&&coverage.periodNotes(sales(c,r.label),p.period).length&&
   !coverage.periodNotes(sales(c),p.period).length?' (cobertura parcial nesta loja)':'';
  for(const r of sorted)lines.push('• '+r.label+': '+f(measure(r,p.metric),p.metric)+behindNote(r)+gap(r));
  if(sorted.some(r=>behindNote(r)))
   lines.push('⚠️ Lojas marcadas com data própria têm dados mais antigos que a fonte.');
  if(sorted.some(r=>gap(r)))
   lines.push('⚠️ Lojas com cobertura parcial não têm dados em todo o período; o total menor não significa venda menor.');
  if(unverified)
   lines.push('⚠️ Cobertura de cada loja não verificada nesta leitura: um total menor pode ser falta de dados, não venda menor.');
  lines.push('Códigos de lojas ainda não conciliados; ERICK SPORTS e SPORTS-(DESATIVADO) são distintos.');
 }else{
  const r=data.rows[0];if(!r)throw Error('analyst_total_missing');
  lines.push('Período: '+p.period+(p.store?' | loja '+p.store:''),
   '• '+label(p.metric)+': '+f(measure(r,p.metric),p.metric));
  if(p.metric!=='records')lines.push('• Total de registros: '+nf.format(r.records));
  if(p.metric!=='cancelled')lines.push('• Marcados como cancelados: '+nf.format(r.cancelled));
  if(p.metric==='ticket')lines.push('• Soma importada de valor_pago (não cancelados): '+mf.format(r.amount));
 }
 if((p.metric==='money'||p.metric==='ticket')&&p.template!=='products')
  lines.push('⚠️ valor_pago é um campo importado do Softcom; não é faturamento líquido, caixa recebido ou DRE conciliada.');
 if(p.metric==='ticket')
  lines.push('⚠️ Ticket por registro de venda importado (cabeçalho), não por cliente nem por item.');
 lines.push(...coverageNotes(p,data,sourceDay,c));
 lines.push('Somente leitura. Sem dados pessoais.');
 return lines.join('\n');
}
module.exports={TENANT,SOURCE,PRODUCT_SOURCE,COMMERCIAL_V2_SOURCE,STORES,METRICS,CUT_STARTS,sourceConfigFromEnv,sqlFor,normalize,isPeriod,isPeriodFormat,periodsOf,
 safeContext,planQuestion,validateShape,validate,compareWindow,SQL,execute,readCoverage,reply,
 // Shared with templates that reuse the same metrics (seller ranking).
 metric:Object.freeze({ticketOf,measure,format:f,label,coverageNotes})};
