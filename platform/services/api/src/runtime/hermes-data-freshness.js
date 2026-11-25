'use strict';
// Data freshness ("dados até"), derived from the last day present in the
// source itself, never from a hard-coded calendar. When new sales arrive the
// text moves with them; when the source stops, the age makes it visible.
const TIMEZONE='America/Recife';
const DAY_MS=86400000;
const STALE_AFTER_DAYS=2;
const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:TIMEZONE,
 year:'numeric',month:'2-digit',day:'2-digit'});
function localDay(now){
 if(!Number.isSafeInteger(now))throw Error('freshness_clock_invalid');
 return dayFormat.format(new Date(now));
}
function validDay(day){
 if(typeof day!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(day))return false;
 const t=Date.parse(day+'T00:00:00.000Z');
 return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===day;
}
function latestDay(days){
 if(!Array.isArray(days))return null;
 const valid=days.filter(validDay).sort();
 return valid.length?valid.at(-1):null;
}
const SCOPES=Object.freeze(['fonte','loja']);
const shownDay=day=>day.slice(8,10)+'/'+day.slice(5,7)+'/'+day.slice(0,4);
// Returns null when the day is missing, malformed or in the future: callers
// then say freshness is unknown instead of inventing it.
function describe(lastDay,now=Date.now(),scope='fonte'){
 if(!SCOPES.includes(scope))throw Error('freshness_scope_invalid');
 if(!validDay(lastDay))return null;
 const today=localDay(now);
 const age=Math.round((Date.parse(today+'T00:00:00.000Z')-
  Date.parse(lastDay+'T00:00:00.000Z'))/DAY_MS);
 if(age<0)return null;
 const when=age===0?'hoje':age===1?'ontem':age+' dias atrás';
 const stale=age>STALE_AFTER_DAYS;
 return Object.freeze({last_day:lastDay,age_days:age,stale,
  text:(stale?'⚠️ ':'')+'Dados até '+shownDay(lastDay)+' ('+when+')'+
   (stale?': '+scope+' sem atualização recente':'')});
}
// The queried store's own last day, next to the source's: a store that
// stopped sending never borrows the freshness of the whole source.
// storeDay: undefined = not reported by this query, null = no data at all.
function storeLine(store,storeDay,sourceDay,now=Date.now()){
 if(typeof store!=='string'||!store)return null;
 if(storeDay===undefined)return 'Loja '+store+': atualidade não informada nesta consulta';
 if(storeDay===null)return '⚠️ Loja '+store+': sem dados registrados na fonte';
 const own=describe(storeDay,now,'loja');
 if(!own)return 'Loja '+store+': atualidade não informada nesta consulta';
 const behind=validDay(sourceDay)&&storeDay<sourceDay;
 return (behind&&!own.stale?'⚠️ ':'')+'Loja '+store+': '+own.text+
  (behind?' — anterior à fonte ('+shownDay(sourceDay)+')':'');
}
module.exports={TIMEZONE,STALE_AFTER_DAYS,localDay,validDay,latestDay,describe,shownDay,storeLine};
