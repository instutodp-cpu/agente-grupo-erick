'use strict';
// One external official BCB read. No general web browsing, no credentials,
// no arbitrary URL, no write, and no inference about unpublished future data.
const {TextDecoder}=require('node:util');
const INDICATORS=Object.freeze({
 selic:Object.freeze({series:432,title:'Meta Selic Copom',unit:'percent_per_year',
  maxAgeDays:14}),
 ipca:Object.freeze({series:433,title:'IPCA mensal',unit:'percent_per_month',
  maxAgeDays:95})
});
function decodeRecordDate(raw){
 if(typeof raw!=='string'||!/^\d{2}\/\d{2}\/\d{4}$/.test(raw))return null;
 const [dd,mm,yyyy]=raw.split('/').map(Number);
 const d=new Date(Date.UTC(yyyy,mm-1,dd));
 return d.getUTCFullYear()===yyyy&&d.getUTCMonth()===mm-1&&d.getUTCDate()===dd?
  d:null;
}
async function readBcbEconomicIndicator({
 kind,fetchImpl=globalThis.fetch,clock=()=>Date.now()
}={}){
 const definition=Object.hasOwn(INDICATORS,kind)?INDICATORS[kind]:null;
 if(!definition||typeof fetchImpl!=='function')throw Error('bcb_kind_not_allowed');
 const now=clock();
 if(!Number.isSafeInteger(now))throw Error('bcb_clock_unavailable');
 const todayLocal=new Date(now).toLocaleDateString('sv-SE',{
  timeZone:'America/Recife'});
 if(!/^\d{4}-\d{2}-\d{2}$/.test(todayLocal))
  throw Error('bcb_local_date_invalid');
 const today=Date.parse(todayLocal+'T00:00:00.000Z');
 const url='https://api.bcb.gov.br/dados/serie/bcdata.sgs.'+
  definition.series+'/dados/ultimos/20?formato=json';
 const response=await fetchImpl(url,{method:'GET',redirect:'error',
  headers:{Accept:'application/json','User-Agent':'Hermes-Economy-Read-Pilot'},
  signal:AbortSignal.timeout(8000)});
 if(response?.status!==200||!response.ok||!response.body)
  throw Error('bcb_provider_unavailable');
 if(Number(response.headers?.get?.('content-length')||0)>8192)
  throw Error('bcb_response_too_large');
 const reader=response.body.getReader(),decoder=new TextDecoder('utf8',{fatal:true});
 let size=0,body='';
 for(;;){
  const {done,value}=await reader.read();
  if(done)break;
  size+=value.byteLength;
  if(size>8192){await reader.cancel();throw Error('bcb_response_too_large');}
  body+=decoder.decode(value,{stream:true});
 }
 body+=decoder.decode();
 const data=JSON.parse(body);
 if(!Array.isArray(data)||data.length<1||data.length>20)
  throw Error('bcb_series_invalid');
 const usable=[];
 for(const row of data){
  const date=decodeRecordDate(row?.data);
  if(!date||typeof row?.valor!=='string'||
   !/^-?\d{1,3}(?:\.\d{1,4})?$/.test(row.valor))
   throw Error('bcb_row_invalid');
  const rate=Number(row.valor);
  if(!Number.isFinite(rate)||rate< -20||rate>100)
   throw Error('bcb_rate_out_of_bounds');
  // BCB may return future-dated planned entries for series 432.
  // Ignore them completely, never report them as already effective.
  if(date.getTime()<=today)usable.push({date,rate});
 }
 usable.sort((a,b)=>b.date-a.date);
 const latest=usable[0];
 if(!latest||today-latest.date.getTime()>
    definition.maxAgeDays*86400000)
  throw Error('bcb_fresh_observation_unavailable');
 return Object.freeze({
  source:'BCB_SGS',series_code:definition.series,
  indicator:kind,title:definition.title,unit:definition.unit,
  value:latest.rate,observation_date:latest.date.toISOString().slice(0,10),
  as_of_date:todayLocal,records_examined:data.length,
  future_records_ignored:data.length-usable.length,
  simulated:false,write_performed:false,production_used:false
 });
}
module.exports={INDICATORS,readBcbEconomicIndicator};
