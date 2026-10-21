'use strict';
// Deterministic, read-only executive checks derived exclusively from the
// validated official Compras homologacao aggregate. No notifications or writes.
const VERSION='commercial_priority_brief_v1';
function day(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('date_invalid');
 const epoch=Date.parse(value+'T00:00:00.000Z');
 if(!Number.isFinite(epoch)||new Date(epoch).toISOString().slice(0,10)!==value)
  throw Error('date_invalid');
 return epoch;
}
function cents(value){
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e10)
  throw Error('money_invalid');
 const v=Math.round(value*100);
 if(!Number.isSafeInteger(v)||Math.abs(value*100-v)>0.0001)
  throw Error('money_invalid');
 return v;
}
function validCount(n){return Number.isSafeInteger(n)&&n>=0&&n<=1e7;}
function createHermesCommercialPriorityBrief(summary,{clock=()=>Date.now()}={}){
 if(!summary||summary.source!=='Compras homologacao'||
   summary.company!=='Grupo Erick'||summary.source_state!=='homologacao'||
   summary.erp_linx_conciliated!==false||
   !validCount(summary.active_stores)||summary.active_stores<1||
   summary.active_stores>20)throw Error('source_scope_invalid');
 const now=clock();
 if(!Number.isSafeInteger(now))throw Error('clock_invalid');
 const today=new Date(now).toLocaleDateString('sv-SE',{timeZone:'America/Recife'});
 const age=day(today)-day(summary.as_of);
 if(age<0||age>86400000)throw Error('stale_or_future_snapshot');
 const purchases=summary.purchases_last_30_days;
 const open=summary.open_titles,overdue=summary.overdue_titles;
 const next=summary.next_30_days_titles;
 if([purchases,open,overdue,next].some(x=>!x||!validCount(x.count)))
  throw Error('count_invalid');
 const amount={purchases:cents(purchases.net_brl),open:cents(open.balance_brl),
  overdue:cents(overdue.balance_brl),next:cents(next.balance_brl)};
 if(overdue.count>open.count||next.count>open.count||
    amount.overdue>amount.open||amount.next>amount.open||
    amount.overdue+amount.next>amount.open)
  throw Error('inconsistent_titles');
 const percentage=amount.open?
  Math.round(amount.overdue*10000/amount.open)/100:0;
 const alerts=[];
 if(overdue.count>0&&amount.overdue>0)
  alerts.push(Object.freeze({code:'verify_overdue',priority:1,
   status:'review_required',count:overdue.count,
   amount_brl:amount.overdue/100,share_of_open_balance_percent:percentage,
   action:'Conferir vencimentos, pagamentos e duplicidades antes de qualquer decisão'}));
 if(next.count>0&&amount.next>0)
  alerts.push(Object.freeze({code:'review_next_30_days',priority:2,
   status:'review_required',count:next.count,amount_brl:amount.next/100,
   action:'Conferir previsão de caixa e títulos que vencem nos próximos 30 dias'}));
 alerts.push(Object.freeze({code:'reconcile_linx',priority:3,
  status:'unverified',count:null,amount_brl:null,
  action:'Conciliar os dados do aplicativo com o ERP Linx'}));
 return Object.freeze({
  version:VERSION,source:'Compras homologacao',company:'Grupo Erick',
  source_state:'homologacao',erp_linx_conciliated:false,
  as_of:summary.as_of,source_age_days:age/86400000,
  active_stores:summary.active_stores,
  purchases_last_30_days:{count:purchases.count,net_brl:amount.purchases/100},
  open_titles:{count:open.count,balance_brl:amount.open/100},
  overdue_titles:{count:overdue.count,balance_brl:amount.overdue/100,
   share_of_open_balance_percent:percentage},
  next_30_days_titles:{count:next.count,balance_brl:amount.next/100},
  alerts,alerts_dispatched:false,external_write_performed:false,
  payment_authorized:false,financial_decision_automated:false
 });
}
module.exports={VERSION,createHermesCommercialPriorityBrief};
