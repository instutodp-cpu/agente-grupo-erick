'use strict';
// Which months the history sources actually hold, read from the sources
// themselves, never from a calendar written in code. MIN/MAX is not enough:
// the real history has gaps (e.g. eight records in April 2011, then nothing
// until July 2019), so coverage is the list of months with data, kept as
// contiguous runs, per store and for the group. Missing months are NOT zero
// sales: a period without data is refused, never answered with a number.
// Until a reading is validated, the last VERIFIED coverage applies (fail
// closed): a period outside it is refused, never guessed.
//
// "Complete" below means COMPARABLE on the evidence available, never proof
// that the export holds every sale: records in consecutive months do not
// prove a complete export (only a reconciliation with official totals can).
// From evidence only:
//  - a month inside a run (data before and after it) is comparable;
//  - the first month of a run is partial (data may start mid-month), unless
//    the source declares that its view starts at a cut of continuous data;
//  - the last month of a run is complete only if its last day with sales is
//    the month's last day.
const MIN_MONTH='2000-01';
const MAX_RUNS=24;
const STORES=Object.freeze(['CALCADOS','SIRINHAEM','MAGAZINE','SPORTS-(DESATIVADO)','ERICK SPORTS','VARIEDADES']);
const MONTH=/^(20[0-9]{2})-(0[1-9]|1[0-2])$/;
const DAY=/^(20[0-9]{2})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const NAMES=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto',
 'setembro','outubro','novembro','dezembro'];
