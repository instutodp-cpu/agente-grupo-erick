'use strict';

// ── Hermes Financeiro — Mapa de intenções ────────────────────────────────────
//
// FUNDAÇÃO (Sprint 1). Mapeia, de forma LÉXICA e determinística, perguntas
// financeiras para uma capacidade do catálogo (`finance-capabilities.js`).
// Não executa nada, não altera o chat/SQL/cache/frontend e não está integrado.
//
// A ordem das regras importa: as mais específicas vêm primeiro.

const { isCapability } = require('./finance-capabilities');

function normalize(text = '') {
  return String(text == null ? '' : text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Marcadores de OUTRO período: se aparecerem, a pergunta NÃO é sobre "hoje" e
// não deve disparar daily_revenue (evita falso-positivo para mês/ano/semana/
// ontem/dia específico). Texto já vem normalizado (sem acento).
const DAILY_EXCLUDE = [
  /\b20\d{2}\b/,                 // ano explícito (ex.: 2026)
  /\bmes\b/, /\bmeses\b/, /\bmensal\b/,
  /\bano\b/, /\banos\b/, /\banual\b/,
  /\bsemana\b/, /\bsemanal\b/,
  /\bontem\b/,
  /\bdia \d/,                    // "dia 15"
  /\bultim/,                     // últimos/última(s)
  /\bpassad/,                    // mês/ano passado
  /\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/
];

// Regras (capability + padrões). Primeiro match vence.
// `exclude` (opcional): se algum padrão de exclusão casar, a regra é ignorada.
const RULES = [
  { capability: 'ticket_average', patterns: [/ticket medio/] },
  { capability: 'payment_methods', patterns: [/forma(s)? de pagamento/, /meio(s)? de pagamento/, /como (os )?clientes pagam/, /metodo(s)? de pagamento/] },
  { capability: 'accounts_payable', patterns: [/conta(s)? a pagar/, /a pagar/, /quanto (temos|devemos) (a )?pagar/, /o que (temos|ha) a pagar/] },
  { capability: 'accounts_receivable', patterns: [/conta(s)? a receber/, /a receber/, /recebiveis/, /quanto (temos|tem|ha) a receber/, /inadimplencia/, /parcelas em aberto/, /vencid(o|a|os|as)/] },
  { capability: 'cash_flow', patterns: [/fluxo de caixa/, /entradas e saidas/, /movimenta(cao|coes) de caixa/] },
  { capability: 'top_customers', patterns: [/melhores clientes/, /maiores clientes/, /top clientes/, /clientes que mais compram/, /principais clientes/] },
  { capability: 'store_comparison', patterns: [/compar(ar|e|ativo) .*loja/, /qual loja (vende|fatura|faturou|vendeu) mais/, /ranking de lojas/, /loja que mais (vende|fatura)/, /desempenho (das|por) loja/] },
  {
    capability: 'daily_revenue',
    exclude: DAILY_EXCLUDE,
    patterns: [
      /vend(emos|eu|as)? (de )?hoje/,
      /venda(s)? (de )?hoje/,
      /faturamento (de )?hoje/,
      /faturamos (de )?hoje/,
      /faturei (de )?hoje/,
      /receita (de )?hoje/,
      /resultado (de )?hoje/,
      /movimento (de )?hoje/,
      /quanto vendemos hoje/,
      /venda(s)? do dia/,
      /faturamento do dia/,
      /resultado do dia/,
      /movimento do dia/,
      /como foi o dia/
    ]
  },
  { capability: 'monthly_revenue', patterns: [/faturamento (do )?mes/, /faturamento mensal/, /receita mensal/, /faturamento (de|em|no) [a-z]+ (de )?20\d{2}/, /quanto faturamos/, /faturamento por loja/] },
  { capability: 'financial_summary', patterns: [/resumo financeiro/, /panorama financeiro/, /situacao financeira/, /como (estao|esta) (as )?financas/, /visao geral financeira/] }
];

/**
 * Classifica uma pergunta financeira em uma capacidade do catálogo.
 * @param {string} question
 * @returns {{capability:string, matched:string}|null}
 */
function classifyFinancialIntent(question) {
  const text = normalize(question);
  if (!text) return null;

  for (const rule of RULES) {
    // Se a regra tem exclusões e o texto casa alguma, pula (evita falso-positivo).
    if (rule.exclude && rule.exclude.some(re => re.test(text))) continue;
    for (const pattern of rule.patterns) {
      if (pattern.test(text) && isCapability(rule.capability)) {
        return { capability: rule.capability, matched: pattern.source };
      }
    }
  }
  return null;
}

module.exports = {
  classifyFinancialIntent,
  RULES,
  normalize
};
