'use strict';
// Operations for the Telegram bot, run by systemd timers on the VPS host and
// never inside the bot: watchdog (availability checks + Telegram alerts +
// optional external dead-man ping), backup, verify and restore of the bot
// state. No database, no LLM, no shell. The bot state is only read, except
// by an explicit restore.
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const http=require('node:http');
const crypto=require('node:crypto');
const runner=require('./run-hermes-telegram-private');
const morningBrief=require('../src/runtime/hermes-morning-brief');

const HOME='/home/hermesadmin/.hermes-telegram';
const BACKUP_PREFIX='hermes-telegram-state-';
const BACKUP_SUFFIX='.json.gz';
const BACKUP_FORMAT='hermes-telegram-state-backup-v1';
const MAX_FILE_BYTES=10*1024*1024;
const MAX_BUNDLE_BYTES=50*1024*1024;
const MIN_KEPT_BACKUPS=3;
const RECENT_HEARTBEAT_MS=120000;
const REALERT_MS=6*3600000;
const SAFE_NAME=/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/;

function intEnv(env,name,def,min,max){
 const raw=env[name];
 if(raw===undefined||raw==='')return def;
 if(!/^[0-9]{1,6}$/.test(raw)||Number(raw)<min||Number(raw)>max)throw Error('ops_config_invalid');
 return Number(raw);
}
function absDir(env,name,def){
 const value=env[name]||def;
 if(typeof value!=='string'||!path.isAbsolute(value)||value.includes('..'))
  throw Error('ops_config_invalid');
 return value;
}
function httpsUrl(value){
 let u;
 try{u=new URL(value);}catch{throw Error('ops_config_invalid');}
 if(u.protocol!=='https:'||u.username||u.password)throw Error('ops_config_invalid');
 return u.toString();
}
function config(env=process.env){
 const urls=(env.HERMES_WATCHDOG_HEALTH_URLS||'').split(',').map(s=>s.trim()).filter(Boolean);
 if(urls.length>5)throw Error('ops_config_invalid');
 const deadline=env.HERMES_WATCHDOG_BRIEF_DEADLINE||null;
 if(deadline!==null&&!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(deadline))
  throw Error('ops_config_invalid');
 const socket=env.HERMES_WATCHDOG_CODEX_SOCKET||null;
 if(socket!==null&&(!path.isAbsolute(socket)||socket.includes('..')))
  throw Error('ops_config_invalid');
 return Object.freeze({
  stateDir:absDir(env,'HERMES_TELEGRAM_STATE_DIR',HOME+'/state'),
  tokenFile:env.HERMES_TELEGRAM_TOKEN_FILE||HOME+'/secret/token',
  watchdogDir:absDir(env,'HERMES_WATCHDOG_STATE_DIR',HOME+'/watchdog'),
  heartbeatMaxMs:intEnv(env,'HERMES_WATCHDOG_HEARTBEAT_MAX_SECONDS',180,60,3600)*1000,
  healthUrls:Object.freeze(urls.map(httpsUrl)),
  diskMinFreePercent:intEnv(env,'HERMES_WATCHDOG_DISK_MIN_FREE_PERCENT',10,1,50),
  backupMaxMs:intEnv(env,'HERMES_WATCHDOG_BACKUP_MAX_HOURS',26,2,240)*3600000,
  briefDeadline:deadline,
  codexSocket:socket,
  pingUrl:env.HERMES_WATCHDOG_PING_URL?httpsUrl(env.HERMES_WATCHDOG_PING_URL):null,
  backupDir:absDir(env,'HERMES_BACKUP_DIR',HOME+'/backups'),
  copyDir:env.HERMES_BACKUP_COPY_DIR?absDir(env,'HERMES_BACKUP_COPY_DIR',null):null,
  retentionDays:intEnv(env,'HERMES_BACKUP_RETENTION_DAYS',14,1,90)
 });
}
function ensurePrivateDir(dir){
 if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true,mode:0o700});
 runner.checkStateDirectory(dir);
}

