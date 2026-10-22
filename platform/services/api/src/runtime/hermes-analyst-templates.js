'use strict';
// Governed, reusable business query templates. Text never reaches SQL.
const TENANT='grupo_erick';
const SOURCE='hermes_history.monthly_commercial_2025_2026_v1';
const PRODUCT_SOURCE='hermes_history.monthly_product_activity_v1';
const STORES=['CALCADOS','SIRINHAEM','MAGAZINE','SPORTS-(DESATIVADO)','ERICK SPORTS','VARIEDADES'];
const MONTHS={janeiro:1,fevereiro:2,marco:3,abril:4,maio:5,junho:6,julho:7,agosto:8,setembro:9,outubro:10,novembro:11,dezembro:12};
const normalize=t=>t.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const isPeriod=p=>typeof p==='string'&&/^(2025-(0[1-9]|1[0-2])|2026-0[1-6]|202[56])$/.test(p);
function periodsOf(text){
 const out=[],add=p=>{if(!out.includes(p))out.push(p)};
 for(const x of text.matchAll(/\b(202[56])-(0[1-9]|1[0-2])\b/g))add(x[1]+'-'+x[2]);
 for(const x of text.matchAll(/\b(0?[1-9]|1[0-2])\/(202[56])\b/g))add(x[2]+'-'+x[1].padStart(2,'0'));
 for(const x of text.matchAll(/\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+(?:(?:de|do|em)\s+)?(202[56])\b/g))add(x[2]+'-'+String(MONTHS[x[1]]).padStart(2,'0'));
 const m=text.match(/\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/);
 const years=[...new Set([...text.matchAll(/\b202[56]\b/g)].map(x=>x[0]))];
 if(m&&years.length===2)for(const y of years)add(y+'-'+String(MONTHS[m[1]]).padStart(2,'0'));
 if(out.length===0&&m&&years.length===1)add(years[0]+'-'+String(MONTHS[m[1]]).padStart(2,'0'));
 if(out.length===0&&years.length===1)add(years[0]);
 if(out.length===0&&m&&years.length===0)
  add('2026-'+String(MONTHS[m[1]]).padStart(2,'0')); // Last year covered by the imported database.
 if(out.length===0&&years.length===2)for(const y of years)add(y);
 return out;
}
function safeContext(x){
 return x&&x.tenant_id===TENANT&&['period','compare','stores','products'].includes(x.template)&&isPeriod(x.period)&&['records','cancelled','money'].includes(x.metric)?x:null;
}
function planQuestion(text,context=null){
 if(typeof text!=='string'||text.length>600||text.trim().length<2)return null;
 const q=normalize(text),prior=safeContext(context);
 if(/^\/|(\b(cpf|cnpj|senha|token|pix|transferencia|deletar|apagar|publicar|pagar)\b)/.test(q))return null;
 const follow=/^(e\b|mas\b|agora\b|compare\b|comparando\b)/.test(q);
 if(!/\b(venda|vendas|vendeu|vendemos|vendido|vendidos|faturamento|faturou|valor|receita|canceladas|cancelados|loja|lojas|produto|produtos|mercadoria|mercadorias|compare|comparar|comparacao|comparando|diferenca|mais|quanto|quantas|qual|quais|registros|evolucao|cresceu|crescimento|total)\b/.test(q)&&!(prior&&follow))return null;
 let periods=periodsOf(q);
 if(!periods.length&&prior&&follow){
  const named=q.match(/\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/);
  const oldYear=/\b(ano passado|ano anterior)\b/.test(q);
  const year=oldYear?String(Number(prior.period.slice(0,4))-1):prior.period.slice(0,4);
  periods=[named?year+'-'+String(MONTHS[named[1]]).padStart(2,'0'):prior.period];
 }
 if(prior&&follow&&periods.length===1&&periods[0].length===4&&prior.period.length===7)periods=[periods[0]+prior.period.slice(4)];
 if(!periods.length||periods.some(p=>!isPeriod(p))||periods.length>2)return null;
 let metric=/\bcancelad(as|os|a|o)\b/.test(q)?'cancelled':
  /\b(faturamento|faturou|receita|valor|dinheiro|reais)\b|\bquanto\s+(vendeu|vendemos|venderam)\b|\b(vendeu|vendemos)\s+quanto\b/.test(q)?'money':'records';
 if(follow&&prior&&!/\b(cancelad|faturamento|faturou|receita|valor|quanto|registros|quantas)\b/.test(q))metric=prior.metric;
 const compare=/\b(compare|comparar|comparacao|comparando|diferenca|versus|vs|cresceu|crescimento|evolucao)\b/.test(q);
 if(compare&&periods.length===1&&prior&&prior.period!==periods[0])periods=[prior.period,periods[0]];
 if(compare&&periods.length===1&&periods[0].startsWith('2026-'))periods=['2025-'+periods[0].slice(5),periods[0]];
 const product=/\b(produto|produtos|mercadoria|mercadorias)\b/.test(q);
 const storeWord=/\b(loja|lojas)\b/.test(q);
 const store=STORES.find(s=>q.includes(normalize(s)))||null;
 const storeRanking=storeWord&&!store&&/\b(qual|quais|mais|maior|ranking|por|cada|melhor|pior)\b/.test(q);
 const template=product?'products':storeRanking?'stores':periods.length===2||compare?'compare':'period';
 if(template==='compare'&&(periods.length!==2||periods[0].length!==periods[1].length||periods[0]===periods[1]))return null;
 if(template==='products'&&(!periods[0].startsWith('2026')||periods.length!==1||store))return null;
 if(template!=='compare'&&periods.length!==1)return null;
 if(storeWord&&!store&&!storeRanking&&/\b(barreiros|erick|sports|magazine|variedades|calcados|sirinhaem)\b/.test(q))return null;
 return Object.freeze({tenant_id:TENANT,template,period:periods[0],other_period:template==='compare'?periods[1]:null,metric,store});
}
function validate(p){
 if(!p||p.tenant_id!==TENANT||!['period','compare','stores','products'].includes(p.template)||
   !isPeriod(p.period)||!['records','cancelled','money'].includes(p.metric)||
   p.store!=null&&!STORES.includes(p.store))throw Error('analyst_plan_denied');
 if(p.template==='compare'?(!isPeriod(p.other_period)||p.other_period.length!==p.period.length||p.other_period===p.period):p.other_period!=null)throw Error('analyst_comparison_denied');
 if(p.template==='products'&&(!p.period.startsWith('2026')||p.store))throw Error('analyst_products_denied');
 if(p.template==='stores'&&p.store)throw Error('analyst_stores_denied');
 return p;
}
const matchPeriod='(month=$1::text OR (length($1::text)=4 AND LEFT(month,4)=$1::text))';
const agg='SUM(registered)::bigint AS records,SUM(cancelled)::bigint AS cancelled,'+
 'SUM(noncancelled)::bigint AS noncancelled,SUM(valor_pago_noncancelled_sum)::numeric(18,2) AS amount,MAX(last_day) AS last_day';
