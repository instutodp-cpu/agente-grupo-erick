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
// Original source labels are NOT confirmed ERP store IDs; keep their identity
// intact. A ratio from low volume is descriptive, never a risk classification.
function byStore({snapshot,now=Date.now(),validSnapshot}){
 if(!Number.isSafeInteger(now)||typeof validSnapshot!=='function'||
  !validSnapshot(snapshot,now))throw Error('diagnostic_stores_snapshot_denied');
 const items=snapshot.stores.map(v=>({
  raw_label:v.raw_label,registered:v.registered,
  marked_cancelled:v.marked_cancelled,
  rate:rate(v.marked_cancelled,v.registered)
 }));
 // Original order avoids suggesting an arbitrary business priority.
 const stamp=new Date(snapshot.extracted_at).toLocaleString('pt-BR',{
  timeZone:'America/Recife',hour12:false});
 const lines=[
  '🏬 Hermes — indicadores por código de loja (sem IA)',
  'Fonte: Supabase softcom_import.cadastro_de_vendas',
  'Extração verificada: '+stamp,
  'Período: jan–8 jun/2026 (junho parcial, julho ausente).',
  'Códigos originais do Softcom:',
  ...items.map(x=>'• '+x.raw_label+': '+
    count.format(x.marked_cancelled)+'/'+count.format(x.registered)+
    ' marcados cancelados ('+formatRate(x.marked_cancelled,x.registered)+')'),
  'Total conferido: '+count.format(snapshot.marked_cancelled)+'/'+
    count.format(snapshot.registered)+' ('+
    formatRate(snapshot.marked_cancelled,snapshot.registered)+')',
  '⚠️ Códigos originais NÃO conciliados a lojas físicas: CALCADOS, SIRINHAEM e as duas etiquetas SPORTS não identificam com segurança unidade/cidade.',
  'Taxas dependem do volume de registros; não são ranking financeiro, perda nem causa comprovada.',
  'Sem cruzamento mensal por código neste snapshot. Não atribuo o pico de maio a nenhuma loja.',
  'Próximos passos para revisão humana:',
  '1. Conciliar códigos antigos às unidades reais usando o ERP.',
  '2. Obter cancelamentos por mês, unidade e motivo antes de definir prioridades.',
  '3. Validar documentos, estornos e duplicidades sem presumir prejuízo.',
  'Somente snapshot datado, sem SQL, Codex ou execução.'
 ];
 const answer=lines.join('\n');
 if(answer.length>2200)throw Error('diagnostic_stores_output_oversize');
 return answer;
}
module.exports={build,byStore,rate,formatRate};