// ── Watchdog ──────────────────────────────────────────────────────────────
async function fetchStatus(fetchImpl,url){
 try{
  const r=await fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(8000)});
  try{await r.body?.cancel?.();}catch{}
  return r.status;
 }catch{return 0;}
}
function socketStatus(socketPath){
 return new Promise(resolve=>{
  const req=http.get({socketPath,path:'/health',timeout:5000},r=>{r.resume();resolve(r.statusCode);});
  req.on('timeout',()=>{req.destroy();resolve(0);});
  req.on('error',()=>resolve(0));
 });
}
function newestBackupAge(dir,now){
 let newest=null;
 for(const name of fs.readdirSync(dir)){
  if(!name.startsWith(BACKUP_PREFIX)||!name.endsWith(BACKUP_SUFFIX))continue;
  const t=fs.statSync(path.join(dir,name)).mtimeMs;
  if(newest===null||t>newest)newest=t;
 }
 return newest===null?null:now-newest;
}
async function runChecks(cfg,{now,fetchImpl=globalThis.fetch,statfs=fs.statfsSync,
 probeSocket=socketStatus}){
 const checks=[];
 const add=(name,ok,detail)=>checks.push({name,ok,detail});
 try{
  const hb=runner.loadState(cfg.stateDir,'heartbeat.json');
  const age=hb&&Number.isSafeInteger(hb.at)?now-hb.at:null;
  add('bot_heartbeat',age!==null&&age>=0&&age<=cfg.heartbeatMaxMs,
   age===null?'sem heartbeat':'último sinal há '+Math.round(age/1000)+'s');
 }catch{add('bot_heartbeat',false,'estado do bot ilegível');}
 for(const [i,url] of cfg.healthUrls.entries()){
  const status=await fetchStatus(fetchImpl,url);
  add('health_'+(i+1),status===200,new URL(url).host+' respondeu '+(status||'sem resposta'));
 }
 if(cfg.codexSocket){
  const status=await probeSocket(cfg.codexSocket);
  add('codex_bridge',status===200,status===200?'ok':'ponte Codex sem resposta');
 }
 try{
  const s=statfs(cfg.stateDir);
  const free=Math.floor(Number(s.bavail)*100/Number(s.blocks));
  add('disk',free>=cfg.diskMinFreePercent,free+'% livre');
 }catch{add('disk',false,'espaço em disco ilegível');}
 if(fs.existsSync(cfg.backupDir)){
  const age=newestBackupAge(cfg.backupDir,now);
  add('backup',age!==null&&age<=cfg.backupMaxMs,
   age===null?'nenhum backup encontrado':'último backup há '+Math.round(age/3600000)+'h');
 }else add('backup',false,'pasta de backup ausente');
 if(cfg.briefDeadline){
  const local=morningBrief.localClock(now,morningBrief.DEFAULTS.timezone);
  const [h,m]=cfg.briefDeadline.split(':').map(Number);
  if(local.minutes>=h*60+m){
   let state=null;
   try{state=runner.loadState(cfg.stateDir,'morning-brief.json');}catch{}
   const sent=state?.day===local.day&&state.status==='sent';
   add('morning_brief',sent,sent?'enviado hoje':'não enviado hoje ('+(state?.day===local.day?state.status:'sem registro')+')');
  }
 }
 return checks;
}
// Pure transition: decides which failures and recoveries to announce.
// A check alerts after two consecutive failures, then again every 6 hours.
function transition(previous,checks,now){
 const before=previous?.checks&&typeof previous.checks==='object'?previous.checks:{};
 const next={},failing=[],recovered=[];
 for(const c of checks){
  const old=before[c.name]||{failures:0,alerted_at:null};
  if(c.ok){
   if(old.alerted_at)recovered.push(c);
   next[c.name]={failures:0,alerted_at:null};
   continue;
  }
  const failures=Math.min((old.failures||0)+1,1000);
  const alert=failures>=2&&(!old.alerted_at||now-old.alerted_at>=REALERT_MS);
  if(alert)failing.push(c);
  next[c.name]={failures,alerted_at:old.alerted_at||null,alert};
 }
 return {next,failing,recovered};
}
function alertText(failing,recovered){
 const lines=[];
 if(failing.length)lines.push('🚨 Hermes: falha detectada',...failing.map(c=>'• '+c.name+': '+c.detail));
 if(recovered.length)lines.push((lines.length?'\n':'')+'✅ Hermes: recuperado',
  ...recovered.map(c=>'• '+c.name+': '+c.detail));
 lines.push('Vigia automático do VPS; nenhuma ação foi executada.');
 return lines.join('\n');
}
async function watchdog(cfg,{now=Date.now(),fetchImpl=globalThis.fetch,statfs,probeSocket,
 api=null}={}){
 ensurePrivateDir(cfg.watchdogDir);
 const checks=await runChecks(cfg,{now,fetchImpl,statfs,probeSocket});
 let previous=null;
 try{previous=runner.loadState(cfg.watchdogDir,'watchdog.json');}catch{}
 const {next,failing,recovered}=transition(previous,checks,now);
 let notified=false;
 if(failing.length||recovered.length){
  try{
   const ownerId=runner.loadState(cfg.stateDir,'owner.json')?.owner_id;
   if(!Number.isSafeInteger(ownerId))throw Error('owner_missing');
   const send=api||runner.telegramClient(runner.readSecret(cfg.tokenFile),fetchImpl);
   await send('sendMessage',{chat_id:ownerId,text:alertText(failing,recovered),
    disable_web_page_preview:true});
   notified=true;
  }catch{} // Telegram down: the external dead-man ping still goes silent.
 }
 // Record an alert only once it was delivered, so a failed delivery retries.
 const saved={};
 for(const [name,v] of Object.entries(next))
  saved[name]={failures:v.failures,alerted_at:v.alert&&notified?now:v.alerted_at};
 if(!notified)for(const c of recovered)saved[c.name]={failures:0,
  alerted_at:previous?.checks?.[c.name]?.alerted_at||null};
 runner.saveState(cfg.watchdogDir,'watchdog.json',{checks:saved});
 const healthy=checks.every(c=>c.ok);
 let pinged=false;
 // Dead-man switch: an external monitor alerts when these pings stop, which
 // also covers a VPS that is down or a Telegram API that is unreachable.
 if(healthy&&cfg.pingUrl)pinged=(await fetchStatus(fetchImpl,cfg.pingUrl))===200;
 return {healthy,checks:checks.map(c=>({name:c.name,ok:c.ok})),
  alerted:failing.map(c=>c.name),recovered:recovered.map(c=>c.name),notified,pinged};
}

