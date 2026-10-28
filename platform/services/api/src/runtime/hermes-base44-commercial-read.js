'use strict';
// App-owned Base44 function only: no raw entity access, arbitrary URL, or
// external service-role privilege. Disabled without an operator-provisioned
// limited-privilege Base44 USER bearer and explicit app-origin allowlist.
const fs=require('node:fs');
const {createPrivateKey,sign,randomBytes}=require('node:crypto');
const {TextDecoder}=require('node:util');
const APP_ID='69c495eb174a34cc5ccf8577';
const FUNC='getHermesCommercialSummary';
const EXACT_PATH='/functions/'+FUNC;
const APP_ORIGIN='compras-evolucao-copy-5ccf8577.base44.app';
function endpointAllowed(raw) {
 if(typeof raw!=='string'||raw.length>350)return false;
 try{
  const u=new URL(raw);
  return u.protocol==='https:'&&u.username===''&&u.password===''&&
   u.port===''&&u.hash===''&&u.search===''&&
   u.hostname===APP_ORIGIN&&
   u.pathname===EXACT_PATH;
 }catch{return false;}
}
const SIGN_CONTEXT='hermes-compras-aggregate-v1';
function readProtectedSigningKey(filePath) {
 if(typeof filePath!=='string'||!filePath.startsWith('/')||
    filePath.includes('..'))throw Error('signing_key_file_not_configured');
 const fd=fs.openSync(filePath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try {
  const st=fs.fstatSync(fd);
  if(!st.isFile()||(st.mode&0o777)!==0o600||st.size<100||st.size>8192)
   throw Error('signing_key_file_invalid');
  const pem=fs.readFileSync(fd,{encoding:'utf8'});
  const key=createPrivateKey(pem);
  if(key.asymmetricKeyType!=='ed25519')throw Error('signing_key_type_invalid');
  return key;
 }finally{fs.closeSync(fd);}
}
function signedHeaders(signingKey,now=Date.now()) {
 if(!Number.isSafeInteger(now))throw Error('signing_clock_invalid');
 const timestamp=String(Math.floor(now/1000));
 const nonce=randomBytes(16).toString('hex');
 const canonical=[SIGN_CONTEXT,'POST',EXACT_PATH,APP_ID,
  timestamp,nonce,'{}'].join('\n');
 const signature=sign(null,Buffer.from(canonical),signingKey).toString('base64url');
 return Object.freeze({
  'X-Hermes-Read-Timestamp':timestamp,
  'X-Hermes-Read-Nonce':nonce,
  'X-Hermes-Read-Signature':signature
 });
}
const money=(value)=>typeof value==='number'&&Number.isFinite(value)&&
  value>=0&&value<=1e10&&Math.abs(value*100-Math.round(value*100))<0.0001;
const count=(value)=>Number.isSafeInteger(value)&&value>=0&&value<=1e7;
function shapeCommercialData(json){
 if(json?.ok!==true||json?.readonly!==true||
  json.source!=='Compras homologacao'||json.company!=='Grupo Erick'||
  json.source_state!=='homologacao'||json.erp_linx_conciliated!==false||
  !/^\d{4}-\d{2}-\d{2}$/.test(json.as_of||'')||
  !/^\d{4}-\d{2}-\d{2}$/.test(json.purchase_period_start||'')||
  !count(json.active_stores)||json.active_stores<1||json.active_stores>20)
   throw Error('commercial_contract_invalid');
 const keys=['purchases_last_30_days','open_titles','overdue_titles',
  'next_30_days_titles'];
 for(const key of keys){
  const v=json[key];
  const amount=key==='purchases_last_30_days'?'net_brl':'balance_brl';
  if(!v||!count(v.count)||!money(v[amount]))
   throw Error('commercial_contract_invalid');
 }
 if(json.overdue_titles.count>json.open_titles.count||
   json.next_30_days_titles.count>json.open_titles.count||
   json.overdue_titles.balance_brl>json.open_titles.balance_brl+0.01)
  throw Error('commercial_contract_invalid');
 const shaped={
  source:'Compras homologacao',source_state:'homologacao',
  company:'Grupo Erick',erp_linx_conciliated:false,
  as_of:json.as_of,purchase_period_start:json.purchase_period_start,
  active_stores:json.active_stores
 };
 for(const key of keys){
  const item=json[key];
  const field=key==='purchases_last_30_days'?'net_brl':'balance_brl';
  shaped[key]={count:item.count,[field]:item[field]};
 }
 // Optional for historic official-contract versions. When present require
 // all fields, verified scope and counters; absence is NOT zero progress.
 if(Object.hasOwn(json,'reconciliation_work')){
  const r=json.reconciliation_work;
  const fields=['tracked_titles','waiting_documents','in_review',
   'discrepancy_found','review_submitted'];
  if(!r||r.source!=='ReconciliationWorkEvent'||
   r.as_of!==json.as_of||r.erp_linx_conciliated!==false||
   r.payment_recorded!==false||fields.some(k=>!count(r[k]))||
   r.tracked_titles>1e6||
   fields.slice(1).reduce((n,k)=>n+r[k],0)>r.tracked_titles)
   throw Error('commercial_work_contract_invalid');
  const metrics=['missing_named_responsible','work_deadlines_overdue',
   'work_due_next_7','work_without_deadline','with_evidence_reference'];
  const hasMetrics=metrics.some(k=>Object.hasOwn(r,k));
  if(hasMetrics&&(metrics.some(k=>!count(r[k])||r[k]>r.tracked_titles)||
   r.work_deadlines_overdue+r.work_due_next_7+
    r.work_without_deadline>r.tracked_titles))
   throw Error('commercial_work_metrics_invalid');
  shaped.reconciliation_work=Object.freeze({
   source:'ReconciliationWorkEvent',as_of:r.as_of,
   erp_linx_conciliated:false,payment_recorded:false,
   ...Object.fromEntries(fields.map(k=>[k,r[k]])),
   ...(hasMetrics?Object.fromEntries(metrics.map(k=>[k,r[k]])):{})
  });
 }
 // Source-attested full-company aggregate; no title, supplier or PII.
 // Older Base44 versions may omit it, which means unavailable, NOT zero.
 if(Object.hasOwn(json,'reconciliation_priority')){
  const p=json.reconciliation_priority;
  const bands=['overdue_30plus','overdue_1to29','due_next7'];
  if(!p||p.source!=='Duplicate'||p.as_of!==json.as_of||
   p.method!=='days_overdue_and_value_v1'||p.erp_linx_conciliated!==false||
   p.includes_only_open_balance!==true||
   !count(p.overdue_without_work)||p.overdue_without_work>json.overdue_titles.count||
   bands.some(k=>!p[k]||!count(p[k].count)||!money(p[k].balance_brl))||
   p.overdue_30plus.count+p.overdue_1to29.count!==json.overdue_titles.count||
   Math.abs(p.overdue_30plus.balance_brl+p.overdue_1to29.balance_brl-
     json.overdue_titles.balance_brl)>0.001||
   p.due_next7.count>json.next_30_days_titles.count||
   p.due_next7.balance_brl>json.next_30_days_titles.balance_brl+0.001)
   throw Error('commercial_priority_contract_invalid');
  shaped.reconciliation_priority=Object.freeze({
   source:'Duplicate',as_of:p.as_of,method:'days_overdue_and_value_v1',
   erp_linx_conciliated:false,includes_only_open_balance:true,
   overdue_without_work:p.overdue_without_work,
   ...Object.fromEntries(bands.map(k=>[k,Object.freeze({
    count:p[k].count,balance_brl:p[k].balance_brl})]))
  });
 }
 return Object.freeze(shaped);
}
async function readBase44CommercialSummary({
 environment=process.env,fetchImpl=globalThis.fetch
}={}){
 if(environment.HERMES_BASE44_COMMERCIAL_READ_ENABLED!=='true'||
  !endpointAllowed(environment.HERMES_BASE44_COMMERCIAL_FUNCTION_URL))
  throw Error('commercial_transport_disabled');
 // The private signing key stays only on the VPS, never sent to Base44.
 const key=readProtectedSigningKey(
  environment.HERMES_BASE44_COMMERCIAL_SIGNING_KEY_FILE
 );
 const auth=signedHeaders(key);
 const response=await fetchImpl(environment.HERMES_BASE44_COMMERCIAL_FUNCTION_URL,{
  method:'POST',redirect:'error',headers:{
   ...auth,Accept:'application/json',
   'Content-Type':'application/json','User-Agent':'Hermes-Official-Compras-Read'
  },body:'{}',signal:AbortSignal.timeout(10000)
 });
 if(response?.status!==200||!response.ok||!response.body)
  throw Error('commercial_upstream_auth_or_endpoint_failed');
 if(Number(response.headers?.get?.('content-length')||0)>8192)
  throw Error('commercial_response_too_large');
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
 let size=0,raw='';
 for(;;){
  const {done,value}=await reader.read();
  if(done)break;
  size+=value.byteLength;
  if(size>8192){await reader.cancel();throw Error('commercial_response_too_large');}
  raw+=decoder.decode(value,{stream:true});
 }
 raw+=decoder.decode();
 return shapeCommercialData(JSON.parse(raw));
}
module.exports={APP_ID,FUNC,APP_ORIGIN,EXACT_PATH,endpointAllowed,
 shapeCommercialData,readBase44CommercialSummary};