const SQL=Object.freeze({
 period:'SELECT '+agg+' FROM '+SOURCE+' WHERE '+matchPeriod+' AND ($2::text IS NULL OR raw_store=$2::text)',
 compare:'SELECT CASE WHEN length($1::text)=4 THEN LEFT(month,4) ELSE month END AS label,'+agg+
   ' FROM '+SOURCE+' WHERE (month IN ($1::text,$2::text) OR (length($1::text)=4 AND LEFT(month,4) IN ($1::text,$2::text)))'+
   ' AND ($3::text IS NULL OR raw_store=$3::text) GROUP BY 1 ORDER BY 1 LIMIT 2',
 stores:'SELECT raw_store AS label,'+agg+' FROM '+SOURCE+' WHERE '+matchPeriod+' GROUP BY raw_store ORDER BY raw_store LIMIT 6',
 products:'SELECT product_code,MIN(product_label) AS product_label,SUM(not_marked_cancelled)::bigint AS item_records'+
   ' FROM '+PRODUCT_SOURCE+' WHERE '+matchPeriod+' GROUP BY product_code ORDER BY item_records DESC,product_code ASC LIMIT 5'
});
function integer(n){
 if(!/^(0|[1-9][0-9]{0,8})$/.test(String(n)))throw Error('analyst_invalid_integer');
 return Number(n);
}
function money(n){
 if(!/^[0-9]{1,13}(\.[0-9]{1,2})?$/.test(String(n)))throw Error('analyst_invalid_amount');
 return Number(n);
}
function row(r,template){
 if(!r||typeof r!=='object')throw Error('analyst_bad_row');
 if(template==='products'){
  if(!/^[0-9]{1,12}$/.test(r.product_code||'')||typeof r.product_label!=='string'||r.product_label.length>100||
   !/^[\p{L}\p{N} .,:;()\-+\/%ºª°&_']+$/u.test(r.product_label))throw Error('analyst_product_denied');
  return {code:r.product_code,name:r.product_label,items:integer(r.item_records)};
 }
 const o={records:integer(r.records),cancelled:integer(r.cancelled),amount:money(r.amount),last_day:r.last_day};
 if(o.cancelled>o.records||o.last_day!==null&&!/^202[56]-(0[1-9]|1[0-2])-[0-3][0-9]$/.test(o.last_day))throw Error('analyst_counts_invalid');
 if(template!=='stores'&&integer(r.noncancelled)!==o.records-o.cancelled)throw Error('analyst_counts_invalid');
 if(template!=='period'){
  if(template==='stores'?!STORES.includes(r.label):!isPeriod(r.label))throw Error('analyst_label_invalid');
  o.label=r.label;
 }
 return o;
}
async function execute(client,params,now=()=>new Date()){
 const p=validate(params);
 if(typeof client?.query!=='function')throw Error('analyst_no_client');
 const values=p.template==='compare'?[p.period,p.other_period,p.store]:p.template==='period'?[p.period,p.store]:[p.period];
 const res=await client.query({text:SQL[p.template],values,query_timeout:5000});
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
 return {tenant_id:TENANT,mode:'online_aggregate',source:p.template==='products'?PRODUCT_SOURCE:SOURCE,at:at.toISOString(),plan:p,rows};
}
const nf=new Intl.NumberFormat('pt-BR');
const mf=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const measure=(r,m)=>m==='cancelled'?r.cancelled:m==='money'?r.amount:r.records;
const f=(n,m)=>m==='money'?mf.format(n):nf.format(n);
const label=m=>m==='cancelled'?'registros marcados como cancelados':m==='money'?'soma importada de valor_pago (não cancelados)':'registros de vendas';
function reply(data,requested){
 const p=validate(requested);
 if(!data||data.tenant_id!==TENANT||data.mode!=='online_aggregate'||
 data.source!==(p.template==='products'?PRODUCT_SOURCE:SOURCE)||data.plan.template!==p.template||
 data.plan.period!==p.period||data.plan.other_period!==p.other_period||!Array.isArray(data.rows))
 throw Error('analyst_reply_denied');
 const lines=['📊 Hermes — análise histórica Grupo Erick',
  'Fonte: Supabase / '+data.source,
  'Consultado em: '+new Date(data.at).toLocaleString('pt-BR',{timeZone:'America/Recife',hour12:false})];
 if(p.template==='products'){
  lines.push('Produtos por registros de itens não cancelados — '+p.period+':');
  for(const r of data.rows)lines.push('• '+r.name+' (cód. '+r.code+'): '+nf.format(r.items));
  lines.push('⚠️ Não são unidades líquidas vendidas, faturamento nem estoque. Códigos genéricos podem distorcer rankings.');
 }else if(p.template==='compare'){
  const map=new Map(data.rows.map(r=>[r.label,r]));const a=map.get(p.period),b=map.get(p.other_period);
  if(!a||!b)throw Error('analyst_comparison_missing');
  const x=measure(a,p.metric),y=measure(b,p.metric),delta=y-x;
  const pct=x===0?'indefinida':new Intl.NumberFormat('pt-BR',{style:'percent',maximumFractionDigits:1}).format(delta/x);
  lines.push('Comparação — '+label(p.metric)+':',
   '• '+p.period+': '+f(x,p.metric),'• '+p.other_period+': '+f(y,p.metric),
   '• Diferença: '+(delta>0?'+':'')+f(delta,p.metric)+' ('+pct+')');
 }else if(p.template==='stores'){
  const sorted=[...data.rows].sort((a,b)=>measure(b,p.metric)-measure(a,p.metric)||a.label.localeCompare(b.label));
  lines.push('Ranking das lojas por '+label(p.metric)+' — '+p.period+':');
  for(const r of sorted)lines.push('• '+r.label+': '+f(measure(r,p.metric),p.metric));
  lines.push('Códigos de lojas ainda não conciliados; ERICK SPORTS e SPORTS-(DESATIVADO) são distintos.');
 }else{
  const r=data.rows[0];if(!r)throw Error('analyst_total_missing');
  lines.push('Período: '+p.period+(p.store?' | loja '+p.store:''),
   '• '+label(p.metric)+': '+f(measure(r,p.metric),p.metric),
   '• Registros: '+nf.format(r.records),'• Marcados cancelados: '+nf.format(r.cancelled));
 }
 if(p.metric==='money'&&p.template!=='products')
  lines.push('⚠️ valor_pago é um campo importado do Softcom; não é faturamento líquido, caixa recebido ou DRE conciliada.');
 if(p.period==='2026'||p.period==='2026-06'||p.other_period==='2026'||p.other_period==='2026-06')
  lines.push('⚠️ Histórico 2026 parcial até 08/06; comparações anuais podem não ter cobertura equivalente.');
 lines.push('Somente leitura. Sem dados pessoais.');
 return lines.join('\n');
}
module.exports={TENANT,SOURCE,PRODUCT_SOURCE,STORES,normalize,isPeriod,periodsOf,safeContext,planQuestion,validate,SQL,execute,reply};
