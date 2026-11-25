'use strict';
// Deterministic credit (inadimplência) queries: open portfolio by overdue
// band, concentration of overdue risk by store, and recovery of overdue
// installments. Aggregates only: no customer, document or installment row
// ever leaves the database.
//
// The Hermes-facing views are a CONTRACT (columns below) that the store
// database must expose under hermes_history, built from its real tables
// after the Supabase audit. Until a reviewed view name is configured, every
// template refuses with credit_source_awaiting_audit (fail closed). Text never
// reaches SQL; the view name is allow-listed and comes from configuration.
const freshness=require('./hermes-data-freshness');
const coverageModel=require('./hermes-history-coverage');
const TENANT='grupo_erick';
const STORES=['CALCADOS','SIRINHAEM','MAGAZINE','SPORTS-(DESATIVADO)','ERICK SPORTS','VARIEDADES'];
// Overdue bands as computed by the view on its position day (to be confirmed
// by the audit together with the definition of "vencido").
const BUCKETS=Object.freeze(['a_vencer','1_30','31_60','61_90','91_180','181_360','360_mais']);
const OVERDUE=BUCKETS.slice(1);
const OVER_90=Object.freeze(['91_180','181_360','360_mais']);
const BUCKET_LABEL=Object.freeze({a_vencer:'a vencer','1_30':'1 a 30 dias','31_60':'31 a 60 dias',
 '61_90':'61 a 90 dias','91_180':'91 a 180 dias','181_360':'181 a 360 dias','360_mais':'mais de 360 dias'});
