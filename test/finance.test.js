'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const caps = require('../src/hermes/finance/finance-capabilities');
const { classifyFinancialIntent } = require('../src/hermes/finance/financial-intent-map');
const { buildFinancialResponse } = require('../src/hermes/finance/financial-response-builder');

// ── Catálogo ─────────────────────────────────────────────────────────────────

test('catálogo contém as 10 capacidades esperadas', () => {
  const esperadas = [
    'daily_revenue', 'monthly_revenue', 'accounts_receivable', 'accounts_payable',
    'cash_flow', 'top_customers', 'store_comparison', 'ticket_average',
    'payment_methods', 'financial_summary'
  ];
  for (const id of esperadas) {
    assert.ok(caps.isCapability(id), `capacidade ${id} presente`);
    const c = caps.getCapability(id);
    assert.strictEqual(c.id, id);
    assert.ok(typeof c.title === 'string' && c.title.length > 0);
    assert.ok(Array.isArray(c.sources));
    assert.ok(['available', 'partial', 'planned'].includes(c.status));
  }
  assert.strictEqual(caps.CAPABILITY_IDS.length, esperadas.length);
});

test('getCapability para id inválido retorna null', () => {
  assert.strictEqual(caps.getCapability('nao_existe'), null);
  assert.strictEqual(caps.isCapability('nao_existe'), false);
});

// ── Mapa de intenções ────────────────────────────────────────────────────────

const CASOS = [
  ['quanto vendemos hoje', 'daily_revenue'],
  ['qual o faturamento de hoje?', 'daily_revenue'],
  ['qual o faturamento do mês?', 'monthly_revenue'],
  ['quanto faturamos em junho de 2026', 'monthly_revenue'],
  ['quanto temos a receber?', 'accounts_receivable'],
  ['qual a inadimplência atual', 'accounts_receivable'],
  ['quanto temos a pagar', 'accounts_payable'],
  ['como está o fluxo de caixa', 'cash_flow'],
  ['quais os melhores clientes', 'top_customers'],
  ['qual loja vendeu mais', 'store_comparison'],
  ['qual o ticket médio', 'ticket_average'],
  ['quais as formas de pagamento mais usadas', 'payment_methods'],
  ['me dê um resumo financeiro', 'financial_summary']
];

for (const [pergunta, capability] of CASOS) {
  test(`classifyFinancialIntent: "${pergunta}" → ${capability}`, () => {
    const r = classifyFinancialIntent(pergunta);
    assert.ok(r, `deveria casar uma capacidade`);
    assert.strictEqual(r.capability, capability);
  });
}

test('classifyFinancialIntent: pergunta fora do escopo retorna null', () => {
  assert.strictEqual(classifyFinancialIntent('qual a cor preferida do Erick?'), null);
  assert.strictEqual(classifyFinancialIntent(''), null);
  assert.strictEqual(classifyFinancialIntent(null), null);
});

// ── V3: reconhecimento ampliado de daily_revenue (sem falso-positivo) ─────────

const DAILY_OK = [
  'quanto faturamos hoje',
  'vendas de hoje',
  'resultado de hoje',
  'movimento de hoje',
  'como foi o dia',
  'como foi o dia de hoje',
  'faturamento do dia',
  'movimento do dia',
  'resultado do dia',
  'qual a maior venda de hoje'
];

for (const q of DAILY_OK) {
  test(`daily_revenue (V3) reconhece: "${q}"`, () => {
    const r = classifyFinancialIntent(q);
    assert.ok(r, 'deveria casar');
    assert.strictEqual(r.capability, 'daily_revenue');
  });
}

// Perguntas de outro período NÃO podem virar daily_revenue.
const DAILY_NAO = [
  'faturamento do mês',
  'faturamento mensal',
  'quanto faturamos em junho de 2026',
  'resultado do mês',
  'resultado do ano',
  'vendas de ontem',
  'faturamento da semana',
  'como foi o dia 15 de junho',
  'faturamento em maio',
  'faturamento do mês até hoje',
  'últimos 6 meses',
  'no mês passado'
];

for (const q of DAILY_NAO) {
  test(`daily_revenue (V3) NÃO dispara para outro período: "${q}"`, () => {
    const r = classifyFinancialIntent(q);
    assert.notStrictEqual(r && r.capability, 'daily_revenue');
  });
}

test('daily_revenue (V3): sem "hoje"/"dia" não dispara', () => {
  assert.notStrictEqual((classifyFinancialIntent('quanto vendemos') || {}).capability, 'daily_revenue');
  assert.notStrictEqual((classifyFinancialIntent('qual o faturamento') || {}).capability, 'daily_revenue');
});

// ── Construtor de resposta (interface) ───────────────────────────────────────

test('buildFinancialResponse: capacidade válida → interface segura, não implementada', () => {
  const r = buildFinancialResponse('monthly_revenue', [{ loja: 'X' }]);
  assert.strictEqual(r.capability, 'monthly_revenue');
  assert.strictEqual(r.implemented, false);
  assert.strictEqual(r.text, null);
  assert.strictEqual(r.meta.title, 'Faturamento mensal');
});

test('buildFinancialResponse: capacidade inválida não lança e sinaliza erro', () => {
  const r = buildFinancialResponse('nao_existe', {});
  assert.strictEqual(r.capability, null);
  assert.strictEqual(r.implemented, false);
  assert.strictEqual(r.meta.error, 'unknown_capability');
});

test('buildFinancialResponse: robusto sem argumentos', () => {
  assert.doesNotThrow(() => buildFinancialResponse());
});
