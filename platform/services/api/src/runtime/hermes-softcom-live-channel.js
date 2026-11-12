'use strict';
// Explicit Grupo Erick aggregate query grammar. This is not an NL-to-SQL executor.
const {MONTHS,STORES,TENANT,SOURCE,PRODUCT_SOURCE}=require('./hermes-softcom-live-reader');
const number=new Intl.NumberFormat('pt-BR');
const monthMap=Object.freeze({janeiro:'01',fevereiro:'02',marco:'03',abril:'04',maio:'05',junho:'06'});
function parseSalesCommand(text){
 if(typeof text!=='string'||text.length>160)return null;
 const clean=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
 let m=clean.match(/^\/produtos(?:@\w+)?\s+(2026-0[1-6])$/);
 if(m)return {tenant_id:TENANT,month:m[1],shape:'products'};
 m=clean.match(/^produtos com mais registros (?:em|de)\s+(janeiro|fevereiro|marco|abril|maio|junho)(?: de 2026)?\??$/);
 if(m)return {tenant_id:TENANT,month:'2026-'+monthMap[m[1]],shape:'products'};
 m=clean.match(/^\/vendas(?:@\w+)?\s+(2026-0[1-6])$/);
 if(m)return {tenant_id:TENANT,month:m[1],shape:'total'};
 m=clean.match(/^\/vendas(?:@\w+)?\s+lojas\s+(2026-0[1-6])$/);
 if(m)return {tenant_id:TENANT,month:m[1],shape:'stores'};
 m=clean.match(/^\/vendas(?:@\w+)?\s+meses$/);
 if(m)return {tenant_id:TENANT,shape:'months'};
 m=clean.match(/^\/vendas(?:@\w+)?\s+loja\s+(.+?)\s+(2026-0[1-6])$/);
 if(m){
  const store=STORES.find(s=>s.toLowerCase()===m[1]);
  return store?{tenant_id:TENANT,store,month:m[2],shape:'total'}:null;
 }
 m=clean.match(/^(?:quantas vendas (?:em|de)|vendas de|resumo de vendas de)\s+(janeiro|fevereiro|marco|abril|maio|junho)(?: de 2026)?\??$/);
 if(m)return {tenant_id:TENANT,month:'2026-'+monthMap[m[1]],shape:'total'};
 m=clean.match(/^vendas por loja (?:em|de)\s+(janeiro|fevereiro|marco|abril|maio|junho)(?: de 2026)?\??$/);
 if(m)return {tenant_id:TENANT,month:'2026-'+monthMap[m[1]],shape:'stores'};
 return null;
}
function historicalLiveReply(data,requested){
 if(!requested||!data||data.tenant_id!==TENANT||
  data.source_table!==(data.shape==='products'?PRODUCT_SOURCE:SOURCE)||
  data.mode!=='online_aggregate'||!MONTHS.every(s=>typeof s==='string')||
  !['total','months','stores','products'].includes(data.shape)||
  data.filter?.month!==(requested.month||null)||
  data.filter?.raw_store!==(requested.store||null)||
  data.shape!==(requested.shape||'total')||
  !Number.isFinite(Date.parse(data.queried_at))||!Array.isArray(data.rows)||
  data.rows.length>(data.shape==='products'?5:6))throw Error('historical_live_unverified');
 const header=[data.shape==='products'?
  '📦 Atividade histórica de produtos — Grupo Erick':'📈 Vendas históricas — Grupo Erick (consulta ao banco)',
  'Fonte: Supabase softcom-grupo-erick / '+data.source_table,
  'Consulta em: '+new Date(data.queried_at).toLocaleString('pt-BR',{timeZone:'America/Recife',hour12:false}),
  'Período disponível: jan–8 jun/2026; junho parcial; julho ausente',
  'Filtro: '+(requested.month||'jan–jun/2026')+
    (requested.store?' | código de loja: '+requested.store:'')];
 if(data.shape==='products'){
  if(!MONTHS.includes(requested.month)||requested.store!==undefined)
   throw Error('historical_product_filter_invalid');
  header.push('Produtos com mais registros de itens não marcados como cancelados:');
  if(!data.rows.length)header.push('Nenhum produto encontrado neste período.');
  const seen=new Set();
  let previous=Infinity;
  for(const r of data.rows){
   if(typeof r.product_code!=='string'||!/^[0-9]{1,12}$/.test(r.product_code)||
    typeof r.product_label!=='string'||r.product_label.length<1||r.product_label.length>100||
    !/^[\p{L}\p{N} .,:;()\-+\/%ºª°&_'"]+$/u.test(r.product_label)||
    seen.has(r.product_code)||
    !Number.isSafeInteger(r.item_records)||!Number.isSafeInteger(r.marked_item_cancelled)||
    !Number.isSafeInteger(r.not_marked_cancelled)||
    r.item_records<0||r.marked_item_cancelled<0||r.not_marked_cancelled<0||
    r.marked_item_cancelled+r.not_marked_cancelled!==r.item_records||
    r.not_marked_cancelled>previous)throw Error('historical_product_invalid');
   seen.add(r.product_code);previous=r.not_marked_cancelled;
   header.push('• '+r.product_label+' (cód. '+r.product_code+'): '+
    number.format(r.not_marked_cancelled)+' registros não marcados cancelados');
  }
  header.push('⚠️ Ranking por registros de itens; NÃO unidades líquidas vendidas, faturamento ou estoque atual.',
   'Período histórico, sem conciliação de devoluções. Não há dados individuais de clientes.');
  return header.join('\n');
 }
 if(data.shape==='total'){
  const r=data.rows[0];
  if(!r||!Number.isSafeInteger(r.registered)||!Number.isSafeInteger(r.marked_cancelled)||
   r.registered<0||r.marked_cancelled<0||r.marked_cancelled>r.registered)
   throw Error('historical_live_total_invalid');
  header.push('Registros: '+number.format(r.registered),
   'Marcados como cancelados: '+number.format(r.marked_cancelled),
   'Não marcados como cancelados: '+number.format(r.registered-r.marked_cancelled));
 }else{
  const validLabels=data.shape==='months'?MONTHS:STORES;
  const seen=new Set();
  for(const r of data.rows){
   if(!validLabels.includes(r.label)||seen.has(r.label)||
    !Number.isSafeInteger(r.registered)||!Number.isSafeInteger(r.marked_cancelled)||
    r.registered<0||r.marked_cancelled<0||r.marked_cancelled>r.registered)
    throw Error('historical_live_dimension_invalid');
   seen.add(r.label);
   header.push('• '+r.label+': '+number.format(r.registered)+' registros ('+
    number.format(r.marked_cancelled)+' marcados cancelados)');
  }
 }
 header.push('⚠️ Registros, NÃO faturamento nem vendas líquidas. Códigos de lojas não conciliados.',
  'Consulta parametrizada somente leitura; sem dados individuais de clientes.');
 return header.join('\n');
}
module.exports={parseSalesCommand,historicalLiveReply};
