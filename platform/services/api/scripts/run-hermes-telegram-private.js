'use strict';
// Staging-only outbound Telegram long poller: no inbound public port, no LLM,
// no shell/tool execution, no privileged payment/SCM/A3 action.
const fs=require('node:fs');
const path=require('node:path');
const {TextDecoder}=require('node:util');
const {processUpdate,ROUTES}=require('../src/runtime/hermes-telegram-private-channel');
const {readHistoricalSales}=require('../src/runtime/hermes-softcom-live-reader');
const analyst=require('../src/runtime/hermes-analyst-templates');
const coverageModel=require('../src/runtime/hermes-history-coverage');
const receivables=require('../src/runtime/hermes-receivables-templates');
const sellerTemplates=require('../src/runtime/hermes-seller-templates');
const governed=require('../src/runtime/hermes-governed-agent');
const businessMemory=require('../src/runtime/hermes-business-evidence-memory');
const autoMemory=require('../src/runtime/hermes-automemory-curator');
const brainReader=require('../src/runtime/hermes-brain-telegram-reader');
const codexFallback=require('../src/runtime/hermes-codex-fallback');
const openRouter=require('../src/runtime/hermes-openrouter-secondary');
const ownerDecisions=require('../src/runtime/hermes-owner-decision-memory');
const answerCache=require('../src/runtime/hermes-verified-answer-cache');
const finops=require('../src/runtime/hermes-inference-finops');
const {hermesReply}=require('../src/runtime/hermes-telegram-private-channel');
const morningBrief=require('../src/runtime/hermes-morning-brief');
const STATE='/var/lib/hermes-telegram';
// Daily limits per UTC day. Defaults keep the original pilot behaviour; an
// operator raises them through environment variables, never above `max`.
// Invalid values fail closed at startup instead of silently granting more.
const LIMIT_SPECS=Object.freeze({
 agent_turns:{env:'HERMES_AGENT_DAILY_TURNS',default:4,max:40},
 openrouter_calls:{env:'HERMES_OPENROUTER_DAILY_CALLS',default:8,max:40},
 history_queries:{env:'HERMES_HISTORY_DAILY_QUERIES',default:24,max:200},
 history_legacy_queries:{env:'HERMES_HISTORY_LEGACY_DAILY_QUERIES',default:8,max:200},
 brain_reads:{env:'HERMES_BRAIN_DAILY_READS',default:12,max:60}
});
function dailyLimits(environment={}){
 const out={};
 for(const [key,spec] of Object.entries(LIMIT_SPECS)){
  const raw=environment[spec.env];
  if(raw===undefined||raw===''){out[key]=spec.default;continue;}
  if(typeof raw!=='string'||!/^[1-9][0-9]{0,3}$/.test(raw)||Number(raw)>spec.max)
   throw Error('daily_limit_invalid');
  out[key]=Number(raw);
 }
 if(out.history_legacy_queries>out.history_queries)throw Error('daily_limit_invalid');
 return Object.freeze(out);
}
const DEFAULT_LIMITS=dailyLimits({});
// Stored counters are sanity-checked against the hard maximum, so lowering a
// limit mid-day blocks further calls instead of reporting corrupt state.
const COUNTER_MAX=Object.freeze(Object.fromEntries(
 Object.entries(LIMIT_SPECS).map(([k,s])=>[k,s.max])));
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
    ['business-evidence-memory.json','owner-decisions.json','agent-answer-cache.json','auto-memory.json'].includes(name)?32768:
    name==='ai-finops-daily.json'?4096:2048;
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
    ['business-evidence-memory.json','owner-decisions.json','agent-answer-cache.json','auto-memory.json'].includes(name)?32768:
    name==='ai-finops-daily.json'?4096:2048;
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
// Read-only members invited by the owner. A corrupt file denies every member
// (fail closed) but keeps the owner working; it never stops the bot.
const MAX_MEMBERS=3;
function loadMembers(dir,ownerId){
 let data;
 try{data=loadState(dir,'members.json');}catch{return [];}
 if(data===null)return [];
 if(!data||data.version!==1||!Array.isArray(data.members)||
  data.members.length>MAX_MEMBERS)return [];
 const ids=data.members.map(m=>m?.user_id);
 if(ids.some(id=>!Number.isSafeInteger(id)||id<=0||id===ownerId)||
  new Set(ids).size!==ids.length)return [];
 return ids;
}
function addMember(dir,ownerId,userId,clock){
 if(!Number.isSafeInteger(userId)||userId<=0||userId===ownerId)
  throw Error('member_invalid');
 const ids=loadMembers(dir,ownerId);
 if(ids.includes(userId))return ids;
 if(ids.length>=MAX_MEMBERS)throw Error('members_full');
 const previous=loadState(dir,'members.json');
 const kept=(previous?.members||[]).filter(m=>ids.includes(m.user_id));
 saveState(dir,'members.json',{version:1,
  members:[...kept,{user_id:userId,bound_at:clock()}]});
 audit(dir,{at:new Date(clock()).toISOString(),event:'member_added',count:ids.length+1});
 return [...ids,userId];
}
function dropMember(dir,ownerId,userId,clock){
 const ids=loadMembers(dir,ownerId);
 const previous=loadState(dir,'members.json');
 const kept=(previous?.members||[]).filter(m=>ids.includes(m.user_id)&&m.user_id!==userId);
 saveState(dir,'members.json',{version:1,members:kept});
 audit(dir,{at:new Date(clock()).toISOString(),event:'member_removed',count:kept.length});
}
function analystContextFile(ownerId,userId){
 if(!Number.isSafeInteger(userId)||userId<=0)throw Error('analyst_context_user_invalid');
 return userId===ownerId?'history-analyst-context.json':'history-analyst-context-'+userId+'.json';
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
  let res;
  try{
   res=await fetchImpl(TELEGRAM_ORIGIN+'/bot'+token+'/'+method,{
    method:'POST',redirect:'error',
    headers:{'Content-Type':'application/json','Accept':'application/json'},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(25000)
   });
  }catch(error){
   if(error?.name==='TimeoutError'||error?.name==='AbortError'||
      error instanceof TypeError)
    throw Error('telegram_provider_transport_unavailable');
   throw error;
  }
  // Bad credentials, webhook conflicts or malformed requests must fail closed.
  // Retry only transport/rate-limit/server outages, never authorization errors.
  if(res.status===401||res.status===403)throw Error('telegram_provider_auth_denied');
  if(res.status===409)throw Error('telegram_webhook_conflict');
  if(res.status===429||res.status>=500)throw Error('telegram_provider_temporarily_unavailable');
  if(res.status!==200||!res.ok)throw Error('telegram_provider_request_denied');
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
 // Credit and seller views: allow-listed names from configuration, or off.
 const creditSources=receivables.sourcesFromEnv(environment);
 const sellerSource=sellerTemplates.sourceFromEnv(environment);
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
    await analyst.execute(client,params.plan,undefined,params.coverage||undefined):
    params?.shape==='coverage'?await analyst.readCoverage(client):
    params?.shape==='credit'?await receivables.execute(client,params.plan,
     {sources:creditSources,coverage:params.coverage||undefined}):
    params?.shape==='sellers'?await sellerTemplates.execute(client,params.plan,
     {relation:sellerSource,coverage:params.coverage||undefined}):
    await readHistoricalSales(client,params);
  }finally{await client.end().catch(()=>{});}
 };
}
// Claims one history query from the shared daily budget, or returns false.
function claimHistoryQuery(stateDir,now,limit){
 const today=new Date(now).toISOString().slice(0,10);
 const record=loadState(stateDir,'history-live-budget.json');
 if(record&&(!/^20\d{2}-\d{2}-\d{2}$/.test(record.date)||
   !Number.isInteger(record.count)||record.count<0||record.count>COUNTER_MAX.history_queries))
  throw Error('history_live_budget_invalid');
 const count=record?.date===today?record.count:0;
 if(count>=limit)return false;
 saveState(stateDir,'history-live-budget.json',{date:today,count:count+1});
 return true;
}
// What the history sources hold (first/last month, last day), read from the
// source by the main loop, never inside a message: one bounded metadata query
// per day after a success, a retry after 6 h on failure, outside the
// question quota. It is kept in history-coverage.json; a stored reading up to
// 7 days old survives a failed refresh, then the last verified coverage
// applies, so periods beyond what was verified stay refused (fail closed).
const COVERAGE_REFRESH_MS=24*3600000,COVERAGE_RETRY_MS=6*3600000,COVERAGE_MAX_AGE_MS=7*24*3600000;
function storedCoverage(stateDir,now){
 try{
  const saved=loadState(stateDir,'history-coverage.json');
  const c=saved?coverageModel.validate(saved,now):null;
  const age=c?now-Date.parse(c.read_at):Infinity;
  return c&&age>=0&&age<COVERAGE_MAX_AGE_MS?{coverage:c,age}:null;
 }catch{return null;}
}
function createCoverageKeeper({stateDir,readLive,liveEnabled,clock}){
 let nextAttempt=0;
 return {async current(){
  const now=clock();
  const stored=storedCoverage(stateDir,now);
  if(stored&&stored.age<COVERAGE_REFRESH_MS)return stored.coverage;
  if(liveEnabled&&now>=nextAttempt){
   nextAttempt=now+COVERAGE_RETRY_MS;
   try{
    const fresh=coverageModel.validate(await readLive({shape:'coverage',tenant_id:'grupo_erick'}),now);
    saveState(stateDir,'history-coverage.json',fresh);
    audit(stateDir,{at:new Date(now).toISOString(),event:'history_coverage',
     first_month:fresh.commercial.first_month,last_month:fresh.commercial.last_month});
    nextAttempt=now+COVERAGE_REFRESH_MS;
    return fresh;
   }catch{
    try{audit(stateDir,{at:new Date(now).toISOString(),event:'history_coverage',status:'failed'});}catch{}
   }
  }
  return stored?.coverage||coverageModel.BASELINE;
 }};
}
// Morning brief. The day is claimed before any read or send and each
// recipient is recorded before and after its send, so a crash or restart
// never sends twice; anything but "sent" for today is what the watchdog
// reports. Same quotas as interactive use; no LLM call.
async function runMorningBrief({stateDir,api,query,readLive,liveEnabled,clock,cfg,limits,
 coverage=coverageModel.BASELINE}){
 const now=clock();
 const state=loadState(stateDir,'morning-brief.json');
 const check=morningBrief.due({now,cfg,state});
 if(check.reason==='missed_window'){
  saveState(stateDir,'morning-brief.json',{day:check.day,status:'missed',at:now});
  audit(stateDir,{at:new Date(now).toISOString(),event:'morning_brief',status:'missed'});
  return 'missed';
 }
 if(!check.due)return check.reason;
 const ownerId=loadState(stateDir,'owner.json')?.owner_id??null;
 if(!Number.isSafeInteger(ownerId))return 'no_owner';
 saveState(stateDir,'morning-brief.json',{day:check.day,status:'claimed',at:now});
 const sections={};
 let ok=0;
 if(cfg.sections.includes('freshness')&&liveEnabled){
  try{
   const plan=morningBrief.freshnessPlan(now,p=>analyst.isPeriod(p,coverage));
   if(plan&&claimHistoryQuery(stateDir,now,limits.history_queries)){
    const data=await readLive({shape:'analyst',tenant_id:'grupo_erick',plan,coverage});
    analyst.reply(data,plan,coverage); // same validation as an interactive answer
    const fresh=morningBrief.freshness.describe(
     morningBrief.freshness.latestDay(data.rows.map(r=>r.source_last_day)),now);
    if(fresh){sections.freshness=fresh;ok++;}
   }
  }catch{} // the section says "não verificada" instead of guessing
 }
 for(const intent of ['prioridades','lotoia']){
  if(!cfg.sections.includes(intent))continue;
  try{
   const data=await query(intent,ROUTES[intent]);
   if(!data?.denied_status){sections[intent]=hermesReply(intent,data);ok++;}
  }catch{}
 }
 const text=morningBrief.compose({day:check.day,cfg,sections});
 const recipients=[ownerId,...(cfg.recipients==='owner_and_members'?
  loadMembers(stateDir,ownerId):[])];
 // One ledger entry per recipient, written before and after each send. Each
 // recipient gets at most one attempt per day: a timeout ("unknown") may
 // have been delivered, so nothing is ever resent automatically.
 const deliveries=Object.fromEntries(recipients.map(id=>[String(id),'pending']));
 const record=()=>({day:check.day,status:morningBrief.deliveryStatus(deliveries),at:clock(),
  deliveries:{...deliveries},sections_ok:ok});
 saveState(stateDir,'morning-brief.json',{...record(),status:'sending'});
 for(const id of recipients){
  deliveries[String(id)]='attempted';
  saveState(stateDir,'morning-brief.json',{...record(),status:'sending'});
  try{
   await api('sendMessage',{chat_id:id,text,disable_web_page_preview:true});
   deliveries[String(id)]='sent';
  }catch(error){
   deliveries[String(id)]=error?.message==='telegram_provider_transport_unavailable'?
    'unknown':'failed';
  }
 }
 const final=record();
 saveState(stateDir,'morning-brief.json',final);
 const counts=morningBrief.deliveryCounts(deliveries);
 audit(stateDir,{at:new Date(clock()).toISOString(),event:'morning_brief',
  status:final.status,...counts,sections_ok:ok});
 return final.status;
}
async function pollOnce({stateDir,api,query,clock=()=>Date.now(),
 readLive=async()=>{throw Error('history_live_disabled')},liveEnabled=false,
 agentModel=null,autoMemoryEnabled=false,secondaryProvider=null,
 brainLive=brainReader.createReader({HERMES_BRAIN_LIVE_ENABLED:'false'}),
 limits=DEFAULT_LIMITS,morningBriefConfig=null,historyCoverage=coverageModel.BASELINE,
 creditSources=null,sellerSource=null}){
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
 // Daily curation: no raw Telegram text ever enters AutoMemory.
 if(autoMemoryEnabled){
  const today=new Date(clock()).toISOString().slice(0,10);
  const cursor=loadState(stateDir,'auto-memory-day.json');
  if(cursor?.day!==today||cursor?.policy_version!==2){
   const next=autoMemory.curate({
    ownerDecisions:loadState(stateDir,'owner-decisions.json'),
    businessEvidence:loadState(stateDir,'business-evidence-memory.json'),
    previous:loadState(stateDir,'auto-memory.json'),now:clock(),
    policy:{enabled:true,tenant_id:'grupo_erick',decisions:true,aggregates:true}
   });
   saveState(stateDir,'auto-memory.json',next);
   saveState(stateDir,'auto-memory-day.json',{day:today,policy_version:2});
   audit(stateDir,{event:'auto_memory_daily',at:new Date(clock()).toISOString(),
    count:next.items.length});
  }
 }
 const queryBrainLimited=async term=>{
  if(!brainLive.enabled)throw Error('brain_live_disabled');
  const today=new Date(clock()).toISOString().slice(0,10);
  const record=loadState(stateDir,'brain-read-budget.json');
  if(record&&(!/^20\d{2}-\d{2}-\d{2}$/.test(record.date)||
    !Number.isInteger(record.count)||record.count<0||record.count>COUNTER_MAX.brain_reads))
    throw Error('brain_read_budget_corrupt');
  const used=record?.date===today?record.count:0;
  if(used>=limits.brain_reads)throw Error('brain_read_budget_exhausted');
  saveState(stateDir,'brain-read-budget.json',{date:today,count:used+1});
  return brainLive.query(term);
 };
 // Periods follow what the source holds (validated by the coverage keeper).
 const coverage=historyCoverage===coverageModel.BASELINE?historyCoverage:
  coverageModel.validate(historyCoverage,clock());
 let current=offset,handled=0;
 for(const item of updates){
  if(!Number.isSafeInteger(item?.update_id)||item.update_id<current)
   throw Error('telegram_update_order_invalid');
  // Durable ingress reservation without message body or Telegram identity.
  audit(stateDir,{at:new Date(clock()).toISOString(),
   event:'ingress',update_id:item.update_id});
  const owner=loadState(stateDir,'owner.json');
  const pairing=loadState(stateDir,'pairing.json');
  const ownerId=owner?.owner_id??null;
  const memberIds=ownerId===null?[]:loadMembers(stateDir,ownerId);
  // Claim an update before outbound queries. A failed reply will not trigger
  // a repeated provider read on restart.
  current=item.update_id+1;
  saveState(stateDir,'offset.json',{offset:current});
  // Credit and seller reads share the history quota; one claim per answer.
  const budgetedRead=shape=>async plan=>{
   if(!liveEnabled)throw Error('history_live_disabled');
   if(!claimHistoryQuery(stateDir,clock(),limits.history_queries))
    return {denied_status:'history_budget_exhausted'};
   return readLive({shape,tenant_id:'grupo_erick',plan,coverage});
  };
  const result=await processUpdate({
   update:item,ownerId,memberIds,pairing,historyCoverage:coverage,
   creditSources,sellerSource,readCredit:budgetedRead('credit'),readSellers:budgetedRead('sellers'),
   clock,query,agentDailyTurns:limits.agent_turns,
   saveMember:id=>addMember(stateDir,ownerId,id,clock),
   removeMember:id=>dropMember(stateDir,ownerId,id,clock),
   readFinops:()=>finops.validate(loadState(stateDir,'ai-finops-daily.json')),
   readBrain:queryBrainLimited,
   readAutocurated:()=>autoMemoryEnabled?
    autoMemory.render(loadState(stateDir,'auto-memory.json'),clock()):
    'Memória automática indisponível: piloto ainda não ativado.',
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
      record.count>COUNTER_MAX.history_queries))throw Error('history_live_budget_invalid');
    const count=record?.date===today?record.count:0;
    const cap=params?.shape==='analyst'?limits.history_queries:limits.history_legacy_queries;
    if(count>=cap)return {denied_status:'history_budget_exhausted'};
    // Claim before hitting network; never retry reads due to failed writes/crashes.
    saveState(stateDir,'history-live-budget.json',{date:today,count:count+1});
    return readLive(params);
   },

   agentEnabled:agentModel!==null,
   readGovernedFallback:async (question,code)=>{
    if(!autoMemoryEnabled||!codexFallback.permitted(code))throw Error('fallback_disabled');
    return codexFallback.compose({
     store:loadState(stateDir,'auto-memory.json'),question,code,now:clock()});
   },
   readAgent:async(goal,options)=>{
    // Fail closed: anything but an explicit owner request runs without owner memory.
    const ownerAudience=options?.audience==='owner';
    if(!agentModel||!liveEnabled)throw Error('agent_not_enabled');
    const today=new Date(clock()).toISOString().slice(0,10);
    const budget=loadState(stateDir,'agent-llm-budget.json');
    if(budget&&(!/^20\d{2}-\d{2}-\d{2}$/.test(budget.date)||
      !Number.isInteger(budget.turns)||budget.turns<0||budget.turns>COUNTER_MAX.agent_turns))
     throw Error('agent_llm_budget_invalid');
    const turns=budget?.date===today?budget.turns:0;
    // Reserve the daily turn immediately BEFORE the FIRST actual model call.
    // A verified synthesis cache hit never calls the model or consumes a turn.
    // One task still reserves at most one daily turn (1–2 provider requests).
    const secondary=secondaryProvider?.forTask(goal)||null;
    // Stay on OpenRouter after first Codex fail within this question.
    // The fallback cannot grant tool permissions or reset a budget.
    let reservedPrimary=false,useSecondary=turns>=limits.agent_turns;
    let callsThisTask=0;
    // Count each actual provider request separately. A Codex failure followed
    // by OpenRouter success is TWO calls, not one successful call.
    const callProvider=async(provider,invoke)=>{
     const start=Date.now();
     let ok=false;
     try{
      const answer=await invoke();
      ok=true;
      return answer;
     }finally{
      const durationMs=Math.max(0,Math.min(90000,Date.now()-start));
      try{
       const old=loadState(stateDir,'ai-finops-daily.json');
       saveState(stateDir,'ai-finops-daily.json',finops.bump(old,{
        kind:'provider_call',route:'other',ok,duration_ms:durationMs,
        cache_hit:false},clock()));
      }catch{}
      try{
       audit(stateDir,{at:new Date(clock()).toISOString(),
        event:'model_provider_call',provider,result:ok?'success':'failure',
        duration_ms:durationMs});
      }catch{}
     }
    };
    const meteredModel={chat:async(...args)=>{
     if(callsThisTask>=2)throw Error('agent_turn_calls_denied');
     callsThisTask++;
     if(!useSecondary){
      if(!reservedPrimary){
       saveState(stateDir,'agent-llm-budget.json',{date:today,turns:turns+1});
       reservedPrimary=true;
      }
      try{
       return await callProvider('codex_login',()=>agentModel.chat(...args));
      }catch(error){
       if(!secondary||!openRouter.isFallbackEligible(error))throw error;
       useSecondary=true;
      }
     }
     if(!secondary)throw Error('agent_daily_quota');
     const previous=loadState(stateDir,'agent-openrouter-budget.json');
     if(previous&&(!/^20\d{2}-\d{2}-\d{2}$/.test(previous.date)||
      !Number.isInteger(previous.count)||previous.count<0||previous.count>COUNTER_MAX.openrouter_calls))
      throw Error('openrouter_budget_invalid');
     const used=previous?.date===today?previous.count:0;
     if(used>=limits.openrouter_calls)throw Error('openrouter_daily_quota');
     saveState(stateDir,'agent-openrouter-budget.json',{date:today,count:used+1});
     return callProvider('openrouter_auto',()=>secondary.chat(...args));
    }};
    return governed.runTurn({
     goal,model:meteredModel,clock,coverage,
     readCachedAnswer:key=>answerCache.lookup(
      loadState(stateDir,'agent-answer-cache.json'),key,clock()),
     writeCachedAnswer:(key,answer)=>{
      const saved=loadState(stateDir,'agent-answer-cache.json');
      const next=answerCache.remember(saved,key,answer,clock());
      saveState(stateDir,'agent-answer-cache.json',next);
     },
     readBusinessContext:question=>businessMemory.context(
      loadState(stateDir,'business-evidence-memory.json'),question,clock(),coverage),
     readDecisionContext:question=>ownerAudience?ownerDecisions.context(
      loadState(stateDir,'owner-decisions.json'),question,clock()):'[]',
     readAutoMemoryContext:question=>ownerAudience&&autoMemoryEnabled?
      autoMemory.context(loadState(stateDir,'auto-memory.json'),question,clock()):'[]',
     readCentralBrainContext:async question=>{
      if(!ownerAudience)return []; // owner_only (personal) brain items never reach members
      if(!brainLive.enabled)return []; // legacy non-brain staging pilot remains operable
      const terms=brainReader.relevantTerms(question);
      if(terms.length===0)return [];
      const results=[];
      for(const term of terms){
       const rows=await queryBrainLimited(term);
       for(const item of rows){
        if(results.some(x=>x.title===item.title&&x.content===item.content))continue;
        results.push({kind:'approved_context_only',tenant_id:'grupo_erick',
         domain:item.domain,provider:item.provider,title:item.title,
         content:item.content,expires_at:new Date(item.expires_at).toISOString()});
        if(results.length===2)break;
       }
       if(results.length===2)break;
      }
      return results;
     },

     readHistory:async plan=>{
      const record=loadState(stateDir,'history-live-budget.json');
      if(record&&(!/^20\d{2}-\d{2}-\d{2}$/.test(record.date)||
        !Number.isInteger(record.count)||record.count<0||record.count>COUNTER_MAX.history_queries))
       throw Error('agent_history_budget_invalid');
      const n=record?.date===today?record.count:0;
      if(n>=limits.history_queries)throw Error('agent_history_quota');
      saveState(stateDir,'history-live-budget.json',{date:today,count:n+1});
      const data=await readLive({shape:'analyst',tenant_id:'grupo_erick',plan,coverage});
      // Only aggregated, source-checked evidence is remembered. Never write
      // Telegram message bodies, model recommendations or personal data.
      try{
       const existing=loadState(stateDir,'business-evidence-memory.json');
       const updated=businessMemory.observe(existing,data,plan,clock(),coverage);
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
   readAnalystContext:userId=>loadState(stateDir,analystContextFile(ownerId,userId)),
   writeAnalystContext:(ctx,userId)=>saveState(stateDir,analystContextFile(ownerId,userId),ctx),
   readAnalyst:async plan=>{
    if(!liveEnabled)throw Error('history_live_disabled');
    analyst.validate(plan,coverage);
    const hash=require('node:crypto').createHash('sha256').update(JSON.stringify(plan)).digest('hex').slice(0,24);
    const saved=loadState(stateDir,'history-analyst-cache.json');
    if(saved&&(!Array.isArray(saved.entries)||saved.entries.length>30))throw Error('analyst_cache_invalid');
    const hit=saved?.entries?.find(x=>x.key===hash);
    if(hit&&Number.isSafeInteger(hit.at)&&clock()-hit.at>=0&&clock()-hit.at<=6*3600000){
     // A cached entry from an older contract is ignored, never trusted.
     let valid=true;
     try{analyst.reply(hit.data,plan,coverage);}catch{valid=false;}
     if(valid)return {...hit.data,cached:true};
    }
    const data=await (async()=>{
     const today=new Date(clock()).toISOString().slice(0,10);
     const budget=loadState(stateDir,'history-live-budget.json');
     if(budget&&(!/^20\d{2}-\d{2}-\d{2}$/.test(budget.date)||
       !Number.isInteger(budget.count)||budget.count<0||budget.count>COUNTER_MAX.history_queries))throw Error('history_live_budget_invalid');
     const count=budget?.date===today?budget.count:0;
     if(count>=limits.history_queries)return {denied_status:'history_budget_exhausted'};
     saveState(stateDir,'history-live-budget.json',{date:today,count:count+1});
     return readLive({shape:'analyst',tenant_id:'grupo_erick',plan,coverage});
    })();
    if(data.denied_status)return data;
    analyst.reply(data,plan,coverage);
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
  // Every answered, owner-authenticated deterministic route is observed,
  // independently of Codex quota. /economia itself is never counted.
  // Counts mean bot responses, not proof of valid database contents.
  if(result.kind==='answered'&&result.intent!=='governed_agent'&&
     result.intent!=='inference_finops'){
   const kind=result.intent;
   const route=['business_cancel_rate','business_analyst','business_credit','business_sellers','historico_live',
    'historico','historico_lojas','historico_meses','business_diagnostic','business_diagnostic_store','business_diagnostic_matrix','business_history_alerts'].includes(kind)?
     'direct_history':
     ['compras','lotoia'].includes(kind)?'direct_domain':
     kind==='owner_decision'?'direct_decision':
     ['help','status'].includes(kind)?'direct_information':null;
   if(route){
    try{
     const old=loadState(stateDir,'ai-finops-daily.json');
     saveState(stateDir,'ai-finops-daily.json',finops.bump(old,{
      kind:'direct_outcome',route,ok:true,duration_ms:0,
      cache_hit:result.cache==='hit'},clock()));
    }catch{} // optional telemetry never changes the owner reply
   }
  }
  if(result.intent==='governed_agent'){
   try{
    const old=loadState(stateDir,'ai-finops-daily.json');
    const policy=finops.ROUTES.includes(result.planning_policy)?
     result.planning_policy:'other';
    saveState(stateDir,'ai-finops-daily.json',finops.bump(old,{
     kind:'outcome',route:policy,ok:result.llm_calls!==undefined,
     duration_ms:0,cache_hit:result.cache==='hit'&&result.llm_calls===0
    },clock()));
   }catch{} // do not rewrite successful Telegram replies on telemetry failure
  }
  audit(stateDir,{at:new Date(clock()).toISOString(),
   event:'outcome',update_id:item.update_id,
   outcome:result.kind,intent:result.intent||null,
   cache:result.cache||null,
   ...(typeof result.failure_code==='string'&&
    (codexFallback.permitted(result.failure_code)||result.failure_code==='validation_denied')?
    {failure_code:result.failure_code}:{}),
   ...([0,1,2].includes(result.llm_calls)?
    {llm_calls:result.llm_calls,planning_policy:result.planning_policy}: {})});
  handled++;
 }
 if(morningBriefConfig?.enabled){
  try{
   await runMorningBrief({stateDir,api,query,readLive,liveEnabled,clock,
    cfg:morningBriefConfig,limits,coverage});
  }catch{
   // Never let the brief stop polling; record the failure for the watchdog.
   // A send cut short stays "unknown": it is reported, never retried.
   try{
    const s=loadState(stateDir,'morning-brief.json');
    if(s?.status==='claimed'||s?.status==='sending'){
     const deliveries=Object.fromEntries(Object.entries(s.deliveries||{})
      .map(([id,v])=>[id,v==='attempted'?'unknown':v]));
     const status=s.status==='claimed'?'failed':morningBrief.deliveryStatus(deliveries);
     saveState(stateDir,'morning-brief.json',{...s,status,deliveries});
     audit(stateDir,{at:new Date(clock()).toISOString(),event:'morning_brief',status,
      ...morningBrief.deliveryCounts(deliveries)});
    }
   }catch{}
  }
 }
 return {handled,next_offset:current};
}
// Retry only recoverable Telegram transport failures. A claimed update offset
// is never rolled back; restarting the poll does not replay a sent message.
// These recoveries grant no new permission, no writes and no tool execution.
const RECOVERABLE_TELEGRAM_ERRORS=new Set([
 'telegram_provider_transport_unavailable',
 'telegram_provider_temporarily_unavailable'
]);
function isRecoverableTelegramError(error){
 return error instanceof Error&&RECOVERABLE_TELEGRAM_ERRORS.has(error.message);
}
async function resilientTelegramPolling({poll,sleep=ms=>new Promise(r=>setTimeout(r,ms)),
  onRecovery=()=>{}}={}){
 if(typeof poll!=='function'||typeof sleep!=='function'||
    typeof onRecovery!=='function')throw Error('telegram_poll_runner_invalid');
 let failures=0;
 for(;;){
  try{await poll();failures=0;}
  catch(error){
   if(!isRecoverableTelegramError(error))throw error;
   failures=Math.min(failures+1,6);
   // Maximum 30 seconds between retries; no busy-loop or unbounded delay.
   const delay_ms=Math.min(30000,1000*(2**(failures-1)));
   onRecovery({code:error.message,consecutive_failures:failures,delay_ms});
   await sleep(delay_ms);
  }
 }
}
async function runForever({environment=process.env,fetchImpl=globalThis.fetch,
 clock=()=>Date.now()}={}){
 if(environment.HERMES_TELEGRAM_ENABLED!=='true'||
  environment.HERMES_DEPLOYMENT_STAGE!=='staging'||
  environment.HERMES_EXECUTION_ENABLED!=='false'||
  environment.HERMES_EXECUTION_KILL_SWITCH!=='true'||
  environment.HERMES_MISSION_INGRESS_ENABLED!=='false')
  throw Error('telegram_channel_disabled');
 const limits=dailyLimits(environment);
 const briefConfig=morningBrief.config(environment);
 const dir=environment.HERMES_TELEGRAM_STATE_DIR||STATE;
 checkStateDirectory(dir);
 const botToken=readSecret(environment.HERMES_TELEGRAM_TOKEN_FILE);
 const machineToken=readSecret(environment.HERMES_TELEGRAM_MACHINE_IDENTITY_FILE);
 const api=telegramClient(botToken,fetchImpl);
 const query=hermesClient(machineToken,fetchImpl);
 const readLive=createLiveQuery(environment);
 const brainLive=brainReader.createReader(environment,{readSecret});
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
 // Disabled until a secret file is installed and mounted on the VPS.
 // Even with the key, Codex Login remains the first provider.
 const secondaryProvider=openRouter.makeOpenRouter({
  enabled:environment.HERMES_OPENROUTER_ENABLED==='true',
  stage:environment.HERMES_DEPLOYMENT_STAGE,
  killSwitch:environment.HERMES_EXECUTION_KILL_SWITCH==='true',
  key:environment.HERMES_OPENROUTER_ENABLED==='true'?
   readSecret(environment.HERMES_OPENROUTER_KEY_FILE):null,
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
 const liveEnabled=environment.HERMES_HISTORY_LIVE_ENABLED==='true';
 const coverageKeeper=createCoverageKeeper({stateDir:dir,readLive,liveEnabled,clock});
 // Same allow-listed configuration the live query uses; off when unset.
 const creditSources=receivables.sourcesFromEnv(environment);
 const sellerSource=sellerTemplates.sourceFromEnv(environment);
 await resilientTelegramPolling({
  poll:async()=>pollOnce({stateDir:dir,api,query,clock,readLive,agentModel,secondaryProvider,
   liveEnabled,brainLive,
   autoMemoryEnabled:environment.HERMES_AUTOMEMORY_ENABLED==='true',limits,
   morningBriefConfig:briefConfig,historyCoverage:await coverageKeeper.current(),
   creditSources:creditSources.position||creditSources.recovery?creditSources:null,sellerSource}),
  onRecovery:({code,consecutive_failures,delay_ms})=>audit(dir,{
   at:new Date(clock()).toISOString(),event:'telegram_poll_retry',
   code,consecutive_failures,delay_ms
  })
 });
}
if(require.main===module){
 runForever().catch(()=>{console.error('hermes_telegram_channel_stopped_fail_closed');
  process.exitCode=1;});
}
module.exports={LIMIT_SPECS,dailyLimits,runMorningBrief,claimHistoryQuery,createCoverageKeeper,storedCoverage,loadMembers,addMember,dropMember,analystContextFile,checkStateDirectory,readSecret,loadState,saveState,audit,
 smallJSON,telegramClient,hermesClient,createLiveQuery,pollOnce,runForever,
 isRecoverableTelegramError,resilientTelegramPolling};
