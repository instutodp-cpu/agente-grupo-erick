'use strict';
// Staging-only outbound Telegram long poller: no inbound public port, no LLM,
// no shell/tool execution, no privileged payment/SCM/A3 action.
const fs=require('node:fs');
const path=require('node:path');
const {TextDecoder}=require('node:util');
const {processUpdate,ROUTES}=require('../src/runtime/hermes-telegram-private-channel');
const {readHistoricalSales}=require('../src/runtime/hermes-softcom-live-reader');
const analyst=require('../src/runtime/hermes-analyst-templates');
const governed=require('../src/runtime/hermes-governed-agent');
const businessMemory=require('../src/runtime/hermes-business-evidence-memory');
const ownerDecisions=require('../src/runtime/hermes-owner-decision-memory');
const {hermesReply}=require('../src/runtime/hermes-telegram-private-channel');
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
   const limit=name==='history-analyst-cache.json'?16384:
    ['business-evidence-memory.json','owner-decisions.json'].includes(name)?32768:2048;
   if(!st.isFile()||(st.mode&0o777)!==0o600||st.size>limit)
    throw Error('state_file_unsafe');
   return JSON.parse(fs.readFileSync(fd,'utf8'));
  }finally{fs.closeSync(fd);}
 }catch(e){if(e.code==='ENOENT')return null;throw e;}
}
function saveState(dir,name,data){
 const file=path.join(dir,name),temp=path.join(dir,'.'+name+'.new');
 const serialized=JSON.stringify(data)+'\n';
 const limit=name==='history-analyst-cache.json'?16384:
    ['business-evidence-memory.json','owner-decisions.json'].includes(name)?32768:2048;
 if(Buffer.byteLength(serialized,'utf8')>limit)throw Error('state_file_too_large');
 const fd=fs.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|
  fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{
  fs.writeFileSync(fd,serialized);fs.fsyncSync(fd);
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
function createLiveQuery(environment,driverLoader=()=>require('pg')){
 if(environment.HERMES_HISTORY_LIVE_ENABLED!=='true')
  return async()=>{throw Error('history_live_disabled')};
 if(environment.HERMES_DEPLOYMENT_STAGE!=='staging'||
    environment.HERMES_EXECUTION_ENABLED!=='false'||
    environment.HERMES_EXECUTION_KILL_SWITCH!=='true')
  throw Error('history_live_stage_denied');
 const host=environment.HERMES_HISTORY_POOLER_HOST;
 // The shared session-pooler cluster index is project-specific: never guess it.
 if(typeof host!=='string'||!/^aws-[0-9]+-sa-east-1\.pooler\.supabase\.com$/.test(host))
  throw Error('history_pooler_host_unverified');
 const password=readSecret(environment.HERMES_HISTORY_PASSWORD_FILE);
 const ca=readSecret(environment.HERMES_HISTORY_CA_FILE);
 if(!ca.startsWith('-----BEGIN CERTIFICATE-----')||
    !ca.endsWith('-----END CERTIFICATE-----'))
  throw Error('history_tls_ca_invalid');
 if(password.length<50||password.length>150)
  throw Error('history_password_invalid');
 const driver=driverLoader();
 if(typeof driver?.Client!=='function')throw Error('history_db_driver_missing');
 return async params=>{
  const client=new driver.Client({
   host,port:5432,database:'postgres',
   user:'hermes_history_login.yxmdrrwqxwzsdgcgskrm',
   password,ssl:{rejectUnauthorized:true,ca},
   application_name:'hermes-history-staging-v1',
   connectionTimeoutMillis:4000,query_timeout:5000,
   statement_timeout:5000,options:'-c default_transaction_read_only=on'
  });
  try{
   await client.connect();
   return params?.shape==='analyst'?
    await analyst.execute(client,params.plan):
    await readHistoricalSales(client,params);
  }finally{await client.end().catch(()=>{});}
 };
}
async function pollOnce({stateDir,api,query,clock=()=>Date.now(),
 readLive=async()=>{throw Error('history_live_disabled')},liveEnabled=false,
 agentModel=null}){
 checkStateDirectory(stateDir);
 const offsetRecord=loadState(stateDir,'offset.json');
 const offset=offsetRecord?.offset??0;
 if(!Number.isSafeInteger(offset)||offset<0)throw Error('telegram_offset_invalid');
 const updates=await api('getUpdates',{
  offset,limit:5,timeout:12,allowed_updates:['message']
 });
 if(!Array.isArray(updates)||updates.length>5)throw Error('update_batch_invalid');
 // Authenticated polling heartbeat: genuine Telegram API response, not an HTTP
 // port healthcheck inherited from the unrelated Hermes API image.
 saveState(stateDir,'heartbeat.json',{at:clock()});
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
   readDecisions:()=>{
    const data=loadState(stateDir,'owner-decisions.json');
    return ownerDecisions.validateStore(data,clock());
   },
   writeDecisions:store=>{
    ownerDecisions.validateStore(store,clock());
    saveState(stateDir,'owner-decisions.json',store);
   },
   readHistory:()=>loadState(stateDir,'history-softcom.json'),
   readLive:async params=>{
    if(!liveEnabled)throw Error('history_live_disabled');
    if(typeof params!=='object'||params?.tenant_id!=='grupo_erick')
     throw Error('history_live_params_denied');
    const today=new Date(clock()).toISOString().slice(0,10);
    const record=loadState(stateDir,'history-live-budget.json');
    if(record&&(!/^20\d{2}-\d{2}-\d{2}$/.test(record.date)||
      !Number.isInteger(record.count)||record.count<0||
      record.count>24))throw Error('history_live_budget_invalid');
    const count=record?.date===today?record.count:0;
    const cap=params?.shape==='analyst'?24:8;
    if(count>=cap)return {denied_status:'history_budget_exhausted'};
    // Claim before hitting network; never retry reads due to failed writes/crashes.
    saveState(stateDir,'history-live-budget.json',{date:today,count:count+1});
    return readLive(params);
   },

   agentEnabled:agentModel!==null,
   readAgent:async goal=>{
    if(!agentModel||!liveEnabled)throw Error('agent_not_enabled');
    const today=new Date(clock()).toISOString().slice(0,10);
    const budget=loadState(stateDir,'agent-llm-budget.json');
    if(budget&&(!/^20\d{2}-\d{2}-\d{2}$/.test(budget.date)||
      !Number.isInteger(budget.turns)||budget.turns<0||budget.turns>4))
     throw Error('agent_llm_budget_invalid');
    const turns=budget?.date===today?budget.turns:0;
    if(turns>=4)throw Error('agent_daily_quota');
    // Reserve 2 LLM calls before any provider request, never retry after crash.
    saveState(stateDir,'agent-llm-budget.json',{date:today,turns:turns+1});
    return governed.runTurn({
     goal,model:agentModel,
     readBusinessContext:question=>businessMemory.context(
      loadState(stateDir,'business-evidence-memory.json'),question,clock()),
     readDecisionContext:question=>ownerDecisions.context(
      loadState(stateDir,'owner-decisions.json'),question,clock()),
     readHistory:async plan=>{
      const record=loadState(stateDir,'history-live-budget.json');
      if(record&&(!/^20\d{2}-\d{2}-\d{2}$/.test(record.date)||
        !Number.isInteger(record.count)||record.count<0||record.count>24))
       throw Error('agent_history_budget_invalid');
      const n=record?.date===today?record.count:0;
      if(n>=24)throw Error('agent_history_quota');
      saveState(stateDir,'history-live-budget.json',{date:today,count:n+1});
      const data=await readLive({shape:'analyst',tenant_id:'grupo_erick',plan});
      // Only aggregated, source-checked evidence is remembered. Never write
      // Telegram message bodies, model recommendations or personal data.
      try{
       const existing=loadState(stateDir,'business-evidence-memory.json');
       const updated=businessMemory.observe(existing,data,plan,clock());
       saveState(stateDir,'business-evidence-memory.json',updated);
      }catch{} // optional memory; valid SQL result remains authoritative
      return data;
     },
     readCommercial:async()=>{
      const data=await query('compras',ROUTES.compras);
      if(data?.denied_status)throw Error('agent_commercial_unavailable');
      return hermesReply('compras',data);
     }
    });
   },
   readAnalystContext:()=>loadState(stateDir,'history-analyst-context.json'),
   writeAnalystContext:ctx=>saveState(stateDir,'history-analyst-context.json',ctx),
   readAnalyst:async plan=>{
    if(!liveEnabled)throw Error('history_live_disabled');
    analyst.validate(plan);
    const hash=require('node:crypto').createHash('sha256').update(JSON.stringify(plan)).digest('hex').slice(0,24);
    const saved=loadState(stateDir,'history-analyst-cache.json');
    if(saved&&(!Array.isArray(saved.entries)||saved.entries.length>30))throw Error('analyst_cache_invalid');
    const hit=saved?.entries?.find(x=>x.key===hash);
    if(hit&&Number.isSafeInteger(hit.at)&&clock()-hit.at>=0&&clock()-hit.at<=6*3600000){
     analyst.reply(hit.data,plan);
     return {...hit.data,cached:true};
    }
    const data=await (async()=>{
     const today=new Date(clock()).toISOString().slice(0,10);
     const budget=loadState(stateDir,'history-live-budget.json');
     if(budget&&(!/^20\d{2}-\d{2}-\d{2}$/.test(budget.date)||
       !Number.isInteger(budget.count)||budget.count<0||budget.count>24))throw Error('history_live_budget_invalid');
     const count=budget?.date===today?budget.count:0;
     if(count>=24)return {denied_status:'history_budget_exhausted'};
     saveState(stateDir,'history-live-budget.json',{date:today,count:count+1});
     return readLive({shape:'analyst',tenant_id:'grupo_erick',plan});
    })();
    if(data.denied_status)return data;
    analyst.reply(data,plan);
    const entries=(saved?.entries||[]).filter(x=>x.key!==hash&&Number.isSafeInteger(x.at)&&clock()-x.at<=6*3600000).slice(-19);
    entries.push({key:hash,at:clock(),data});
    while(entries.length>1&&Buffer.byteLength(JSON.stringify({entries}),'utf8')>15000)
     entries.shift();
    if(Buffer.byteLength(JSON.stringify({entries}),'utf8')<=15000){
     try{saveState(stateDir,'history-analyst-cache.json',{entries});}
     catch{} // cache is optional; never invalidate a verified answer
    }
    return data;
   },
   readCache:intent=>loadState(stateDir,'cache-'+intent+'.json'),
   writeCache:(intent,record)=>saveState(stateDir,'cache-'+intent+'.json',record),
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
   outcome:result.kind,intent:result.intent||null,
   cache:result.cache||null,
   ...(result.llm_calls===1||result.llm_calls===2?
    {llm_calls:result.llm_calls,planning_policy:result.planning_policy}: {})});
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
 const readLive=createLiveQuery(environment);
 const loginEnabled=environment.HERMES_AGENT_LLM_ENABLED==='true';
 const agentModel=environment.HERMES_AGENT_PROVIDER==='codex-login'?
  require('../src/runtime/hermes-codex-login-bridge').createCodexModel({
   enabled:loginEnabled,stage:environment.HERMES_DEPLOYMENT_STAGE,
   killSwitch:environment.HERMES_EXECUTION_KILL_SWITCH==='true',
   socketPath:environment.HERMES_CODEX_SOCKET
  }):
  governed.createModel({
   enabled:loginEnabled,stage:environment.HERMES_DEPLOYMENT_STAGE,
   killSwitch:environment.HERMES_EXECUTION_KILL_SWITCH==='true',
   model:environment.HERMES_AGENT_MODEL,
   key:loginEnabled?readSecret(environment.HERMES_AGENT_KEY_FILE):null,
   fetchImpl
  });
 const identity=await api('getMe',{});
 if(identity?.is_bot!==true||!Number.isSafeInteger(identity?.id)||
    String(identity?.username||'').toLowerCase()!=='grupoerick_bot')
  throw Error('telegram_bot_identity_invalid');
 const hook=await api('getWebhookInfo',{});
 if(hook?.url)throw Error('telegram_webhook_conflict');
 audit(dir,{at:new Date(clock()).toISOString(),event:'gateway_started',
  stage:'staging',writes_enabled:false});
 for(;;)await pollOnce({stateDir:dir,api,query,clock,readLive,agentModel,
  liveEnabled:environment.HERMES_HISTORY_LIVE_ENABLED==='true'});
}
if(require.main===module){
 runForever().catch(()=>{console.error('hermes_telegram_channel_stopped_fail_closed');
  process.exitCode=1;});
}
module.exports={checkStateDirectory,readSecret,loadState,saveState,audit,
 smallJSON,telegramClient,hermesClient,createLiveQuery,pollOnce,runForever};