const index=m=>Number(m.slice(0,4))*12+Number(m.slice(5,7))-1;
const monthAt=i=>String(Math.floor(i/12))+'-'+String(i%12+1).padStart(2,'0');
const validMonth=m=>typeof m==='string'&&MONTH.test(m)&&m>=MIN_MONTH;
function validDay(d){
 if(typeof d!=='string'||!DAY.test(d))return false;
 const t=new Date(d+'T00:00:00.000Z');
 return Number.isFinite(t.getTime())&&t.toISOString().slice(0,10)===d;
}
function monthEnd(m){
 const [y,mm]=m.split('-').map(Number);
 return m+'-'+String(new Date(Date.UTC(y,mm,0)).getUTCDate()).padStart(2,'0');
}
// Verified on the staging history before week 4 (view
// monthly_commercial_2025_2026_v1): sales 2025-01..2026-06 ending on
// 2026-06-08; the view starts at a cut of continuous data (the source table
// holds 2024 too, per the Supabase audit), so January 2025 is complete.
// Per-store coverage was not verified: unknown (null) means the group's.
const BASELINE=Object.freeze({
 origin:'baseline',read_at:null,
 commercial:Object.freeze({runs:Object.freeze([Object.freeze({first:'2025-01',last:'2026-06',
  last_day:'2026-06-08',start_complete:true})]),stores:null}),
 products:Object.freeze({runs:Object.freeze([Object.freeze({first:'2026-01',last:'2026-06',
  last_day:null,start_complete:true})]),stores:null})
});
// Month list -> contiguous runs, each with the last day of its last month.
function toRuns(monthDays,cutStart){
 const months=[...monthDays.keys()].sort();
 const runs=[];
 for(const m of months){
  const prev=runs.at(-1);
  if(prev&&index(m)===index(prev.last)+1){prev.last=m;prev.last_day=monthDays.get(m);}
  else runs.push({first:m,last:m,last_day:monthDays.get(m),start_complete:m===cutStart});
 }
 if(runs.length>MAX_RUNS)throw Error('coverage_too_fragmented');
 return runs.map(r=>Object.freeze(r));
}
function validRuns(runs,nowMonth){
 if(!Array.isArray(runs)||runs.length>MAX_RUNS)return false;
 let prevLast=null;
 for(const r of runs){
  if(!r||!validMonth(r.first)||!validMonth(r.last)||r.first>r.last||(nowMonth&&r.last>nowMonth)||
   typeof r.start_complete!=='boolean')return false;
  // Runs are sorted and separated by at least one missing month.
  if(prevLast&&index(r.first)<=index(prevLast)+1)return false;
  if(r.last_day!==null&&(!validDay(r.last_day)||r.last_day.slice(0,7)!==r.last))return false;
  prevLast=r.last;
 }
 return true;
}
function freezeScope(s){
 return Object.freeze({runs:Object.freeze(s.runs.map(r=>Object.freeze({...r}))),
  stores:s.stores===null?null:Object.freeze(Object.fromEntries(Object.entries(s.stores)
   .map(([k,v])=>[k,Object.freeze(v.map(r=>Object.freeze({...r})))])))});
}
function validScope(s,nowMonth,requireDay){
 if(!s||typeof s!=='object'||!validRuns(s.runs,nowMonth)||!s.runs.length)return false;
 if(requireDay&&s.runs.at(-1).last_day===null)return false;
 if(s.stores!==null){
  if(!s.stores||typeof s.stores!=='object'||Array.isArray(s.stores))return false;
  for(const [store,runs] of Object.entries(s.stores))
   if(!STORES.includes(store)||!validRuns(runs,nowMonth))return false;
 }
 return true;
}
// rows: [{scope:'commercial', raw_store, month, last_day}] one per store and
// month with data; [{scope:'products', month}] one per month.
// cutStarts: months where a view starts at a cut of continuous data.
function fromRows(rows,now,{readAt=now,cutStarts={}}={}){
 if(!Array.isArray(rows)||rows.length===0||rows.length>5000)throw Error('coverage_rows_invalid');
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(readAt)||readAt>now+60000)
  throw Error('coverage_time_invalid');
 const nowMonth=new Date(now).toISOString().slice(0,7);
 const group={commercial:new Map(),products:new Map()},stores=new Map();
 const seen=new Set();
 for(const r of rows){
  if(!r||!['commercial','products'].includes(r.scope)||!validMonth(r.month)||r.month>nowMonth)
   throw Error('coverage_rows_invalid');
  const day=r.last_day??null;
  if(day!==null&&(!validDay(day)||day.slice(0,7)!==r.month))throw Error('coverage_scope_invalid');
  const store=r.scope==='commercial'?r.raw_store:null;
  if(r.scope==='commercial'&&!STORES.includes(store))throw Error('coverage_store_invalid');
  const key=r.scope+'|'+store+'|'+r.month;
  if(seen.has(key))throw Error('coverage_rows_invalid');
  seen.add(key);
  const g=group[r.scope];
  const prev=g.get(r.month);
  g.set(r.month,prev===undefined||prev===null?day:day===null?prev:(day>prev?day:prev));
  if(store){
   if(!stores.has(store))stores.set(store,new Map());
   stores.get(store).set(r.month,day);
  }
 }
 if(!group.commercial.size||!group.products.size)throw Error('coverage_rows_invalid');
 const commercial={runs:toRuns(group.commercial,cutStarts.commercial),
  stores:Object.fromEntries([...stores].map(([s,m])=>[s,toRuns(m,cutStarts.commercial)]))};
 const products={runs:toRuns(group.products,cutStarts.products),stores:null};
 // A sales history without its last day cannot say what is partial.
 if(commercial.runs.at(-1).last_day===null)throw Error('coverage_last_day_required');
 return Object.freeze({origin:'source',read_at:new Date(readAt).toISOString(),
  commercial:freezeScope(commercial),products:freezeScope(products)});
}
// A stored coverage (state file) is re-validated on every load, keeping
// when it was read so that its age is real.
function validate(c,now){
 if(c===BASELINE)return c;
 if(!c||c.origin!=='source'||typeof c.read_at!=='string'||
  !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(c.read_at))throw Error('coverage_invalid');
 const readAt=Date.parse(c.read_at);
 if(!Number.isSafeInteger(now)||!Number.isFinite(readAt)||readAt>now+60000)throw Error('coverage_invalid');
 const nowMonth=new Date(now).toISOString().slice(0,7);
 if(!validScope(c.commercial,nowMonth,true)||!validScope(c.products,nowMonth,false)||c.products.stores!==null)
  throw Error('coverage_invalid');
 return Object.freeze({origin:'source',read_at:c.read_at,commercial:freezeScope(c.commercial),
  products:freezeScope(c.products)});
}
// The group's scope, or one store's. A store absent from a source reading
// holds nothing (fail closed). Without per-store coverage (baseline) the
// group's months only LOCATE the period for the store: the store's own
// coverage is unverified, so none of its months counts as comparable.
function scopeOf(coverage,name,store=null){
 const c=coverage||BASELINE;
 const s=c[name]||BASELINE[name];
 if(!store)return {runs:s.runs};
 if(s.stores===null)return {runs:s.runs,unverified:true};
 return {runs:s.stores[store]||[]};
}
const runOf=(scope,m)=>scope.runs.find(r=>m>=r.first&&m<=r.last)||null;
function monthComplete(scope,m){
 if(scope.unverified)return false;
 const r=runOf(scope,m);
 if(!r)return false;
 if(m===r.first&&!r.start_complete)return false;
 if(m===r.last&&r.last_day!==monthEnd(m))return false;
 return true;
}
const monthsOfYear=y=>Array.from({length:12},(_,i)=>y+'-'+String(i+1).padStart(2,'0'));
function accepts(scope,p){
 if(typeof p!=='string')return false;
 if(/^20[0-9]{2}$/.test(p))return monthsOfYear(p).some(m=>runOf(scope,m));
 return validMonth(p)&&Boolean(runOf(scope,p));
}
// Month numbers ('01'..'12') of a year that hold data / that are complete.
const presentMonths=(scope,y)=>monthsOfYear(y).filter(m=>runOf(scope,m)).map(m=>m.slice(5));
const completeMonths=(scope,y)=>monthsOfYear(y).filter(m=>monthComplete(scope,m)).map(m=>m.slice(5));
function isPartial(scope,p){
 if(!accepts(scope,p))return true;
 if(p.length===4)return completeMonths(scope,p).length!==12;
 return !monthComplete(scope,p);
}
// Year against year only over the months complete in BOTH years (may skip
// months: a gap is never compared as if it were zero).
function yearWindow(scope,a,b){
 if(!/^20[0-9]{2}$/.test(a)||!/^20[0-9]{2}$/.test(b))return null;
 const wb=new Set(completeMonths(scope,b));
 const months=completeMonths(scope,a).filter(m=>wb.has(m));
 return months.length?{months}:null;
}
// "março" without a year: the most recent March held.
function yearForMonth(scope,mm){
 const months=scope.runs.flatMap(r=>[r.first,r.last]).sort();
 if(!months.length)return null;
 for(let y=Number(months.at(-1).slice(0,4));y>=Number(months[0].slice(0,4));y--)
  if(runOf(scope,y+'-'+mm))return String(y);
 return null;
}
const latestMonth=scope=>scope.runs.at(-1)?.last||null;
const monthName=n=>NAMES[Number(n)-1];
const label=m=>monthName(m.slice(5,7))+'/'+m.slice(0,4);
const dayLabel=d=>d.slice(8,10)+'/'+d.slice(5,7)+'/'+d.slice(0,4);
// ['01','02','03','05'] -> "janeiro a março e maio"
function monthsText(months){
 const parts=[];let start=null,prev=null;
 for(const m of [...months].sort().map(Number)){
  if(start===null){start=prev=m;continue;}
  if(m===prev+1){prev=m;continue;}
  parts.push([start,prev]);start=prev=m;
 }
 if(start!==null)parts.push([start,prev]);
 const t=parts.map(([a,b])=>a===b?monthName(a):monthName(a)+' a '+monthName(b));
 return t.length<=1?t.join(''):t.slice(0,-1).join(', ')+' e '+t.at(-1);
}
const windowText=w=>monthsText(w.months);
function describe(scope){
 return scope.runs.map(r=>(r.first===r.last?label(r.first):label(r.first)+' a '+label(r.last))+
  (r.last_day&&r===scope.runs.at(-1)?' (dados até '+dayLabel(r.last_day)+')':'')).join('; ');
}
// What part of an asked period the scope holds, as warnings. Never silent.
function periodNotes(scope,p,who=''){
 const notes=[],of=who?' para '+who:'';
 if(!accepts(scope,p))return ['⚠️ Sem dados na fonte para '+(p.length===4?p:label(p))+of+
  ': ausência de dados não significa venda zero.'];
 if(scope.unverified)return ['⚠️ Cobertura própria'+of+' não verificada: os meses do grupo só localizam o período,'+
  ' sem presumir que '+(who||'a loja')+' tenha dados em todos eles.'];
 if(p.length===7){
  if(!monthComplete(scope,p)){
   const r=runOf(scope,p);
   notes.push('⚠️ '+label(p)+' é parcial'+of+(p===r.last&&r.last_day?': dados só até '+dayLabel(r.last_day):
    ': os dados começam no meio do mês')+'.');
  }
  return notes;
 }
 const present=presentMonths(scope,p),complete=completeMonths(scope,p);
 if(present.length<12)notes.push('⚠️ '+p+of+': dados só de '+monthsText(present)+
  '; meses sem dados não significam venda zero.');
 const partial=present.filter(m=>!complete.includes(m));
 if(partial.length)notes.push('⚠️ '+p+of+': '+monthsText(partial)+(partial.length>1?' parciais.':' parcial.'));
 return notes;
}
module.exports={MIN_MONTH,BASELINE,STORES,validMonth,validDay,monthEnd,fromRows,validate,scopeOf,
 accepts,isPartial,monthComplete,presentMonths,completeMonths,yearWindow,yearForMonth,latestMonth,
 monthName,label,dayLabel,monthsText,windowText,describe,periodNotes,monthAt,index};
