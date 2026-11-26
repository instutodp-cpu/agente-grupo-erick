'use strict';
// Seller ranking (records, valor_pago, ticket médio), reusing the analyst's
// metrics, periods and coverage. The Hermes-facing view is a CONTRACT the
// store database must expose under hermes_history (columns below), built
// from its real sales tables after the Supabase audit. Until a reviewed view
// name is configured, the template refuses with seller_source_awaiting_audit.
// Seller names are employees' personal data: owner only, top 10, no contacts.
// Per the Supabase audit the seller is a column of cadastro_de_vendas and its
// identity across stores and periods is not validated yet: a seller is
// ranked per store (raw_store + seller_code), never merged across stores.
const analyst=require('./hermes-analyst-templates');
const coverageModel=require('./hermes-history-coverage');
const freshness=require('./hermes-data-freshness');
const TENANT=analyst.TENANT;
const RELATION=/^hermes_history\.[a-z][a-z0-9_]{2,62}$/;
const SELLER_SOURCE='hermes_history.monthly_seller_activity_v1';
const LIMIT=10;
// A ticket ranking ignores sellers with too few sales to mean anything.
const TICKET_MIN_SALES=10;
const CONTRACT=Object.freeze({grain:'month × raw_store × seller_code',
 columns:Object.freeze({month:'text YYYY-MM',raw_store:'text: mesmos códigos da view comercial',
  seller_code:'text: identificador estável do vendedor DENTRO da loja (derivado de cadastro_de_vendas.vendedor)',
  seller_label:'text: nome de exibição do vendedor',
  registered:'bigint',cancelled:'bigint',noncancelled:'bigint',
  valor_pago_noncancelled_sum:'numeric(18,2)',last_day:'text YYYY-MM-DD'})});
const METRICS=['records','money','ticket'];
function sourceFromEnv(env=process.env){
 // Seller rankings require an explicit opt-in in addition to the reviewed
 // relation name. A relation alone never activates employee analytics.
 if(env.HERMES_HISTORY_SELLER_ENABLED!=='true')return null;
 const v=env.HERMES_HISTORY_SELLER_VIEW;
 if(v===undefined||v==='')throw Error('seller_source_config_invalid');
 if(v!==SELLER_SOURCE||!RELATION.test(v))throw Error('seller_source_config_invalid');
 return v;
}
function planQuestion(text,coverage=coverageModel.BASELINE){
 if(typeof text!=='string'||text.length>600||text.trim().length<4)return null;
 const q=analyst.normalize(text);
 if(q.startsWith('/')||!/\b(vendedor|vendedores|vendedora|vendedoras|vendedor\(a\))\b/.test(q))return null;
 if(/\b(cpf|telefone|endereco|salario|comissao|comissoes|demitir|contratar|senha|token|pix|pagar)\b/.test(q))return null;
 const periods=analyst.periodsOf(q,coverage);
 if(periods.length!==1||!analyst.isPeriod(periods[0],coverage))return null;
 const store=analyst.STORES.find(s=>q.includes(analyst.normalize(s)))||null;
 const metric=/\bticket\b/.test(q)?'ticket':/\bfatur[a-z]*\b|\b(valor|receita|reais|dinheiro|quanto)\b/.test(q)?'money':'records';
 return Object.freeze({tenant_id:TENANT,template:'sellers',period:periods[0],metric,store});
}
function validateShape(p){
 if(!p||p.tenant_id!==TENANT||p.template!=='sellers'||!analyst.isPeriodFormat(p.period)||
  !METRICS.includes(p.metric)||p.store!=null&&!analyst.STORES.includes(p.store)||
  Object.keys(p).sort().join()!=='metric,period,store,template,tenant_id')throw Error('seller_plan_denied');
 return p;
}
function validate(p,coverage=coverageModel.BASELINE){
 validateShape(p);
 if(!analyst.isPeriod(p.period,coverage))throw Error('seller_period_not_covered');
 return p;
}
const ORDER=Object.freeze({records:'SUM(noncancelled) DESC',money:'SUM(valor_pago_noncancelled_sum) DESC',
 ticket:'SUM(valor_pago_noncancelled_sum)/NULLIF(SUM(noncancelled),0) DESC NULLS LAST'});
