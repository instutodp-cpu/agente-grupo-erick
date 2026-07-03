'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const stats = require('../src/hermes/intelligence/statistics');

test('recordQuestionStatistics: interface no-op retorna false e não lança', async () => {
  assert.strictEqual(await stats.recordQuestionStatistics({
    intent: 'monthly_revenue_by_store',
    recommendedPath: 'sql_template',
    usedSqlTemplate: true,
    responseTimeMs: 120,
    success: true
  }), false);
  assert.strictEqual(await stats.recordQuestionStatistics(), false);
});

test('agregadores: interfaces retornam array vazio por enquanto', async () => {
  const nomes = [
    'getTopIntents', 'getTopQuestions', 'getTopTemplates',
    'getHighestCost', 'getHighestLatency', 'getMostCacheHits', 'getMostClaudeFallback'
  ];
  for (const nome of nomes) {
    const out = await stats[nome]({ limit: 10 });
    assert.ok(Array.isArray(out), `${nome} retorna array`);
    assert.strictEqual(out.length, 0, `${nome} vazio na fundação`);
  }
});

test('aggregators: índice nomeado aponta para as 7 funções', async () => {
  const chaves = Object.keys(stats.aggregators);
  assert.strictEqual(chaves.length, 7);
  for (const chave of chaves) {
    assert.strictEqual(typeof stats.aggregators[chave], 'function');
    assert.deepStrictEqual(await stats.aggregators[chave](), []);
  }
});

test('QUESTION_STATISTICS_COLUMNS cobre os campos previstos', () => {
  for (const col of [
    'id', 'intent', 'normalized_question', 'recommended_path', 'complexity',
    'estimated_cost', 'estimated_latency', 'used_sql_template', 'used_cache',
    'used_claude', 'response_time_ms', 'success', 'error_type', 'created_at'
  ]) {
    assert.ok(stats.QUESTION_STATISTICS_COLUMNS.includes(col), `coluna ${col} listada`);
  }
});
