'use strict';

// ── Hermes Financeiro — Execução (integração segura) ─────────────────────────
//
// Produz um objeto de execução COMPATÍVEL com o motor de SQL Templates do
// `/api/chat` (mesmos campos: intent, templateName, templateVersion, cacheTtlMs,
// cacheProfile, description, sql, values, params, format). Assim o Hermes
// Financeiro reaproveita o mesmo caminho seguro: cache existente, query
// parametrizada e logs — sem duplicar lógica.
//
// V2: apenas `daily_revenue` está integrado. Só retorna execução quando o match
// é CLARO; caso contrário retorna null e o fluxo atual (templates/Claude) segue.

const { classifyFinancialIntent } = require('./financial-intent-map');
const { buildFinancialResponse } = require('./financial-response-builder');

function toDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

// SQL seguro (SELECT parametrizado) para faturamento do dia por loja.
const DAILY_REVENUE_SQL = `
  SELECT
    loja,
    COUNT(DISTINCT codigo_da_venda) AS qtd_vendas,
    SUM(quantidade)::numeric AS itens,
    SUM(valor_total)::numeric AS faturamento
  FROM public.vw_itens_vendidos
  WHERE data_venda::date = $1::date
    AND loja NOT LIKE '%DESATIVADO%'
    AND (itemdevolvido IS NULL OR itemdevolvido::text <> 'True')
  GROUP BY loja
  ORDER BY faturamento DESC;
`;

function buildDailyRevenueExecution() {
  const targetDate = toDateOnly(new Date());
  const params = { targetDate, dateLabel: `hoje (${targetDate})` };

  return {
    capability: 'daily_revenue',
    intent: 'daily_revenue',
    templateName: 'finance_daily_revenue',
    templateVersion: 'v1',
    cacheTtlMs: 10 * 60 * 1000, // 10 min — dado do dia muda ao longo do dia
    cacheProfile: 'current_day',
    description: 'Faturamento do dia por loja.',
    sql: DAILY_REVENUE_SQL,
    values: [params.targetDate],
    params,
    format: rows => buildFinancialResponse('daily_revenue', rows, { params }).text
  };
}

// Dispatcher: só integra capacidades já ativadas (V2 = daily_revenue).
const BUILDERS = {
  daily_revenue: buildDailyRevenueExecution
};

/**
 * Se a pergunta casar CLARAMENTE com uma capacidade financeira já integrada,
 * devolve a execução compatível; caso contrário `null` (mantém o fallback).
 * @param {string} question
 */
function buildFinanceExecution(question) {
  const match = classifyFinancialIntent(question);
  if (!match) return null;

  const builder = BUILDERS[match.capability];
  if (!builder) return null; // capacidade detectada mas ainda não integrada

  return builder(question);
}

module.exports = {
  buildFinanceExecution,
  DAILY_REVENUE_SQL
};