function sqlFor(metric,relation){
 if(!relation||!RELATION.test(relation))throw Error('seller_source_awaiting_audit');
 if(!Object.hasOwn(ORDER,metric))throw Error('seller_plan_denied');
 return 'SELECT raw_store,seller_code,MIN(seller_label) AS seller_label,SUM(registered)::bigint AS records,'+
  'SUM(cancelled)::bigint AS cancelled,SUM(noncancelled)::bigint AS noncancelled,'+
  'SUM(valor_pago_noncancelled_sum)::numeric(18,2) AS amount,MAX(last_day) AS last_day,'+
  '(SELECT MAX(last_day) FROM '+relation+') AS source_last_day FROM '+relation+
  ' WHERE (month=$1::text OR (length($1::text)=4 AND LEFT(month,4)=$1::text)) AND ($2::text IS NULL OR raw_store=$2::text)'+
  ' GROUP BY raw_store,seller_code'+(metric==='ticket'?' HAVING SUM(noncancelled)>='+TICKET_MIN_SALES:'')+
  ' ORDER BY '+ORDER[metric]+',raw_store ASC,seller_code ASC LIMIT '+LIMIT;
}
const LABEL=/^[\p{L}\p{N} .'()\-]{1,60}$/u;
const CODE=/^[A-Za-z0-9._-]{1,32}$/;
const int=n=>{if(!/^(0|[1-9][0-9]{0,9})$/.test(String(n)))throw Error('seller_invalid_count');return Number(n);};
const money=n=>{if(!/^[0-9]{1,13}(\.[0-9]{1,2})?$/.test(String(n)))throw Error('seller_invalid_amount');return Number(n);};
function parseRow(r){
 if(!r||typeof r!=='object'||!analyst.STORES.includes(r.raw_store)||!CODE.test(r.seller_code||'')||
  typeof r.seller_label!=='string'||!LABEL.test(r.seller_label))throw Error('seller_row_denied');
 const o={store:r.raw_store,code:r.seller_code,name:r.seller_label.trim(),records:int(r.records),cancelled:int(r.cancelled),
  amount:money(r.amount),last_day:r.last_day??null,source_last_day:r.source_last_day??null};
 if(o.cancelled>o.records||int(r.noncancelled)!==o.records-o.cancelled)throw Error('seller_counts_invalid');
 for(const d of [o.last_day,o.source_last_day])if(d!==null&&!coverageModel.validDay(d))throw Error('seller_day_invalid');
 return o;
}
async function execute(client,params,{relation,now=()=>new Date(),coverage}={}){
 const p=validate(params,coverage);
 const text=sqlFor(p.metric,relation);
 if(typeof client?.query!=='function')throw Error('seller_no_client');
 const res=await client.query({text,values:[p.period,p.store],query_timeout:5000});
 if(!Array.isArray(res?.rows)||res.rows.length>LIMIT)throw Error('seller_cardinality_denied');
 const rows=res.rows.map(parseRow);
 if(new Set(rows.map(r=>r.store+'|'+r.code)).size!==rows.length)throw Error('seller_duplicate');
 const at=now();
 if(!(at instanceof Date)||!Number.isFinite(at.getTime()))throw Error('seller_time_invalid');
 return {tenant_id:TENANT,mode:'online_aggregate',domain:'sellers',source:relation,at:at.toISOString(),plan:p,rows};
}
function reply(data,requested,{relation,coverage}={}){
 const p=validateShape(requested);
 if(!data||data.tenant_id!==TENANT||data.mode!=='online_aggregate'||data.domain!=='sellers'||
  !relation||data.source!==relation||JSON.stringify(data.plan)!==JSON.stringify(p)||
  !Array.isArray(data.rows)||data.rows.length>LIMIT||!Number.isFinite(Date.parse(data.at)))
  throw Error('seller_reply_denied');
 const codes=new Set();
 for(const r of data.rows){
  if(!r||!analyst.STORES.includes(r.store)||!CODE.test(r.code||'')||typeof r.name!=='string'||
   !LABEL.test(r.name)||codes.has(r.store+'|'+r.code)||p.store&&r.store!==p.store||
   !Number.isSafeInteger(r.records)||!Number.isSafeInteger(r.cancelled)||r.cancelled<0||r.cancelled>r.records||
   typeof r.amount!=='number'||!Number.isFinite(r.amount)||r.amount<0)throw Error('seller_reply_denied');
  codes.add(r.store+'|'+r.code);
 }
 const m=analyst.metric,at=Date.parse(data.at);
 const sourceDay=freshness.latestDay(data.rows.map(r=>r.source_last_day));
 const fresh=freshness.describe(sourceDay,at);
 const lines=['🏅 Hermes — ranking de vendedores Grupo Erick','Fonte: Supabase / '+data.source,
  'Consultado em: '+new Date(at).toLocaleString('pt-BR',{timeZone:'America/Recife',hour12:false}),
  fresh?fresh.text:'Atualidade da fonte: não informada nesta consulta',
  'Período: '+p.period+(p.store?' | loja '+p.store:'')+' — por '+m.label(p.metric)+':'];
 if(!data.rows.length)lines.push('Nenhum vendedor com vendas registradas neste filtro.');
 data.rows.forEach((r,i)=>lines.push((i+1)+'. '+r.name+' (cód. '+r.code+', '+r.store+'): '+m.format(m.measure(r,p.metric),p.metric)+
  (p.metric==='records'?'':' em '+(r.records-r.cancelled)+' vendas não canceladas')));
 if(p.metric==='ticket')lines.push('Somente vendedores com ao menos '+TICKET_MIN_SALES+' vendas não canceladas no período.');
 if(p.metric!=='records')
  lines.push('⚠️ valor_pago é um campo importado do Softcom; não é faturamento líquido nem base de comissão.');
 lines.push(...m.coverageNotes({template:'period',period:p.period,other_period:null,store:p.store},data,sourceDay,coverage));
 lines.push('⚠️ Vendedor identificado por loja (a mesma pessoa em duas lojas aparece duas vezes até a identidade ser validada).',
  '⚠️ Registros importados por código de vendedor, sem conciliação com folha ou ERP/Linx.',
  'Somente leitura. Dados de vendedores visíveis só ao dono.');
 return lines.join('\n');
}
module.exports={TENANT,CONTRACT,RELATION,SELLER_SOURCE,LIMIT,TICKET_MIN_SALES,sourceFromEnv,planQuestion,validateShape,
 validate,sqlFor,execute,reply};
