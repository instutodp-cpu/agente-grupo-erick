'use strict';
// Conservative, deterministic quality signals from the already verified
// monthly × original-store aggregate. No ERP store mapping or cause inference.
const matrix=require('./hermes-store-month-matrix');
const history=require('./hermes-softcom-live-reader');
const decisions=require('./hermes-owner-decision-memory');
const {rate,formatRate}=require('./hermes-owner-diagnostic');
const count=new Intl.NumberFormat('pt-BR');
const pp=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const MIN_COMPARABLE=100,MIN_DELTA_PP=2,MIN_CANCEL_DELTA=10;
const LOW_COVERAGE=20;
function render({snapshot,aggregate,validSnapshot,decisions:rawDecisions=null,now=Date.now()}){
 // Existing source reconciler must succeed before emitting ANY signal.
 matrix.render({snapshot,aggregate,validSnapshot,now});
 const ledger=decisions.validateStore(rawDecisions,now);
 const confirmed=ledger.entries.filter(e=>e.area==='financeiro').at(-1);
 const cells=new Map(aggregate.rows.map(x=>[x.month+'|'+x.raw_store,x]));
 const get=(month,code)=>cells.get(month+'|'+code)||{registered:0,marked_cancelled:0};
 const rateChanges=[],coverage=[];
 for(const code of history.STORES){
  const old=get('2026-04',code),current=get('2026-05',code);
  const markedDelta=current.marked_cancelled-old.marked_cancelled;
  const deltaPP=rate(current.marked_cancelled,current.registered)-
   rate(old.marked_cancelled,old.registered);
  if(old.registered>=MIN_COMPARABLE&&current.registered>=MIN_COMPARABLE&&
   deltaPP>=MIN_DELTA_PP&&markedDelta>=MIN_CANCEL_DELTA){
   rateChanges.push('• '+code+': abr '+count.format(old.marked_cancelled)+'/'+
    count.format(old.registered)+' ('+formatRate(old.marked_cancelled,old.registered)+')'+
    ' → mai '+count.format(current.marked_cancelled)+'/'+
    count.format(current.registered)+' ('+
    formatRate(current.marked_cancelled,current.registered)+'); +'+
    pp.format(deltaPP)+' p.p.');
  } else if(Math.min(old.registered,current.registered)<LOW_COVERAGE&&
   Math.max(old.registered,current.registered)>=MIN_COMPARABLE){
   coverage.push('• '+code+': abr '+count.format(old.registered)+
    ' → mai '+count.format(current.registered)+' registros; taxa não comparável.');
  }
 }
 const when=new Date(aggregate.queried_at).toLocaleString('pt-BR',{
  timeZone:'America/Recife',hour12:false});
 const lines=[
  '🔎 Hermes — alertas históricos fundamentados (sem IA)',
  'Fonte: hermes_history.daily_sales_v1, consulta '+when,
  'Jan–8 jun/2026; comparação exclusiva abril → maio.',
  'A fonte foi conciliada com os totais mensais e códigos do snapshot privado.',
  'Aumentos observados nas taxas de registros marcados cancelados:',
  '(Regra: ≥100 registros em cada mês, +2,00 p.p. e ≥10 cancelados a mais)',
  ...(rateChanges.length?rateChanges:['• Nenhum atingiu os critérios nesta comparação.']),
  'Mudanças de cobertura (um mês com menos de 20 registros e outro com ≥100):',
  ...(coverage.length?coverage:['• Nenhuma atingiu os critérios.']),
  'Decisão financeira confirmada: '+(confirmed?
   confirmed.id+' | '+confirmed.decision:'nenhuma registrada'),
  'Próximas conferências humanas, não executadas:',
  '1. Comparar documentos e estornos dos códigos com maior variação.',
  '2. Verificar migração de códigos e alteração de cobertura entre meses.',
  '3. Conciliar códigos de Softcom às lojas físicas pelo ERP oficial.',
  '⚠️ Alerta estatístico DESCRITIVO: não é fraude, prejuízo, causa nem variação de faturamento.',
  'Junho é parcial; códigos históricos NÃO equivalem a filiais conciliadas.',
  'Sem dados pessoais, LLM, consulta fora da visão autorizada ou operação de escrita.'
 ];
 const result=lines.join('\n');
 if(result.length>3150)throw Error('history_alert_output_oversize');
 return result;
}
module.exports={render,MIN_COMPARABLE,MIN_DELTA_PP,MIN_CANCEL_DELTA,LOW_COVERAGE};