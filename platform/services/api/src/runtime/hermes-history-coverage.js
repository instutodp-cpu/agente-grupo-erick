'use strict';
// Which months the history sources actually hold, read from the sources
// themselves (MIN/MAX of the view), never from a calendar written in code.
// Until a reading is validated, the last VERIFIED coverage applies (fail
// closed): a period outside it is refused, never guessed.
const MIN_MONTH='2000-01';
const MONTH=/^(20[0-9]{2})-(0[1-9]|1[0-2])$/;
const DAY=/^(20[0-9]{2})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const NAMES=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto',
 'setembro','outubro','novembro','dezembro'];
// Verified on the staging history (hermes_history views) before week 4:
// sales 2025-01..2026-06 ending on 2026-06-08; products only 2026.
const BASELINE=Object.freeze({
 origin:'baseline',read_at:null,
 commercial:Object.freeze({first_month:'2025-01',last_month:'2026-06',last_day:'2026-06-08'}),
 products:Object.freeze({first_month:'2026-01',last_month:'2026-06',last_day:null})
});
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
function validScope(s,nowMonth){
 if(!s||typeof s!=='object'||!validMonth(s.first_month)||!validMonth(s.last_month)||
  s.first_month>s.last_month||(nowMonth&&s.last_month>nowMonth))return false;
 if(s.last_day!==null&&(!validDay(s.last_day)||s.last_day.slice(0,7)!==s.last_month))return false;
 return true;
}
// rows: [{scope:'commercial'|'products',first_month,last_month,last_day}]
function fromRows(rows,now,readAt=now){
 if(!Array.isArray(rows)||rows.length!==2)throw Error('coverage_rows_invalid');
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(readAt)||readAt>now+60000)
  throw Error('coverage_time_invalid');
 const nowMonth=new Date(now).toISOString().slice(0,7);
 const out={origin:'source',read_at:new Date(readAt).toISOString()};
 for(const r of rows){
  if(!r||!['commercial','products'].includes(r.scope)||out[r.scope])throw Error('coverage_rows_invalid');
  const s={first_month:r.first_month,last_month:r.last_month,last_day:r.last_day??null};
  if(!validScope(s,nowMonth))throw Error('coverage_scope_invalid');
  out[r.scope]=Object.freeze(s);
 }
 // A sales history without its last day cannot say what is partial.
 if(out.commercial.last_day===null)throw Error('coverage_last_day_required');
 return Object.freeze(out);
}
// A stored coverage (state file) is re-validated on every load, keeping
// when it was read so that its age is real.
function validate(c,now){
 if(c===BASELINE)return c;
 if(!c||c.origin!=='source'||typeof c.read_at!=='string'||
  !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(c.read_at))throw Error('coverage_invalid');
 return fromRows([{scope:'commercial',...c.commercial},{scope:'products',...c.products}],now,
  Date.parse(c.read_at));
}
const scopeOf=(coverage,name)=>(coverage||BASELINE)[name]||BASELINE[name];
function accepts(scope,p){
 if(typeof p!=='string')return false;
 if(/^20[0-9]{2}$/.test(p))return p>=scope.first_month.slice(0,4)&&p<=scope.last_month.slice(0,4);
 return validMonth(p)&&p>=scope.first_month&&p<=scope.last_month;
}
// The last month is partial unless the last day closes it; an unknown last
// day counts as partial. The first month is taken as complete (to confirm
// with the source audit; a first_day field would refine it).
function lastPartial(scope){return scope.last_day===null||scope.last_day!==monthEnd(scope.last_month);}
function isPartial(scope,p){
 if(!accepts(scope,p))return true;
 if(p.length===4){
  const w=completeMonths(scope,p);
  return !w||w.from!==1||w.to!==12;
 }
 return p===scope.last_month&&lastPartial(scope);
}
// Complete months of one year inside the coverage, as month numbers.
function completeMonths(scope,year){
 if(!/^20[0-9]{2}$/.test(year)||!accepts(scope,year))return null;
 const y=Number(year),first=index(scope.first_month),last=index(scope.last_month)-(lastPartial(scope)?1:0);
 const from=Math.max(y*12,first),to=Math.min(y*12+11,last);
 return to<from?null:{from:from-y*12+1,to:to-y*12+1};
}
// Year against year only over the months complete in BOTH years.
function yearWindow(scope,a,b){
 const wa=completeMonths(scope,a),wb=completeMonths(scope,b);
 if(!wa||!wb)return null;
 const from=Math.max(wa.from,wb.from),to=Math.min(wa.to,wb.to);
 return to<from?null:{from:String(from).padStart(2,'0'),to:String(to).padStart(2,'0')};
}
// "março" without a year: the most recent March inside the coverage.
function yearForMonth(scope,mm){
 const last=Number(scope.last_month.slice(0,4));
 for(const y of [last,last-1]){if(accepts(scope,y+'-'+mm))return String(y);}
 return null;
}
const latestYear=scope=>scope.last_month.slice(0,4);
const monthName=n=>NAMES[Number(n)-1];
const label=m=>monthName(m.slice(5,7))+'/'+m.slice(0,4);
function windowText(w){
 return w.from===w.to?monthName(w.from):monthName(w.from)+' a '+monthName(w.to);
}
function describe(scope){
 return label(scope.first_month)+' a '+label(scope.last_month)+
  (scope.last_day?' (dados até '+scope.last_day.slice(8,10)+'/'+scope.last_day.slice(5,7)+'/'+
   scope.last_day.slice(0,4)+')':'');
}
module.exports={MIN_MONTH,BASELINE,validMonth,validDay,monthEnd,fromRows,validate,scopeOf,
 accepts,isPartial,lastPartial,completeMonths,yearWindow,yearForMonth,latestYear,monthName,
 label,windowText,describe,monthAt,index};
