'use strict';
// A dedicated fixed-target, read-only LotoIA operational pilot. Distinct
// signing identity; app backend pins the Erick tenant and two active stores.
// No access to bets, Pix customer data, notifications, or write operations.
const fs=require('node:fs');
const {createPrivateKey,randomBytes,sign}=require('node:crypto');
const {TextDecoder}=require('node:util');
const APP_ID='68d304fd3c2a6353d2cb0b4d';
const ENDPOINT='/functions/getHermesLotoiaHealth';
const CONTEXT='hermes-lotoia-health-v1';
const EXPECTED_NAMES=Object.freeze(['Erick Lotérica Barreiros','Erick Lotérica Sirinhaém']);
const COVERAGE_NAMES=Object.freeze(['operator_cash','physical_counts',
 'caixa_reports','financial_movements','closures']);
function validEndpoint(url,origin){
 if(typeof url!=='string'||typeof origin!=='string'||
    url.length>450||origin.length>250)return false;
 try{
  const u=new URL(url),o=new URL(origin);
  return u.protocol==='https:'&&o.protocol==='https:'&&
   u.hostname.endsWith('.base44.app')&&!u.username&&!u.password&&
   !o.username&&!o.password&&!u.port&&!o.port&&!u.hash&&!u.search&&
   !o.hash&&!o.search&&o.pathname==='/'&&
   u.origin===o.origin&&u.pathname===ENDPOINT&&
   u.hostname!=='.base44.app';
 }catch{return false;}
}
function signingKey(file){
 if(typeof file!=='string'||!file.startsWith('/')||file.includes('..'))
  throw Error('lotoia_signing_key_missing');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||(stat.mode&0o777)!==0o600||
    stat.size<100||stat.size>8192)throw Error('lotoia_signing_key_unsafe');
  const pem=fs.readFileSync(fd,'utf8');
  const key=createPrivateKey(pem);
  if(key.asymmetricKeyType!=='ed25519')throw Error('lotoia_signing_key_invalid');
  return key;
 }finally{fs.closeSync(fd);}
}
function signedHeaders(key,clock){
 const millis=clock();
 if(!Number.isSafeInteger(millis))throw Error('lotoia_clock_invalid');
 const ts=String(Math.floor(millis/1000));
 const nonce=randomBytes(16).toString('hex');
 const canonical=[CONTEXT,'POST',ENDPOINT,APP_ID,ts,nonce,'{}'].join('\n');
 return {
  'X-Hermes-Read-Timestamp':ts,'X-Hermes-Read-Nonce':nonce,
  'X-Hermes-Read-Signature':sign(null,Buffer.from(canonical),key).toString('base64url')
 };
}
const count=x=>Number.isSafeInteger(x)&&x>=0&&x<=1000000;
const money=x=>typeof x==='number'&&Number.isFinite(x)&&
 x>=0&&x<1e10&&Math.abs(x*100-Math.round(x*100))<0.0001;