const CONTRACT=Object.freeze({
 position:Object.freeze({grain:'as_of_day × raw_store × aging_bucket',
  columns:Object.freeze({as_of_day:'text YYYY-MM-DD: dia da posição da carteira',
   raw_store:'text: código de loja (mesmos valores da view comercial)',
   aging_bucket:'text: '+BUCKETS.join('|'),installments:'bigint: parcelas em aberto',
   open_amount:'numeric(18,2): saldo em aberto em reais'})}),
 recovery:Object.freeze({grain:'month × raw_store',
  columns:Object.freeze({month:'text YYYY-MM',raw_store:'text',
   recovered_installments:'bigint: parcelas vencidas recebidas no mês',
   recovered_amount:'numeric(18,2): valor recebido dessas parcelas',
   last_day:'text YYYY-MM-DD: último dia com recebimento no mês'})})
});
const RELATION=/^hermes_history\.[a-z][a-z0-9_]{2,62}$/;
// View names from configuration (composition root), never from a message.
function sourcesFromEnv(env=process.env){
 const pick=name=>{
  const v=env[name];
  if(v===undefined||v==='')return null;
  if(!RELATION.test(v))throw Error('credit_source_config_invalid');
  return v;
 };
 return Object.freeze({position:pick('HERMES_HISTORY_RECEIVABLES_POSITION_VIEW'),
  recovery:pick('HERMES_HISTORY_RECEIVABLES_RECOVERY_VIEW')});
}
const MONTHS=['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const normalize=t=>t.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const CREDIT_WORDS=/\b(inadimplencia|inadimplentes?|vencid[ao]s?|atrasad[ao]s?|atraso|carteira|crediario|recuper[a-z]*|cobranca|parcelas?|a receber)\b/;
function planQuestion(text,coverage=coverageModel.BASELINE){
 if(typeof text!=='string'||text.length>600||text.trim().length<4)return null;
 const q=normalize(text);
 if(q.startsWith('/')||!CREDIT_WORDS.test(q))return null;
 // Payables (Compras/duplicatas a fornecedores) and LotoIA keep their own routes.
 if(/\b(compras?|duplicatas?|fornecedor(es)?|boletos?|lotoia|loterica|lotericas)\b/.test(q))return null;
 // Never a person: no customer, document or contact lookups.
 if(/\b(cpf|cnpj|cliente|clientes|nome|nomes|telefone|endereco|quem|devedor|devedores|contrato|senha|token|pix|pagar|cobrar|enviar|mensagem|negativar|protestar)\b/.test(q))return null;
 const store=STORES.find(s=>q.includes(normalize(s)))||null;
 if(/\b(recuper[a-z]*|recebid[ao]s?|cobranca)\b/.test(q)){
  // One period: "maio de 2026", "2025", or "maio" = the latest May held.
  const m=q.match(/\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/);
  const years=[...new Set([...q.matchAll(/\b20[0-9]{2}\b/g)].map(x=>x[0]))];
  if(years.length>1)return null;
  const mm=m?String(MONTHS.indexOf(m[1])+1).padStart(2,'0'):null;
  const year=years[0]||(mm?coverageModel.yearForMonth(coverageModel.scopeOf(coverage,'commercial'),mm):null);
  if(!year)return null;
  return Object.freeze({tenant_id:TENANT,template:'recovery',period:mm?year+'-'+mm:year,store});
 }
 const byStore=!store&&/\b(lojas|por loja|cada loja|qual loja|quais lojas|concentracao|concentrad[ao]|ranking)\b/.test(q);
 return Object.freeze({tenant_id:TENANT,template:byStore?'stores':'portfolio',period:null,store:byStore?null:store});
}
const PERIOD=/^20[0-9]{2}(-(0[1-9]|1[0-2]))?$/;
function validateShape(p){
 if(!p||p.tenant_id!==TENANT||!['portfolio','stores','recovery'].includes(p.template)||
  p.store!=null&&!STORES.includes(p.store)||Object.keys(p).sort().join()!=='period,store,template,tenant_id')
  throw Error('credit_plan_denied');
 if(p.template==='recovery'?typeof p.period!=='string'||!PERIOD.test(p.period):p.period!==null)
  throw Error('credit_plan_denied');
 if(p.template==='stores'&&p.store!==null)throw Error('credit_plan_denied');
 return p;
}
// A recovery period must be held by the source (same coverage as sales).
function validate(p,coverage=coverageModel.BASELINE){
 validateShape(p);
 if(p.template==='recovery'&&!coverageModel.accepts(coverageModel.scopeOf(coverage,'commercial'),p.period))
  throw Error('credit_period_not_covered');
 return p;
}
function sqlFor(template,sources){
 const pos=sources?.position,rec=sources?.recovery;
 if(template==='recovery'){
  if(!rec||!RELATION.test(rec))throw Error('credit_source_awaiting_audit');
  return 'SELECT SUM(recovered_installments)::bigint AS installments,SUM(recovered_amount)::numeric(18,2) AS amount,'+
   'MAX(last_day) AS last_day,(SELECT MAX(last_day) FROM '+rec+') AS source_last_day FROM '+rec+
   ' WHERE (month=$1::text OR (length($1::text)=4 AND LEFT(month,4)=$1::text)) AND ($2::text IS NULL OR raw_store=$2::text)';
 }
 if(!pos||!RELATION.test(pos))throw Error('credit_source_awaiting_audit');
 const latest='as_of_day=(SELECT MAX(as_of_day) FROM '+pos+')';
 if(template==='portfolio')
  return 'SELECT aging_bucket,SUM(installments)::bigint AS installments,SUM(open_amount)::numeric(18,2) AS open_amount,'+
   'MAX(as_of_day) AS as_of_day FROM '+pos+' WHERE '+latest+' AND ($1::text IS NULL OR raw_store=$1::text)'+
   ' GROUP BY aging_bucket ORDER BY aging_bucket LIMIT 7';
 const inList=list=>list.map(b=>"'"+b+"'").join(',');
 return 'SELECT raw_store AS label,'+
  'COALESCE(SUM(open_amount) FILTER (WHERE aging_bucket IN ('+inList(OVERDUE)+')),0)::numeric(18,2) AS overdue_amount,'+
  'COALESCE(SUM(open_amount) FILTER (WHERE aging_bucket IN ('+inList(OVER_90)+')),0)::numeric(18,2) AS over90_amount,'+
  'COALESCE(SUM(installments) FILTER (WHERE aging_bucket IN ('+inList(OVERDUE)+')),0)::bigint AS overdue_installments,'+
  'COALESCE(SUM(open_amount),0)::numeric(18,2) AS open_amount,MAX(as_of_day) AS as_of_day'+
  ' FROM '+pos+' WHERE '+latest+' GROUP BY raw_store ORDER BY raw_store LIMIT 6';
}
const count=n=>{if(!/^(0|[1-9][0-9]{0,9})$/.test(String(n)))throw Error('credit_invalid_count');return Number(n);};
const money=n=>{if(!/^[0-9]{1,13}(\.[0-9]{1,2})?$/.test(String(n)))throw Error('credit_invalid_amount');return Number(n);};
function day(d,field){
 if(d===null)return null;
 if(!coverageModel.validDay(d))throw Error('credit_invalid_'+field);
 return d;
}
function parseRow(r,template){
 if(!r||typeof r!=='object')throw Error('credit_bad_row');
 if(template==='recovery'){
  if(r.installments===null&&r.amount===null)return {installments:0,amount:0,last_day:null,source_last_day:day(r.source_last_day??null,'day')};
  return {installments:count(r.installments),amount:money(r.amount),last_day:day(r.last_day,'day'),
   source_last_day:day(r.source_last_day??null,'day')};
 }
 if(template==='portfolio'){
  if(!BUCKETS.includes(r.aging_bucket))throw Error('credit_bucket_invalid');
  return {bucket:r.aging_bucket,installments:count(r.installments),amount:money(r.open_amount),
   as_of_day:day(r.as_of_day,'day')};
 }
 if(!STORES.includes(r.label))throw Error('credit_store_invalid');
 const o={label:r.label,overdue:money(r.overdue_amount),over90:money(r.over90_amount),
  overdue_installments:count(r.overdue_installments),open:money(r.open_amount),as_of_day:day(r.as_of_day,'day')};
 if(o.over90>o.overdue||o.overdue>o.open)throw Error('credit_totals_inconsistent');
 return o;
}
async function execute(client,params,{sources,now=()=>new Date(),coverage}={}){
 const p=validate(params,coverage);
 const text=sqlFor(p.template,sources);
 if(typeof client?.query!=='function')throw Error('credit_no_client');
 const values=p.template==='recovery'?[p.period,p.store]:p.template==='portfolio'?[p.store]:[];
 const res=await client.query({text,values,query_timeout:5000});
 const max=p.template==='recovery'?1:p.template==='portfolio'?BUCKETS.length:STORES.length;
 if(!Array.isArray(res?.rows)||res.rows.length>max||p.template==='recovery'&&res.rows.length!==1)
  throw Error('credit_cardinality_denied');
 const rows=res.rows.map(r=>parseRow(r,p.template));
 const keys=rows.map(r=>r.bucket||r.label).filter(Boolean);
 if(new Set(keys).size!==keys.length)throw Error('credit_duplicate');
 const at=now();
 if(!(at instanceof Date)||!Number.isFinite(at.getTime()))throw Error('credit_time_invalid');
 return {tenant_id:TENANT,mode:'online_aggregate',domain:'credit',
  source:p.template==='recovery'?sources.recovery:sources.position,at:at.toISOString(),plan:p,rows};
}
const mf=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const nf=new Intl.NumberFormat('pt-BR');
const pf=new Intl.NumberFormat('pt-BR',{style:'percent',minimumFractionDigits:1,maximumFractionDigits:1});
const share=(a,b)=>b>0?pf.format(a/b):'—';
const LIMITS=['⚠️ Agregados da fonte importada, sem dados de clientes; não conciliados com o ERP/Linx.',
 '⚠️ Não é provisão para perdas nem previsão de recebimento. Faixas e saldo seguem a definição da view auditada.'];
// Rows already parsed by execute (or read back from a cache) are checked
// again before any number is shown.
function checkRow(r,template){
 const n=v=>Number.isSafeInteger(v)&&v>=0,m=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
 const d=v=>v===null||coverageModel.validDay(v);
 const ok=template==='recovery'?n(r.installments)&&m(r.amount)&&d(r.last_day)&&d(r.source_last_day):
  template==='portfolio'?BUCKETS.includes(r.bucket)&&n(r.installments)&&m(r.amount)&&d(r.as_of_day):
  STORES.includes(r.label)&&m(r.overdue)&&m(r.over90)&&n(r.overdue_installments)&&m(r.open)&&d(r.as_of_day)&&
   r.over90<=r.overdue&&r.overdue<=r.open;
 if(!ok)throw Error('credit_reply_denied');
}
function reply(data,requested,{sources}={}){
 const p=validateShape(requested);
 const expected=p.template==='recovery'?sources?.recovery:sources?.position;
 if(!data||data.tenant_id!==TENANT||data.mode!=='online_aggregate'||data.domain!=='credit'||
  !expected||data.source!==expected||!data.plan||JSON.stringify(data.plan)!==JSON.stringify(p)||
  !Array.isArray(data.rows)||!Number.isFinite(Date.parse(data.at)))throw Error('credit_reply_denied');
 if(data.rows.length>(p.template==='recovery'?1:p.template==='portfolio'?BUCKETS.length:STORES.length)||
  p.template==='recovery'&&data.rows.length!==1)throw Error('credit_reply_denied');
 const keys=data.rows.map(r=>r?.bucket||r?.label).filter(Boolean);
 if(new Set(keys).size!==keys.length)throw Error('credit_reply_denied');
 for(const r of data.rows){if(!r||typeof r!=='object')throw Error('credit_reply_denied');checkRow(r,p.template);}
 const at=Date.parse(data.at);
 const lines=['💳 Hermes — crédito e inadimplência Grupo Erick','Fonte: Supabase / '+data.source,
  'Consultado em: '+new Date(at).toLocaleString('pt-BR',{timeZone:'America/Recife',hour12:false})];
 if(p.template==='recovery'){
  const r=data.rows[0];
  const fresh=freshness.describe(r.source_last_day,at);
  lines.push(fresh?fresh.text:'Atualidade da fonte: não informada nesta consulta',
   'Período: '+p.period+(p.store?' | loja '+p.store:''),
   '• Recuperado (parcelas vencidas recebidas): '+mf.format(r.amount)+' em '+nf.format(r.installments)+' parcelas');
  if(r.last_day)lines.push('• Último recebimento registrado no filtro: '+freshness.shownDay(r.last_day));
  lines.push('⚠️ Taxa de recuperação não calculada: exige a carteira vencida no início do período, ainda sem fonte.');
 }else{
  const days=[...new Set(data.rows.map(r=>r.as_of_day).filter(Boolean))];
  if(days.length>1)throw Error('credit_mixed_positions');
  const fresh=freshness.describe(days[0]??null,at);
  lines.push(fresh?'Posição da carteira: '+fresh.text:'Posição da carteira: data não informada nesta consulta');
  if(!data.rows.length){
   // An empty answer is not a clean portfolio: the store may be missing from the position.
   lines.push('⚠️ Nenhuma parcela encontrada na última posição da fonte'+(p.store?' para a loja '+p.store:'')+
    '; confirme se '+(p.store?'a loja está incluída':'a posição foi carregada')+' antes de concluir que não há inadimplência.');
  }else if(p.template==='portfolio'){
   const by=new Map(data.rows.map(r=>[r.bucket,r]));
   const sum=list=>list.reduce((n,b)=>n+(by.get(b)?.amount||0),0);
   const total=sum(BUCKETS),overdue=sum(OVERDUE),over90=sum(OVER_90);
   lines.push((p.store?'Loja '+p.store:'Todas as lojas')+':',
    '• Carteira em aberto: '+mf.format(total),
    '• A vencer: '+mf.format(by.get('a_vencer')?.amount||0),
    '• Vencida: '+mf.format(overdue)+' ('+share(overdue,total)+' da carteira)');
   for(const b of OVERDUE){
    const r=by.get(b);if(!r)continue;
    lines.push('  – '+BUCKET_LABEL[b]+': '+mf.format(r.amount)+' ('+nf.format(r.installments)+' parcelas; '+
     share(r.amount,overdue)+' da vencida)');
   }
   lines.push('• Risco: vencida há mais de 90 dias '+mf.format(over90)+' ('+share(over90,overdue)+' da vencida)');
  }else{
   const total=data.rows.reduce((n,r)=>n+r.overdue,0);
   const sorted=[...data.rows].sort((a,b)=>b.overdue-a.overdue||a.label.localeCompare(b.label));
   lines.push('Concentração da carteira vencida por loja:');
   for(const r of sorted)lines.push('• '+r.label+': '+mf.format(r.overdue)+' vencido ('+share(r.overdue,total)+
    ' do grupo; '+share(r.over90,r.overdue)+' há mais de 90 dias)');
   if(total>0)lines.push('• Maior concentração: '+sorted[0].label+' com '+share(sorted[0].overdue,total)+' da carteira vencida');
   lines.push('Códigos de lojas ainda não conciliados; ERICK SPORTS e SPORTS-(DESATIVADO) são distintos.');
  }
 }
 lines.push(...LIMITS,'Somente leitura. Sem dados pessoais.');
 return lines.join('\n');
}
module.exports={TENANT,BUCKETS,OVERDUE,OVER_90,CONTRACT,RELATION,sourcesFromEnv,normalize,planQuestion,
 validateShape,validate,sqlFor,execute,reply};
