'use strict';

// ── Hermes Financeiro — Construtor de resposta ───────────────────────────────
//
// Formata respostas financeiras a partir de dados já consultados. Nesta versão
// (V2) a capacidade `daily_revenue` está implementada; as demais permanecem como
// interface (`implemented: false`) até serem ativadas.

const { getCapability, isCapability } = require('./finance-capabilities');

function formatCurrency(value) {
  const number = Number(value || 0);
  return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('pt-BR');
}

function markdownTable(headers, rows) {
  const headerLine = `| ${headers.join(' | ')} |`;
  const separatorLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map(row => `| ${row.join(' | ')} |`).join('\n');
  return [headerLine, separatorLine, body].filter(Boolean).join('\n');
}

// ── Formatação: daily_revenue ────────────────────────────────────────────────
function formatDailyRevenue(rows, params = {}) {
  const label = params.dateLabel || 'hoje';
  if (!Array.isArray(rows) || rows.length === 0) {
    return `Não encontrei vendas registradas em ${label}.`;
  }

  const total = rows.reduce((sum, row) => sum + Number(row.faturamento || 0), 0);
  const totalVendas = rows.reduce((sum, row) => sum + Number(row.qtd_vendas || 0), 0);

  return [
    `### Faturamento do dia — ${label}`,
    markdownTable(
      ['Loja', 'Vendas', 'Itens', 'Faturamento'],
      rows.map(row => [
        row.loja,
        formatNumber(row.qtd_vendas),
        formatNumber(row.itens),
        formatCurrency(row.faturamento)
      ])
    ),
    `**Total do dia:** ${formatCurrency(total)} em ${formatNumber(totalVendas)} vendas`,
    `_Período consultado: ${label}. Fonte: public.vw_itens_vendidos._`
  ].join('\n\n');
}

const FORMATTERS = {
  daily_revenue: formatDailyRevenue
};

/**
 * Constrói a resposta formatada de uma capacidade financeira.
 * Capacidades sem formatter implementado retornam interface (`implemented:false`).
 *
 * @param {string} capability Id da capacidade (ver finance-capabilities).
 * @param {object|Array} [data] Dados já consultados (linhas/agregados).
 * @param {object} [options] Ex.: { params } para contexto de formatação.
 * @returns {{capability:(string|null), implemented:boolean, text:(string|null), meta:object}}
 */
function buildFinancialResponse(capability, data = null, options = {}) {
  if (!isCapability(capability)) {
    return { capability: null, implemented: false, text: null, meta: { error: 'unknown_capability' } };
  }

  const info = getCapability(capability);
  const formatter = FORMATTERS[capability];

  if (!formatter) {
    return {
      capability,
      implemented: false,
      text: null,
      meta: { title: info.title, status: info.status, note: 'Formatação ainda não implementada.' }
    };
  }

  const rows = Array.isArray(data) ? data : [];
  const text = formatter(rows, options.params || {});
  return {
    capability,
    implemented: true,
    text,
    meta: { title: info.title, status: info.status, rowCount: rows.length }
  };
}

module.exports = {
  buildFinancialResponse
};
