'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { classify, PATHS } = require('../src/hermes/intelligence/intent-classifier');
const { shouldCallClaude } = require('../src/hermes/intelligence/should-call-claude');
const { findReusableResponse, RESPONSE_LIBRARY_COLUMNS } = require('../src/hermes/intelligence/response-library');

// ── Classificador ────────────────────────────────────────────────────────────

test('classify: retorna o formato esperado', () => {
  const r = classify('bom dia');
  for (const key of ['intent', 'confidence', 'complexity', 'estimatedCost', 'estimatedLatency', 'recommendedPath']) {
    assert.ok(key in r, `campo ${key} presente`);
  }
});

test('classify: pergunta frequente cai em sql_template', () => {
  const r = classify('Qual foi o faturamento de cada loja em junho de 2026?');
  assert.strictEqual(r.recommendedPath, PATHS.SQL_TEMPLATE);
  assert.ok(r.confidence >= 0.8);
});

test('classify: smalltalk cai em response_library', () => {
  assert.strictEqual(classify('obrigado!').recommendedPath, PATHS.RESPONSE_LIBRARY);
});

test('classify: ação imperativa cai em workflow', () => {
  assert.strictEqual(classify('Gere e envie o relatório').recommendedPath, PATHS.WORKFLOW);
});

test('classify: pergunta desconhecida cai em claude', () => {
  assert.strictEqual(classify('me fale algo aleatório sobre o universo').recommendedPath, PATHS.CLAUDE);
});

test('classify: pergunta vazia cai em claude com confiança 0', () => {
  const r = classify('');
  assert.strictEqual(r.recommendedPath, PATHS.CLAUDE);
  assert.strictEqual(r.confidence, 0);
});

test('recommendedPath é sempre um dos caminhos válidos', () => {
  const validos = new Set(Object.values(PATHS));
  for (const q of ['oi', 'faturamento de cada loja em junho de 2026', 'exporte os dados', 'o que é crediário', 'xyz']) {
    assert.ok(validos.has(classify(q).recommendedPath));
  }
});

// ── shouldCallClaude ─────────────────────────────────────────────────────────

test('shouldCallClaude: true para desconhecido, false para caminho barato', () => {
  assert.strictEqual(shouldCallClaude('me fale algo aleatório'), true);
  assert.strictEqual(shouldCallClaude('Qual foi o faturamento de cada loja em junho de 2026?'), false);
  assert.strictEqual(shouldCallClaude('obrigado!'), false);
});

test('shouldCallClaude: aceita objeto de classificação', () => {
  assert.strictEqual(shouldCallClaude(classify('bom dia')), false);
  assert.strictEqual(shouldCallClaude(classify('')), true);
});

// ── Response Library (interface) ─────────────────────────────────────────────

test('findReusableResponse: interface retorna null (miss) por enquanto', async () => {
  assert.strictEqual(await findReusableResponse({ intent: 'x', normalizedQuestion: 'y', parameterSignature: 'z' }), null);
  assert.strictEqual(await findReusableResponse(), null);
});

test('RESPONSE_LIBRARY_COLUMNS cobre os campos previstos', () => {
  for (const col of ['id', 'intent', 'normalized_question', 'parameter_signature', 'response', 'version', 'quality_score', 'usage_count', 'estimated_cost', 'last_generated_at', 'expires_at', 'created_at', 'updated_at']) {
    assert.ok(RESPONSE_LIBRARY_COLUMNS.includes(col), `coluna ${col} listada`);
  }
});
