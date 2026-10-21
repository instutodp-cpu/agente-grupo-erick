'use strict';
// Staging-only outbound Telegram long poller: no inbound public port, no LLM,
// no shell/tool execution, no privileged payment/SCM/A3 action.
const fs=require('node:fs');
const path=require('node:path');
const {TextDecoder}=require('node:util');
const {processUpdate,ROUTES}=require('../src/runtime/hermes-telegram-private-channel');
const STATE='/var/lib/hermes-telegram';
const TELEGRAM_ORIGIN='https://api.telegram.org';
const HERMES_ORIGIN='https://hermes-staging.grupoerick.tech';
function readSecret(file){
 if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('..'))
  throw Error('protected_secret_path_required');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||(stat.mode&0o777)!==0o600||
   stat.size<10||stat.size>2048)throw Error('protected_secret_invalid');
  return fs.readFileSync(fd,'utf8').trim();
 }finally{fs.closeSync(fd);}
}
function checkStateDirectory(dir){
 const stat=fs.statSync(dir);
 if(!stat.isDirectory()||(stat.mode&0o777)!==0o700||
  stat.uid!==process.getuid())throw Error('telegram_state_dir_unsafe');
}
function loadState(dir,name){
 const file=path.join(dir,name);
 try{
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
   const st=fs.fstatSync(fd);
   if(!st.isFile()||(st.mode&0o777)!==0o600||st.size>2048)
    throw Error('state_file_unsafe');
   return JSON.parse(fs.readFileSync(fd,'utf8'));
  }finally{fs.closeSync(fd);}
 }catch(e){if(e.code==='ENOENT')return null;throw e;}
}
function saveState(dir,name,data){
 const file=path.join(dir,name),temp=path.join(dir,'.'+name+'.new');
 const fd=fs.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|
  fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{
  fs.writeFileSync(fd,JSON.stringify(data)+'\n');fs.fsyncSync(fd);
 }finally{fs.closeSync(fd);}
 fs.renameSync(temp,file);
 const parent=fs.openSync(dir,fs.constants.O_RDONLY);
 try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
}
function audit(dir,event){
 const content=JSON.stringify(event);
 if(content.length>700||/token|message_text|authorization|bot_key/i.test(content))
  throw Error('audit_content_denied');
 const fd=fs.openSync(path.join(dir,'audit.jsonl'),
  fs.constants.O_APPEND|fs.constants.O_CREAT|fs.constants.O_WRONLY|
  fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,content+'\n');fs.fsyncSync(fd);}
 finally{fs.closeSync(fd);}
}
async function smallJSON(response,maxBytes=65536){
 if(!response?.body||Number(response.headers?.get?.('content-length')||0)>maxBytes)
  throw Error('response_size_denied');
 const decoder=new TextDecoder('utf8',{fatal:true}),reader=response.body.getReader();
 let length=0,text='';
 for(;;){
  const {done,value}=await reader.read();if(done)break;
  length+=value.byteLength;
  if(length>maxBytes){await reader.cancel();throw Error('response_size_denied');}
  text+=decoder.decode(value,{stream:true});
 }
 text+=decoder.decode();
 return JSON.parse(text);
}
function telegramClient(token,fetchImpl=globalThis.fetch){
 if(!/^[0-9]{5,16}:[a-zA-Z0-9_-]{30,120}$/.test(token))
  throw Error('telegram_bot_token_invalid');
 return async(method,payload)=>{
  if(!['getMe','getWebhookInfo','getUpdates','sendMessage'].includes(method))
   throw Error('telegram_api_method_denied');
  const res=await fetchImpl(TELEGRAM_ORIGIN+'/bot'+token+'/'+method,{
   method:'POST',redirect:'error',
   headers:{'Content-Type':'application/json','Accept':'application/json'},
   body:JSON.stringify(payload),signal:AbortSignal.timeout(25000)
  });
  if(res.status!==200||!res.ok)throw Error('telegram_provider_unavailable');
  const json=await smallJSON(res);
  if(json.ok!==true)throw Error('telegram_provider_not_ok');
  return json.result;
 };
}
function hermesClient(machineToken,fetchImpl=globalThis.fetch){
 if(!/^[A-Za-z0-9._~-]{20,250}$/.test(machineToken))
  throw Error('machine_identity_invalid');
 return async(intent,route)=>{
  if(!Object.hasOwn(ROUTES,intent)||ROUTES[intent]!==route)
   throw Error('hermes_resource_denied');
  const r=await fetchImpl(HERMES_ORIGIN+route,{
   method:'GET',redirect:'error',
   headers:{Authorization:'Bearer '+machineToken,Accept:'application/json'},
   signal:AbortSignal.timeout(16000)
  });
  if(intent==='status')return r.status===200&&r.ok;
  if(r.status===429)return {denied_status:'request_budget_exhausted'};
  if(r.status!==200||!r.ok)throw Error('hermes_read_unavailable');
  return smallJSON(r,16384);
 };
}
async function pollOnce({stateDir,api,query,clock=()=>Date.now()}){
 checkStateDirectory(stateDir);
 const offsetRecord=loadState(stateDir,'offset.json');
 const offset=offsetRecord?.offset??0;
 if(!Number.isSafeInteger(offset)||offset<0)throw Error('telegram_offset_invalid');
 const updates=await api('getUpdates',{
  offset,limit:5,timeout:12,allowed_updates:['message']
 });
 if(!Array.isArray(updates)||updates.length>5)throw Error('update_batch_invalid');
 let current=offset,handled=0;
 for(const item of updates){
  if(!Number.isSafeInteger(item?.update_id)||item.update_id<current)
   throw Error('telegram_update_order_invalid');
  // Durable ingress reservation without message body or Telegram identity.
  audit(stateDir,{at:new Date(clock()).toISOString(),
   event:'ingress',update_id:item.update_id});
  const owner=loadState(stateDir,'owner.json');
  const pairing=loadState(stateDir,'pairing.json');
  // Claim an update before outbound queries. A failed reply will not trigger
  // a repeated provider read on restart.
  current=item.update_id+1;
  saveState(stateDir,'offset.json',{offset:current});
  const result=await processUpdate({
   update:item,ownerId:owner?.owner_id??null,pairing,
   clock,query,
   send:(chatId,text)=>api('sendMessage',{chat_id:chatId,text,
    disable_web_page_preview:true}),
   savePairing:next=>saveState(stateDir,'pairing.json',next),
   saveOwner:id=>{
    if(owner!==null||loadState(stateDir,'owner.json')!==null)
     throw Error('telegram_owner_already_bound');
    saveState(stateDir,'owner.json',{owner_id:id,bound_at:clock()});
   }
  });
  audit(stateDir,{at:new Date(clock()).toISOString(),
   event:'outcome',update_id:item.update_id,
   outcome:result.kind,intent:result.intent||null});
  handled++;
 }
 return {handled,next_offset:current};
}
async function runForever({environment=process.env,fetchImpl=globalThis.fetch,
 clock=()=>Date.now()}={}){
 if(environment.HERMES_TELEGRAM_ENABLED!=='true'||
  environment.HERMES_DEPLOYMENT_STAGE!=='staging'||
  environment.HERMES_EXECUTION_ENABLED!=='false'||
  environment.HERMES_EXECUTION_KILL_SWITCH!=='true'||
  environment.HERMES_MISSION_INGRESS_ENABLED!=='false')
  throw Error('telegram_channel_disabled');
 const dir=environment.HERMES_TELEGRAM_STATE_DIR||STATE;
 checkStateDirectory(dir);
 const botToken=readSecret(environment.HERMES_TELEGRAM_TOKEN_FILE);
 const machineToken=readSecret(environment.HERMES_TELEGRAM_MACHINE_IDENTITY_FILE);
 const api=telegramClient(botToken,fetchImpl);
 const query=hermesClient(machineToken,fetchImpl);
 const identity=await api('getMe',{});
 if(identity?.is_bot!==true||!Number.isSafeInteger(identity?.id)||
    String(identity?.username||'').toLowerCase()!=='grupoerick_bot')
  throw Error('telegram_bot_identity_invalid');
 const hook=await api('getWebhookInfo',{});
 if(hook?.url)throw Error('telegram_webhook_conflict');
 audit(dir,{at:new Date(clock()).toISOString(),event:'gateway_started',
  stage:'staging',writes_enabled:false});
 for(;;)await pollOnce({stateDir:dir,api,query,clock});
}
if(require.main===module){
 runForever().catch(()=>{console.error('hermes_telegram_channel_stopped_fail_closed');
  process.exitCode=1;});
}
module.exports={checkStateDirectory,readSecret,loadState,saveState,audit,
 smallJSON,telegramClient,hermesClient,pollOnce,runForever};
