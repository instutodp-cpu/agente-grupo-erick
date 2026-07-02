'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { classifyIntent, buildTemplateExecution } = require('../src/hermes/sql-templates');

// ── Classificador de intenção ────────────────────────────────────────────────

test('classifyIntent: faturamento mensal por loja exige mês e ano', () => {
  const match = classifyIntent('Qual foi o faturamento de cada loja em junho de 2026?');
  assert.ok(match, 'deveria casar um template');
  assert.strictEqual(match.intent, 'monthly_revenue_by_store');
});

test('classifyIntent: faturamento por loja sem mês/ano não casa (ambíguo)', () => {
  const match = classifyIntent('Qual foi o faturamento de cada loja?');
  assert.strictEqual(match, null);
});

test('classifyIntent: pergunta fora dos templates retorna null (vai pro fallback)', () => {
  assert.strictEqual(classifyIntent('Qual a cor preferida do Erick?'), null);
  assert.strictEqual(classifyIntent(''), null);
});

// ── Perguntas frequentes da tela (public/index.html) ─────────────────────────
// Cada chip da tela precisa continuar casando com o template correto.

const PERGUNTAS_DA_TELA = [
  ['Qual foi o faturamento de cada loja em junho de 2026?', 'monthly_revenue_by_store'],
  ['Quanto cada loja tem de inadimplência recuperável agora?', 'recoverable_delinquency_by_store'],
  ['Compare o faturamento de 2025 vs 2024 por loja', 'revenue_year_comparison_by_store'],
  ['Quais os 10 produtos mais vendidos nos últimos 6 meses?', 'top_products_last_six_months'],
  ['Quem foram os melhores vendedores em 2025?', 'top_salespeople_by_year'],
  ['Qual o ticket médio de cada loja nos últimos 3 meses?', 'average_ticket_last_three_months']
];

for (const [pergunta, intentEsperado] of PERGUNTAS_DA_TELA) {
  test(`pergunta frequente casa com ${intentEsperado}`, () => {
    const match = classifyIntent(pergunta);
    assert.ok(match, `"${pergunta}" deveria casar um template`);
    assert.strictEqual(match.intent, intentEsperado);
  });
}

// ── buildTemplateExecution ───────────────────────────────────────────────────

test('buildTemplateExecution: retorna execução completa para pergunta da tela', () => {
  const exec = buildTemplateExecution('Qual foi o faturamento de cada loja em junho de 2026?');
  assert.ok(exec);
  assert.strictEqual(exec.intent, 'monthly_revenue_by_store');
  assert.ok(exec.templateName, 'templateName presente');
  assert.ok(exec.templateVersion, 'templateVersion presente');
  assert.match(exec.sql, /^\s*SELECT/i, 'SQL do template começa com SELECT');
  assert.ok(Array.isArray(exec.values), 'values é um array de parâmetros');
  assert.strictEqual(typeof exec.format, 'function', 'format é função');
});

test('buildTemplateExecution: pergunta sem template retorna null', () => {
  assert.strictEqual(buildTemplateExecution('bom dia, tudo bem?'), null);
});
