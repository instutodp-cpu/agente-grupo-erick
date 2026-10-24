'use strict';
// Authorized bounded analytics ONLY. Never accept SQL, schema, customer, or table names from callers.
// The PostgreSQL caller must be a dedicated LOGIN member of hermes_history_reader.
// The role receives only SELECT on hermes_history.daily_sales_v1 (no source table access).
const TENANT='grupo_erick';
const SOURCE='hermes_history.daily_sales_v1';
const PRODUCT_SOURCE='hermes_history.monthly_product_activity_v1';
const MONTHS=Object.freeze(['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06']);
const STORES=Object.freeze(['CALCADOS','SIRINHAEM','MAGAZINE','SPORTS-(DESATIVADO)','ERICK SPORTS','VARIEDADES']);
const FILTER=`FROM hermes_history.daily_sales_v1
WHERE ($1::text IS NULL OR LEFT(sale_day,7) = $1::text)
AND ($2::text IS NULL OR raw_store = $2::text)`;
const SQL=Object.freeze({
 total:`SELECT COALESCE(SUM(registered),0)::bigint AS registered,
COALESCE(SUM(marked_cancelled),0)::bigint AS cancelled, MAX(sale_day) AS last_day ${FILTER}`,
 months:`SELECT LEFT(sale_day,7) AS label, SUM(registered)::bigint AS registered,
SUM(marked_cancelled)::bigint AS cancelled ${FILTER}
GROUP BY LEFT(sale_day,7) ORDER BY label LIMIT 6`,
 stores:`SELECT raw_store AS label, SUM(registered)::bigint AS registered,
SUM(marked_cancelled)::bigint AS cancelled ${FILTER}
GROUP BY raw_store ORDER BY label LIMIT 6`,
 matrix:`SELECT LEFT(sale_day,7) AS month, raw_store,
SUM(registered)::bigint AS registered, SUM(marked_cancelled)::bigint AS cancelled
FROM hermes_history.daily_sales_v1
WHERE sale_day >= '2026-01-01' AND sale_day < '2026-06-09'
GROUP BY LEFT(sale_day,7), raw_store ORDER BY month, raw_store LIMIT 36`,
  products:'SELECT product_code, product_label, item_records, marked_item_cancelled, not_marked_cancelled'+
 ' FROM hermes_history.monthly_product_activity_v1 WHERE month=$1::text'+
 ' ORDER BY not_marked_cancelled DESC, product_code ASC LIMIT 5'
});
function validate({tenant_id,month=null,store=null,shape='total'}={}){
 if(tenant_id!==TENANT)throw Error('history_tenant_denied');
 if(!Object.hasOwn(SQL,shape))throw Error('history_shape_denied');
 if(month!==null&&!MONTHS.includes(month))throw Error('history_month_denied');
 if(store!==null&&!STORES.includes(store))throw Error('history_store_denied');
 if(shape==='products'&&(month===null||store!==null))throw Error('history_product_filter_denied');
 if(shape==='matrix'&&(month!==null||store!==null))throw Error('history_matrix_filter_denied');
 return {month,store,shape};
}
function count(n){
 if(!/^(0|[1-9][0-9]{0,6})$/.test(String(n)))throw Error('history_count_invalid');
 const v=Number(n);
 if(!Number.isSafeInteger(v)||v<0||v>1000000)throw Error('history_count_invalid');
 return v;
}
function parseRow(r,shape){
 if(!r||typeof r!=='object')throw Error('history_bad_row');
 if(shape==='products'){
  const product_code=r.product_code,product_label=r.product_label;
  if(typeof product_code!=='string'||!/^[0-9]{1,12}$/.test(product_code)||
     typeof product_label!=='string'||product_label.length<1||product_label.length>100||
     !/^[\p{L}\p{N} .,:;()\-+\/%ºª°&_'"]+$/u.test(product_label))
   throw Error('history_product_label_denied');
  const item_records=count(r.item_records),
   marked_item_cancelled=count(r.marked_item_cancelled),
   not_marked_cancelled=count(r.not_marked_cancelled);
  if(marked_item_cancelled+not_marked_cancelled!==item_records)
   throw Error('history_product_counts_inconsistent');
  return {product_code,product_label,item_records,marked_item_cancelled,not_marked_cancelled};
 }
 const registered=count(r.registered),cancelled=count(r.cancelled);
 if(shape==='matrix'){
  if(typeof r.month!=='string'||!MONTHS.includes(r.month)||
   typeof r.raw_store!=='string'||!STORES.includes(r.raw_store))
   throw Error('history_matrix_dimension_denied');
  if(cancelled>registered)throw Error('history_matrix_counts_denied');
  return {month:r.month,raw_store:r.raw_store,registered,marked_cancelled:cancelled};
 }
 if(cancelled>registered)throw Error('history_counts_inconsistent');
 if(shape==='total'){
  if(r.last_day!==null&&(typeof r.last_day!=='string'||
   !/^2026-(0[1-6])-[0-3][0-9]$/.test(r.last_day)))
   throw Error('history_last_day_invalid');
  return {registered,marked_cancelled:cancelled,last_day:r.last_day};
 }
 if(typeof r.label!=='string'||!(shape==='stores'?STORES:MONTHS).includes(r.label))
  throw Error('history_unrecognized_dimension');
 return {label:r.label,registered,marked_cancelled:cancelled};
}
async function readHistoricalSales(client,params,now=()=>new Date()){
 const {month,store,shape}=validate(params);
 if(typeof client?.query!=='function')throw Error('history_connection_required');
 const response=await client.query({text:SQL[shape],
  values:shape==='products'?[month]:shape==='matrix'?[]:[month,store],
  query_timeout:5000});
 const rows=response?.rows;
 if(!Array.isArray(rows)||rows.length>(shape==='total'?1:shape==='products'?5:shape==='matrix'?36:6)||
  (shape==='total'&&rows.length!==1))throw Error('history_response_invalid');
 const parsed=rows.map(r=>parseRow(r,shape));
 if(shape!=='total'){
  const seen=new Set();
  for(const r of parsed){
   const key=shape==='products'?r.product_code:shape==='matrix'?r.month+'|'+r.raw_store:r.label;
   if(seen.has(key))throw Error('history_duplicate_dimension');
   seen.add(key);
  }
 }
 const timestamp=now();
 if(!(timestamp instanceof Date)||!Number.isFinite(timestamp.getTime()))
  throw Error('history_timestamp_invalid');
 return Object.freeze({
  tenant_id:TENANT,source_table:shape==='products'?PRODUCT_SOURCE:SOURCE,mode:'online_aggregate',
  queried_at:timestamp.toISOString(),
  filter:{month,raw_store:store},shape,rows:parsed
 });
}
module.exports={TENANT,SOURCE,PRODUCT_SOURCE,MONTHS,STORES,SQL,validate,readHistoricalSales};