// ── Backup, verify, restore ──────────────────────────────────────────────
function stamp(now){return new Date(now).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');}
function sha256(buf){return crypto.createHash('sha256').update(buf).digest('hex');}
function readStateFiles(stateDir){
 runner.checkStateDirectory(stateDir);
 const files=[];let total=0;
 for(const name of fs.readdirSync(stateDir).sort()){
  if(name.startsWith('.'))continue; // atomic-write temporaries and diagnostics
  const full=path.join(stateDir,name);
  const st=fs.lstatSync(full);
  if(!st.isFile())continue; // no symlinks, no subdirectories
  if(!SAFE_NAME.test(name)||st.size>MAX_FILE_BYTES)throw Error('backup_file_denied');
  const content=fs.readFileSync(full);
  total+=content.length;
  if(total>MAX_BUNDLE_BYTES)throw Error('backup_too_large');
  files.push({name,size:content.length,sha256:sha256(content),content_base64:content.toString('base64')});
 }
 return files;
}
function writeExclusive(file,data){
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|
  fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function decodeBundle(buffer){
 let bundle;
 try{bundle=JSON.parse(zlib.gunzipSync(buffer,{maxOutputLength:MAX_BUNDLE_BYTES*2}).toString('utf8'));}
 catch{throw Error('backup_unreadable');}
 if(!bundle||bundle.format!==BACKUP_FORMAT||!Array.isArray(bundle.files)||
  !Number.isFinite(Date.parse(bundle.created_at)))throw Error('backup_format_invalid');
 const names=new Set();
 const files=bundle.files.map(f=>{
  if(!f||!SAFE_NAME.test(f.name)||names.has(f.name)||typeof f.content_base64!=='string')
   throw Error('backup_entry_invalid');
  names.add(f.name);
  const content=Buffer.from(f.content_base64,'base64');
  if(content.length!==f.size||sha256(content)!==f.sha256)throw Error('backup_checksum_mismatch');
  return {name:f.name,content};
 });
 return {created_at:bundle.created_at,files};
}
function verify(file){
 const st=fs.lstatSync(file);
 if(!st.isFile()||st.size>MAX_BUNDLE_BYTES*2)throw Error('backup_unreadable');
 const {created_at,files}=decodeBundle(fs.readFileSync(file));
 return {created_at,files:files.length,bytes:files.reduce((n,f)=>n+f.content.length,0)};
}
function prune(dir,now,retentionDays){
 const backups=fs.readdirSync(dir).filter(n=>n.startsWith(BACKUP_PREFIX)&&n.endsWith(BACKUP_SUFFIX)).sort();
 const keepFrom=Math.max(0,backups.length-MIN_KEPT_BACKUPS);
 let removed=0;
 backups.forEach((name,i)=>{
  if(i>=keepFrom)return;
  if(now-fs.statSync(path.join(dir,name)).mtimeMs>retentionDays*86400000){
   fs.unlinkSync(path.join(dir,name));removed++;
  }
 });
 return removed;
}
function backup(cfg,{now=Date.now()}={}){
 const files=readStateFiles(cfg.stateDir);
 const bundle={format:BACKUP_FORMAT,created_at:new Date(now).toISOString(),
  source:'telegram_state',files};
 const data=zlib.gzipSync(Buffer.from(JSON.stringify(bundle)),{level:9});
 const name=BACKUP_PREFIX+stamp(now)+BACKUP_SUFFIX;
 const targets=[cfg.backupDir,...(cfg.copyDir?[cfg.copyDir]:[])];
 const result={file:name,files:files.length,bytes:data.length,copies:0,pruned:0};
 for(const dir of targets){
  ensurePrivateDir(dir);
  const file=path.join(dir,name);
  writeExclusive(file,data);
  verify(file); // read back before trusting it
  result.copies++;
  result.pruned+=prune(dir,now,cfg.retentionDays);
 }
 return result;
}
function restore(file,targetDir,{now=Date.now(),force=false}={}){
 const {created_at,files}=decodeBundle(fs.readFileSync(file));
 runner.checkStateDirectory(targetDir);
 if(!force){
  let hb=null;
  try{hb=runner.loadState(targetDir,'heartbeat.json');}catch{}
  if(hb&&Number.isSafeInteger(hb.at)&&now-hb.at>=0&&now-hb.at<RECENT_HEARTBEAT_MS)
   throw Error('restore_bot_running');
 }
 for(const f of files){
  const temp=path.join(targetDir,'.'+f.name+'.restore');
  try{fs.unlinkSync(temp);}catch{}
  writeExclusive(temp,f.content);
  fs.renameSync(temp,path.join(targetDir,f.name));
 }
 const dirFd=fs.openSync(targetDir,fs.constants.O_RDONLY);
 try{fs.fsyncSync(dirFd);}finally{fs.closeSync(dirFd);}
 const restored=new Set(files.map(f=>f.name));
 const extra=fs.readdirSync(targetDir).filter(n=>!n.startsWith('.')&&!restored.has(n));
 return {created_at,restored:files.length,untouched_extra_files:extra.length};
}

async function main(argv=process.argv.slice(2),env=process.env){
 const [command,...args]=argv;
 const cfg=config(env);
 if(command==='watchdog'){
  const r=await watchdog(cfg);
  process.stdout.write(JSON.stringify({event:'hermes_telegram_watchdog',...r})+'\n');
  return r.healthy?0:1;
 }
 if(command==='backup'){
  const r=backup(cfg);
  process.stdout.write(JSON.stringify({event:'hermes_telegram_backup',...r})+'\n');
  return 0;
 }
 if(command==='verify'&&args.length===1){
  process.stdout.write(JSON.stringify({event:'hermes_telegram_backup_verify',...verify(args[0])})+'\n');
  return 0;
 }
 if(command==='restore'&&(args.length===2||(args.length===3&&args[2]==='--force'))){
  const r=restore(args[0],args[1],{force:args[2]==='--force'});
  process.stdout.write(JSON.stringify({event:'hermes_telegram_restore',...r})+'\n');
  return 0;
 }
 process.stderr.write('uso: watchdog | backup | verify ARQUIVO | restore ARQUIVO PASTA [--force]\n');
 return 2;
}
if(require.main===module){
 main().then(code=>{process.exitCode=code;},error=>{
  // Error codes only: never paths, tokens or file contents.
  process.stderr.write(JSON.stringify({event:'hermes_telegram_ops_failed',
   code:/^[a-z_]{3,60}$/.test(error?.message||'')?error.message:'unexpected'})+'\n');
  process.exitCode=1;
 });
}
module.exports={BACKUP_PREFIX,BACKUP_SUFFIX,BACKUP_FORMAT,REALERT_MS,config,runChecks,
 transition,alertText,watchdog,readStateFiles,decodeBundle,verify,prune,backup,restore,main};
