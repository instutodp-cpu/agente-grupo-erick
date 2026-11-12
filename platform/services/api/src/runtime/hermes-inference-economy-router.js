'use strict';
// Stage 1 of the inference economy router. No model classifies this request.
// For unambiguous allowlisted analytical questions, a verified template is
// sufficient for tool planning: the LLM is used only for final interpretation.
// Unknown/ambiguous requests keep the existing governed LLM planner.
const analyst=require('./hermes-analyst-templates');
const MAX_GOAL=600;
function route(goal){
 if(typeof goal!=='string'||goal.length<8||goal.length>MAX_GOAL)return null;
 const q=analyst.normalize(goal);
 if(q.startsWith('/')||/[<>|{}]/.test(q))return null;
 // Exclude personal data, actions, material outside the available read-only
 // historical scope, and references that make a single metric ambiguous.
 if(/\b(?:cpf|cnpj|senha|token|chave|pix|transferir|transferencia|pagar|apagar|editar|excluir|publicar|enviar|sql|terminal|github|whatsapp|instagram|cliente|clientes|lucro|margem|imposto|tributo|estoque|ticket|inadimplencia|prejuizo|custos|despesas|marketing|lotoia)\b/.test(q))return null;
 if(!/\b(?:analise|analisar|avaliar|compare|comparar|explique|recomende|recomendar|sugira|sugerir|riscos|risco|prioridades|insights)\b/.test(q))return null;
 // Explicit periods/years required; no silent default to 2026.
 if(!/\b202[56]\b/.test(q))return null;
 const money=/\b(?:faturamento|faturou|receita|valor pago|valores pagos)\b/.test(q);
 const cancelled=/\b(?:cancelamento|cancelamentos|cancelados|canceladas)\b/.test(q);
 const records=/\b(?:venda|vendas|vendeu|vendemos|registros|registro)\b/.test(q);
 // A multi-metric request needs model judgment to plan which queries to run.
 if([money,cancelled,records].filter(Boolean).length!==1)return null;
 const plan=analyst.planQuestion(goal);
 if(!plan||plan.template==='products'||plan.template==='stores')return null;
 if(plan.metric!==(money?'money':cancelled?'cancelled':'records'))return null;
 try{analyst.validate(plan);}catch{return null}
 const steps=[{tool:'history',params:plan}];
 const commercial=/\b(?:compras|duplicatas)\b/.test(q);
 if(commercial)steps.push({tool:'compras',params:{}});
 return {steps,policy:'static_verified_history_v1',estimated_planner_calls_avoided:1};
}
module.exports={route};
