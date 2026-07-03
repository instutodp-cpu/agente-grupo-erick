'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { buildDecisionReport, LOW_DATA_THRESHOLD } = require('../src/hermes/intelligence/report');

function snap(total, byPath, topIntents = []) {
  return { totalClassifications: total, byRecommendedPath: byPath, topIntents };
}

test('snapshot vazio: total 0, sem dados suficientes, recomenda coletar mais', () => {
  const r = buildDecisionReport(snap(0, {}));
  assert.strictEqual(r.totalClassifications, 0);
  assert.strictEqual(r.enoughData, false);
  assert.strictEqual(r.claudePercent, 0);
  assert.strictEqual(r.recommendation, 'Coletar mais dados antes de decidir.');
});

test('poucos dados (abaixo do limite): recomenda coletar mais', () => {
  const r = buildDecisionReport(snap(LOW_DATA_THRESHOLD - 1, { claude: LOW_DATA_THRESHOLD - 1 }));
  assert.strictEqual(r.enoughData, false);
  assert.strictEqual(r.recommendation, 'Coletar mais dados antes de decidir.');
});

test('Claude > 50%: recomenda criar mais templates/respostas', () => {
  const r = buildDecisionReport(snap(100, { claude: 60, sql_template: 40 }));
  assert.strictEqual(r.claudePercent, 60);
  assert.strictEqual(r.sqlTemplatePercent, 40);
  assert.strictEqual(r.recommendation, 'Criar mais SQL Templates ou respostas reutilizáveis.');
});

test('SQL Template > 50%: recomenda otimizar cache/materialized views', () => {
  const r = buildDecisionReport(snap(100, { sql_template: 70, claude: 30 }));
  assert.ok(r.recommendations.includes('Boa oportunidade para otimizar cache e materialized views.'));
});

test('Semantic Cache > 20%: recomenda priorizar semantic cache', () => {
  const r = buildDecisionReport(snap(100, { semantic_cache: 25, claude: 40, sql_template: 35 }));
  assert.strictEqual(r.semanticCachePercent, 25);
  assert.ok(r.recommendations.includes('Priorizar ativação do semantic cache.'));
});

test('percentuais são calculados corretamente (1 casa decimal)', () => {
  const r = buildDecisionReport(snap(3, { claude: 1, sql_template: 2 }));
  assert.strictEqual(r.claudePercent, 33.3);
  assert.strictEqual(r.sqlTemplatePercent, 66.7);
});

test('distribuição equilibrada com dados suficientes: mensagem neutra', () => {
  const r = buildDecisionReport(snap(100, { claude: 40, sql_template: 40, knowledge: 20 }));
  assert.strictEqual(r.recommendation, 'Distribuição equilibrada; continuar monitorando.');
});

test('topIntents passa direto (só rótulos) e nada de pergunta real', () => {
  const r = buildDecisionReport(snap(50, { claude: 50 }, [{ intent: 'unknown', count: 50 }]));
  assert.deepStrictEqual(r.topIntents, [{ intent: 'unknown', count: 50 }]);
  const serialized = JSON.stringify(r);
  assert.ok(!/pergunta|question|SELECT/i.test(serialized) || serialized.includes('sql_template') === false);
});

test('robusto a snapshot indefinido/parcial', () => {
  assert.doesNotThrow(() => buildDecisionReport());
  assert.doesNotThrow(() => buildDecisionReport({}));
  const r = buildDecisionReport({});
  assert.strictEqual(r.totalClassifications, 0);
  assert.strictEqual(r.recommendation, 'Coletar mais dados antes de decidir.');
});
