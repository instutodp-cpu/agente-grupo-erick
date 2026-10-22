'use strict';
// Read-only snapshot diagnostic. No prompts, LLM, fresh SQL or actions.
// Trusts only the already validated exact-tenant historical snapshot and
// human-confirmed enterprise decisions, never inferred execution.
const decisionsMemory=require('./hermes-owner-decision-memory');
const count=new Intl.NumberFormat('pt-BR');
const percent=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
function rate(n,denom){return denom===0?null:(100*n)/denom;}
function formatRate(n,denom){
 const x=rate(n,denom);
 return x===null?'sem base':percent.format(x)+'%';
}
function build({snapshot,decisions,now=Date.now(),validSnapshot}){
 if(!Number.isSafeInteger(now)||typeof validSnapshot!=='function'||
  !validSnapshot(snapshot,now))throw Error('diagnostic_snapshot_denied');
 const store=decisionsMemory.validateStore(decisions,now);
 const completed=snapshot.months.filter(m=>m.month!=='2026-06');
 if(completed.length!==5||completed.some(m=>m.registered<1))
  throw Error('diagnostic_comparison_denied');
 const sorted=[...completed].sort((a,b)=>
  rate(b.marked_cancelled,b.registered)-rate(a.marked_cancelled,a.registered));
 const highest=sorted[0],lowest=sorted.at(-1);
 const stamp=new Date(snapshot.extracted_at).toLocaleString('pt-BR',{
  timeZone:'America/Recife',hour12:false});
 const confirmed=store.entries.filter(e=>e.area==='financeiro').slice(-1)[0];
 const lines=[
  '📊 Hermes — diagnóstico histórico (sem IA)',
  'Fonte verificada: Supabase softcom_import.cadastro_de_vendas',
  'Extração: '+stamp,
  'Cobertura: jan–8 jun/2026; junho parcial. Julho ausente.',
  'Registros: '+count.format(snapshot.registered),
  'Marcados cancelados: '+count.format(snapshot.marked_cancelled)+
   ' ('+formatRate(snapshot.marked_cancelled,snapshot.registered)+')',
  'Registros não marcados cancelados: '+
   count.format(snapshot.registered-snapshot.marked_cancelled),
  'Meses completos (jan–mai/2026):',
  ...completed.map(m=>'• '+m.month+': '+count.format(m.marked_cancelled)+
   '/'+count.format(m.registered)+' ('+
   formatRate(m.marked_cancelled,m.registered)+')'),
  'Maior taxa entre meses completos: '+highest.month+
   ' ('+formatRate(highest.marked_cancelled,highest.registered)+')',
  'Menor taxa entre meses completos: '+lowest.month+
   ' ('+formatRate(lowest.marked_cancelled,lowest.registered)+')',
  'Diferença observada: '+percent.format(
   rate(highest.marked_cancelled,highest.registered)-
   rate(lowest.marked_cancelled,lowest.registered))+' pontos percentuais.',
  'Decisão humana financeira confirmada: '+
   (confirmed?confirmed.id+' | '+confirmed.decision:
    'nenhuma registrada'),
  'Ações sugeridas para revisão humana (não executadas):',
  '1. Conferir amostra de cancelamentos de '+highest.month+' por loja e motivo.',
  '2. Comparar lançamentos, estornos e duplicidades com fontes oficiais.',
  '3. Conciliar Softcom e ERP antes de novos compromissos.',
  '⚠️ Cancelamento marcado não comprova perda financeira, estorno, causa ou faturamento.',
  'Snapshot datado, códigos de lojas não conciliados; nenhuma consulta online ou ação efetuada.'
 ];
 const answer=lines.join('\n');
 if(answer.length>2200)throw Error('diagnostic_output_oversize');
 return answer;
}
module.exports={build,rate,formatRate};
