'use strict';
// Owner-only cross-tab built exclusively from the pre-authorized aggregate view.
// No direct source-table privilege, no persisted MCP payload, no model call.
const history=require('./hermes-softcom-live-reader');
const {formatRate}=require('./hermes-owner-diagnostic');
const n=new Intl.NumberFormat('pt-BR');
const MONTHS=history.MONTHS,STORES=history.STORES;
function render({snapshot,aggregate,validSnapshot,now=Date.now()}){
 if(!Number.isSafeInteger(now)||typeof validSnapshot!=='function'||
 !validSnapshot(snapshot,now))throw Error('matrix_snapshot_denied');
 if(!aggregate||aggregate.tenant_id!=='grupo_erick'||
 aggregate.source_table!=='hermes_history.daily_sales_v1'||
 aggregate.mode!=='online_aggregate'||aggregate.shape!=='matrix'||
 aggregate.filter?.month!==null||aggregate.filter?.raw_store!==null||
 !Number.isFinite(Date.parse(aggregate.queried_at))||
 Date.parse(aggregate.queried_at)>now+60000||
 !Array.isArray(aggregate.rows)||aggregate.rows.length<1||aggregate.rows.length>36)
 throw Error('matrix_source_denied');
 const slots=new Map();
 for(const x of aggregate.rows){
  if(!x||Object.keys(x).sort().join('|')!==
   ['month','raw_store','registered','marked_cancelled'].sort().join('|')||
   !MONTHS.includes(x.month)||!STORES.includes(x.raw_store)||
   !Number.isSafeInteger(x.registered)||x.registered<1||
   !Number.isSafeInteger(x.marked_cancelled)||x.marked_cancelled<0||
   x.marked_cancelled>x.registered)throw Error('matrix_cell_denied');
  const key=x.month+'|'+x.raw_store;
  if(slots.has(key))throw Error('matrix_duplicate_denied');
  slots.set(key,x);
 }
 const cell=(month,store)=>slots.get(month+'|'+store)||{
  registered:0,marked_cancelled:0};
 for(const m of snapshot.months){
  let registered=0,cancelled=0;
  for(const code of STORES){
   const r=cell(m.month,code);
   registered+=r.registered;cancelled+=r.marked_cancelled;
  }
  if(registered!==m.registered||cancelled!==m.marked_cancelled)
   throw Error('matrix_month_reconciliation_denied');
 }
 for(const s of snapshot.stores){
  let registered=0,cancelled=0;
  for(const month of MONTHS){
   const r=cell(month,s.raw_label);
   registered+=r.registered;cancelled+=r.marked_cancelled;
  }
  if(registered!==s.registered||cancelled!==s.marked_cancelled)
   throw Error('matrix_store_reconciliation_denied');
 }
 const stamp=new Date(aggregate.queried_at).toLocaleString('pt-BR',{
  timeZone:'America/Recife',hour12:false});
 const labels=['Jan','Fev','Mar','Abr','Mai','Jun*'];
 const lines=[
  '🧩 Hermes — mês × código Softcom (sem IA)',
  'Fonte: hermes_history.daily_sales_v1 (agregada, somente leitura)',
  'Consultado em: '+stamp,
  'Jan–8 jun/2026; junho parcial. Julho não disponível.',
  'Cancelados/total por mês e código:',
  ...STORES.map(code=>[code, ...MONTHS.map((month,i)=>{
   const r=cell(month,code);
   return labels[i]+' '+r.marked_cancelled+'/'+r.registered;
  })].join(' | ')),
  'Total verificado: '+n.format(snapshot.marked_cancelled)+'/'+
   n.format(snapshot.registered)+' ('+
   formatRate(snapshot.marked_cancelled,snapshot.registered)+')',
  'Abr → Mai: variação no NÚMERO de cancelados por código:',
  ...STORES.map(code=>{
   const old=cell('2026-04',code).marked_cancelled;
   const fresh=cell('2026-05',code).marked_cancelled;
   return '• '+code+': '+n.format(old)+' → '+n.format(fresh)+
    ' ('+(fresh-old>=0?'+':'')+n.format(fresh-old)+')';
  }),
  'Conciliação: 6 totais mensais e 6 totais por código coincidem com o snapshot privado.',
  '⚠️ São registros marcados cancelados, NÃO faturamento, perda ou causa.',
  'Códigos de origem não conciliados com as unidades físicas.',
  'Sem motivo de cancelamento verificado nesta visão; não inferir causa.',
  'Nenhuma escrita, SQL livre, modelo ou ação empresarial.'
 ];
 const out=lines.join('\n');
 if(out.length>3300)throw Error('matrix_output_oversize');
 return out;
}
module.exports={render};