function shapeLotoiaHealth(x,{clock=()=>Date.now()}={}){
 if(x?.ok!==true||x.readonly!==true||x.source!=='LotoIA'||
  x.company!=='Grupo Erick'||x.pilot_scope!=='erick_lotericas_2_stores'||
  x.source_state!=='operational_app'||x.qa_included!==false||
  x.store_count!==2||x.write_performed!==false||
  x.notifications_dispatched!==false||x.financial_authority!==false||
  x.real_world_operations_verified!==false||!Array.isArray(x.stores)||
  x.stores.length!==2||!/^\d{4}-\d{2}-\d{2}$/.test(x.as_of||''))
  throw Error('lotoia_contract_invalid');
 const day=Date.parse(x.as_of+'T00:00:00.000Z');
 if(!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==x.as_of)
  throw Error('lotoia_date_invalid');
 const millis=clock();
 const today=new Date(millis).toLocaleDateString('sv-SE',{timeZone:'America/Recife'});
 if(!Number.isSafeInteger(millis)||day>Date.parse(today+'T00:00:00.000Z')||
  Date.parse(today+'T00:00:00.000Z')-day>86400000)
  throw Error('lotoia_snapshot_not_fresh');
 const numberFields=['open_pending_count','amount_unknown_count',
  'unresolved_alert_count','cash_closures_last_7_days'];
 const currencyFields=['open_pending_known_balance_brl'];
 for(const obj of [x,...x.stores]){
  if(numberFields.some(k=>!count(obj[k]))||
   currencyFields.some(k=>!money(obj[k])))
    throw Error('lotoia_numbers_invalid');
 }
 const names=new Set(x.stores.map(s=>s.name));
 if(names.size!==2||EXPECTED_NAMES.some(n=>!names.has(n)))
  throw Error('lotoia_stores_invalid');
 for(const field of [...numberFields,...currencyFields]){
  const sum=x.stores.reduce((a,s)=>a+(field.endsWith('_brl')?
   Math.round(s[field]*100):s[field]),0);
  const total=field.endsWith('_brl')?Math.round(x[field]*100):x[field];
  if(sum!==total)throw Error('lotoia_aggregate_inconsistent');
 }
 const coverage=x.data_coverage;
 if(coverage?.window_days!==7||
  !['no_recent_records','partial_records','sources_present_unverified']
   .includes(coverage.status)||
  coverage.real_world_completeness_verified!==false||
  !count(coverage.stores_with_recent_records)||
  coverage.stores_with_recent_records>2)
   throw Error('lotoia_coverage_invalid');
 function shapeSourceCounts(source){
  if(!source||Object.keys(source).length!==COVERAGE_NAMES.length||
    COVERAGE_NAMES.some(key=>!Object.hasOwn(source,key)||!count(source[key])))
   throw Error('lotoia_coverage_counts_invalid');
  return Object.fromEntries(COVERAGE_NAMES.map(k=>[k,source[k]]));
 }
 const totalCounts=shapeSourceCounts(coverage.recent_source_counts);
 const perStore=x.stores.map(s=>shapeSourceCounts(s.recent_source_counts));
 const active=perStore.filter(c=>COVERAGE_NAMES.some(k=>c[k]>0)).length;
 if(active!==coverage.stores_with_recent_records||
  totalCounts.closures!==x.cash_closures_last_7_days||
  x.stores.some((store,i)=>perStore[i].closures!==store.cash_closures_last_7_days))
   throw Error('lotoia_coverage_inconsistent');
 for(const k of COVERAGE_NAMES){
  if(perStore.reduce((a,c)=>a+c[k],0)!==totalCounts[k])
   throw Error('lotoia_coverage_inconsistent');
 }
 const expectedStatus=active===0?'no_recent_records':
  active===2&&perStore.every(o=>COVERAGE_NAMES.every(k=>o[k]>0))?
   'sources_present_unverified':'partial_records';
 if(coverage.status!==expectedStatus)throw Error('lotoia_coverage_status_invalid');
 const safe={
  source:'LotoIA',company:'Grupo Erick',pilot_scope:x.pilot_scope,
  source_state:x.source_state,qa_included:false,as_of:x.as_of,
  store_count:2,open_pending_count:x.open_pending_count,
  open_pending_known_balance_brl:x.open_pending_known_balance_brl,
  amount_unknown_count:x.amount_unknown_count,
  unresolved_alert_count:x.unresolved_alert_count,
  cash_closures_last_7_days:x.cash_closures_last_7_days,
  stores:EXPECTED_NAMES.map(name=>{
   const z=x.stores.find(a=>a.name===name);
   return {name,...Object.fromEntries([...numberFields,...currencyFields]
    .map(k=>[k,z[k]])),recent_source_counts:shapeSourceCounts(z.recent_source_counts)};
  }),
  data_coverage:{
   window_days:7,status:coverage.status,
   stores_with_recent_records:coverage.stores_with_recent_records,
   recent_source_counts:totalCounts,
   real_world_completeness_verified:false
  },
  write_performed:false,notifications_dispatched:false,
  financial_authority:false,real_world_operations_verified:false
 };
 return Object.freeze(safe);
}
async function readHermesLotoiaHealth({environment=process.env,
 fetchImpl=globalThis.fetch,clock=()=>Date.now()}={}){
 if(environment.HERMES_LOTOIA_READ_ENABLED!=='true'||
  !validEndpoint(environment.HERMES_LOTOIA_FUNCTION_URL,
   environment.HERMES_LOTOIA_ALLOWED_ORIGIN))
  throw Error('lotoia_transport_disabled');
 const key=signingKey(environment.HERMES_LOTOIA_SIGNING_KEY_FILE);
 const response=await fetchImpl(environment.HERMES_LOTOIA_FUNCTION_URL,{
  method:'POST',redirect:'error',
  headers:{...signedHeaders(key,clock),Accept:'application/json',
   'Content-Type':'application/json','User-Agent':'Hermes-LotoIA-Read-Only'},
  body:'{}',signal:AbortSignal.timeout(10000)
 });
 if(response?.status!==200||!response.ok||!response.body)
  throw Error('lotoia_provider_denied');
 if(Number(response.headers?.get?.('content-length')||0)>8192)
  throw Error('lotoia_response_too_large');
 const reader=response.body.getReader(),decoder=new TextDecoder('utf8',{fatal:true});
 let raw='',size=0;
 for(;;){
  const {done,value}=await reader.read();
  if(done)break;
  size+=value.byteLength;
  if(size>8192){await reader.cancel();throw Error('lotoia_response_too_large');}
  raw+=decoder.decode(value,{stream:true});
 }
 raw+=decoder.decode();
 return shapeLotoiaHealth(JSON.parse(raw),{clock});
}
module.exports={APP_ID,ENDPOINT,EXPECTED_NAMES,validEndpoint,
 shapeLotoiaHealth,readHermesLotoiaHealth};
