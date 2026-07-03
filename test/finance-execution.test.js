'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { buildFinanceExecution } = require('../src/hermes/finance/finance-execution');
const { buildFinancialResponse } = require('../src/hermes/finance/financial-response-builder');

// "Hoje" no fuso do negócio (America/Recife), coerente com finance-execution.
const HOJE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife' }).format(new Date());

// ── Detecção clara → execução daily_revenue ──────────────────────────────────

const PERGUNTAS_CLARAS = [
  'quanto vendemos hoje?',
  'faturamento de hoje',
  'como foram as vendas hoje?'
];

for (const q of PERGUNTAS_CLARAS) {
  test(`buildFinanceExecution: "${q}" → daily_revenue`, () => {
    const ex = buildFinanceExecution(q);
    assert.ok(ex, 'deveria produzir execução');
    assert.strictEqual(ex.capability, 'daily_revenue');
    assert.strictEqual(ex.templateName, 'finance_daily_revenue');
    assert.strictEqual(ex.templateVersion, 'v1');
    assert.deepStrictEqual(ex.values, [HOJE]);
    assert.match(ex.sql, /^\s*SELECT/i);
    assert.strictEqual(typeof ex.format, 'function');
  });
}

test('execução é compatível com o motor de templates (campos obrigatórios)', () => {
  const ex = buildFinanceExecution('quanto vendemos hoje?');
  for (const campo of ['intent', 'templateName', 'templateVersion', 'cacheTtlMs', 'cacheProfile', 'description', 'sql', 'values', 'params', 'format']) {
    assert.ok(campo in ex, `campo ${campo} presente`);
  }
});

test('SQL do daily_revenue é apenas leitura e usa view permitida', () => {
  const ex = buildFinanceExecution('quanto vendemos hoje?');
  assert.match(ex.sql, /vw_itens_vendidos/);
  assert.doesNotMatch(ex.sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
  assert.match(ex.sql, /\$1/); // parametrizado
});

// ── Perguntas ambíguas / fora do escopo → fallback (null) ────────────────────

test('perguntas ambíguas ou não-financeiras retornam null (mantêm fallback)', () => {
  for (const q of ['bom dia', 'obrigado', 'quais os 10 produtos mais vendidos', 'me fale sobre o universo', '']) {
    assert.strictEqual(buildFinanceExecution(q), null, `deveria cair no fallback: ${JSON.stringify(q)}`);
  }
});

test('capacidade financeira ainda não integrada retorna null (ex.: fluxo de caixa)', () => {
  // cash_flow é detectável pelo mapa, mas não integrado em V2.
  assert.strictEqual(buildFinanceExecution('como está o fluxo de caixa'), null);
});

// ── Formatação da resposta ───────────────────────────────────────────────────

test('buildFinancialResponse(daily_revenue): formata tabela com total', () => {
  const r = buildFinancialResponse('daily_revenue', [
    { loja: 'CALCADOS', qtd_vendas: 12, itens: 30, faturamento: 4520.5 },
    { loja: 'MAGAZINE', qtd_vendas: 5, itens: 9, faturamento: 1200 }
  ], { params: { dateLabel: 'hoje (2026-07-03)' } });

  assert.strictEqual(r.implemented, true);
  assert.strictEqual(r.capability, 'daily_revenue');
  assert.match(r.text, /Faturamento do dia/);
  assert.match(r.text, /CALCADOS/);
  assert.match(r.text, /Total do dia/);
  assert.match(r.text, /R\$/);
});

test('buildFinancialResponse(daily_revenue): sem linhas → mensagem amigável', () => {
  const r = buildFinancialResponse('daily_revenue', [], { params: { dateLabel: 'hoje' } });
  assert.strictEqual(r.implemented, true);
  assert.match(r.text, /Não encontrei vendas/);
});
