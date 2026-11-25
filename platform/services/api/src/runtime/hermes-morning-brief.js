'use strict';
// Daily morning brief sent by the existing Telegram poller: no new service,
// no scheduler process and no LLM. It reuses replies the bot already
// validates, so every section keeps its own source line. Pure functions only;
// the runner does the reads, the budget accounting and the sending.
const freshness=require('./hermes-data-freshness');
const SECTIONS=Object.freeze(['freshness','prioridades','lotoia']);
const RECIPIENTS=Object.freeze(['owner','owner_and_members']);
const DEFAULTS=Object.freeze({time:'07:30',timezone:'America/Recife',
 recipients:'owner',sections:SECTIONS.join(',')});
// After this many minutes past the configured time the day is recorded as
// missed instead of sending a stale "bom dia" in the afternoon.
const LATE_WINDOW_MINUTES=240;
const MAX_TEXT=3900; // Telegram accepts 4096 characters per message.

function config(env={}){
 const flag=env.HERMES_MORNING_BRIEF_ENABLED;
 if(flag!==undefined&&flag!==''&&flag!=='true'&&flag!=='false')
  throw Error('morning_brief_config_invalid');
 const time=env.HERMES_MORNING_BRIEF_TIME||DEFAULTS.time;
 if(!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time))throw Error('morning_brief_config_invalid');
 const timezone=env.HERMES_MORNING_BRIEF_TIMEZONE||DEFAULTS.timezone;
 try{new Intl.DateTimeFormat('en-CA',{timeZone:timezone});}
 catch{throw Error('morning_brief_config_invalid');}
 const recipients=env.HERMES_MORNING_BRIEF_RECIPIENTS||DEFAULTS.recipients;
 if(!RECIPIENTS.includes(recipients))throw Error('morning_brief_config_invalid');
 const sections=(env.HERMES_MORNING_BRIEF_SECTIONS||DEFAULTS.sections).split(',');
 if(!sections.length||new Set(sections).size!==sections.length||
  sections.some(s=>!SECTIONS.includes(s)))throw Error('morning_brief_config_invalid');
 return Object.freeze({enabled:flag==='true',time,timezone,recipients,
  sections:Object.freeze(sections)});
}
function localClock(now,timezone){
 if(!Number.isSafeInteger(now))throw Error('morning_brief_clock_invalid');
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
  hourCycle:'h23'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
 return {day:parts.year+'-'+parts.month+'-'+parts.day,
  minutes:Number(parts.hour)*60+Number(parts.minute)};
}
// state is the last record saved by the runner: {day,status,...} or null.
function due({now,cfg,state}){
 if(!cfg?.enabled)return {due:false,reason:'disabled'};
 const local=localClock(now,cfg.timezone);
 const [h,m]=cfg.time.split(':').map(Number);
 const target=h*60+m;
 if(state&&state.day===local.day)return {due:false,day:local.day,reason:'already_'+state.status};
 if(local.minutes<target)return {due:false,day:local.day,reason:'not_yet'};
 if(local.minutes>target+LATE_WINDOW_MINUTES)return {due:false,day:local.day,reason:'missed_window'};
 return {due:true,day:local.day,reason:'due'};
}
// The freshness probe uses one validated analyst plan; its source_last_day
// is the whole view's last day, so the year only has to be accepted.
function freshnessPlan(now,isPeriod){
 const year=Number(new Intl.DateTimeFormat('en-CA',{timeZone:DEFAULTS.timezone,
  year:'numeric'}).format(new Date(now)));
 for(let y=year;y>=year-3;y--){
  if(isPeriod(String(y)))return Object.freeze({tenant_id:'grupo_erick',template:'period',
   period:String(y),other_period:null,metric:'records',store:null});
 }
 return null;
}
const DAY_LABEL=day=>day.slice(8,10)+'/'+day.slice(5,7)+'/'+day.slice(0,4);
// sections: {freshness:{text}|null, prioridades:string|null, lotoia:string|null}
function compose({day,cfg,sections={},now}){
 if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(day||''))throw Error('morning_brief_day_invalid');
 const parts={};
 if(cfg.sections.includes('freshness')){
  const fresh=sections.freshness;
  parts.freshness='📅 Histórico de vendas (Supabase / hermes_history)\n'+
   (fresh&&typeof fresh.text==='string'?fresh.text:
    'Atualidade não verificada hoje: consulta indisponível ou limite diário atingido.');
 }
 if(cfg.sections.includes('prioridades'))
  parts.prioridades=typeof sections.prioridades==='string'?sections.prioridades:
   '📦 Compras: indisponível agora. Tente /prioridades mais tarde.';
 if(cfg.sections.includes('lotoia'))
  parts.lotoia=typeof sections.lotoia==='string'?sections.lotoia:
   '🎟️ LotoIA: indisponível agora. Tente /lotoia mais tarde.';
 const header='☀️ Bom dia — resumo Hermes de '+DAY_LABEL(day);
 const footer='Resumo automático e somente leitura; nenhuma ação foi executada.';
 const build=()=>[header,...cfg.sections.map(s=>parts[s]),footer].join('\n\n');
 // Keep one message: shorten the largest domain sections to a pointer first.
 for(const s of ['lotoia','prioridades']){
  if(build().length<=MAX_TEXT)break;
  if(parts[s])parts[s]=s==='lotoia'?'🎟️ LotoIA: use /lotoia para o detalhe.':
   '📦 Compras: use /prioridades para o detalhe.';
 }
 const text=build();
 if(text.length>MAX_TEXT)throw Error('morning_brief_too_long');
 return text;
}
module.exports={SECTIONS,RECIPIENTS,DEFAULTS,LATE_WINDOW_MINUTES,MAX_TEXT,
 config,localClock,due,freshnessPlan,compose,freshness};
