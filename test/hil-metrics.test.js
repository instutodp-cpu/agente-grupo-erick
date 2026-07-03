'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const { recordDecision, snapshot, resetHilMetrics } = require('../src/hermes/intelligence/metrics');
const { classify } = require('../src/hermes/intelligence/intent-classifier');
const { simulateDecision } = require('../src/hermes/intelligence/shadow');

beforeEach(() => resetHilMetrics());

function feed(question) {
  const c = classify(question);
  recordDecision(c, simulateDecision(c, question));
}

test('snapshot vazio: contadores zerados e formato correto', () => {
  const s = snapshot();
  assert.strictEqual(s.totalClassifications, 0);
  assert.deepStrictEqual(s.topIntents, []);
  for (const k of ['byRecommendedPath', 'wouldCallClaude', 'wouldUseTemplate', 'wouldUseSemanticCache']) {
    assert.strictEqual(typeof s[k], 'object');
  }
  assert.strictEqual(s.wouldCallClaude.true, 0);
  assert.strictEqual(s.wouldCallClaude.false, 0);
});

test('recordDecision agrega caminhos, flags e intents', () => {
  feed('Qual foi o faturamento de cada loja em junho de 2026?'); // sql_template
  feed('obrigado!'); // response_library
  feed('me fale algo aleatório'); // claude

  const s = snapshot();
  assert.strictEqual(s.totalClassifications, 3);
  assert.strictEqual(s.byRecommendedPath.sql_template, 1);
  assert.strictEqual(s.byRecommendedPath.response_library, 1);
  assert.strictEqual(s.byRecommendedPath.claude, 1);

  // Uma pergunta cairia no Claude, duas não.
  assert.strictEqual(s.wouldCallClaude.true, 1);
  assert.strictEqual(s.wouldCallClaude.false, 2);
  assert.strictEqual(s.wouldUseTemplate.true, 1);
  assert.strictEqual(s.wouldUseTemplate.false, 2);
});

test('topIntents é ordenado por contagem (desc)', () => {
  feed('obrigado!');
  feed('bom dia');
  feed('me fale algo aleatório'); // unknown

  const s = snapshot();
  assert.ok(s.topIntents.length >= 1);
  // smalltalk apareceu 2x, deve vir primeiro.
  assert.strictEqual(s.topIntents[0].intent, 'smalltalk');
  assert.strictEqual(s.topIntents[0].count, 2);
  // Ordenação não-crescente.
  for (let i = 1; i < s.topIntents.length; i++) {
    assert.ok(s.topIntents[i - 1].count >= s.topIntents[i].count);
  }
});

test('métricas nunca contêm o texto real da pergunta', () => {
  const marcador = 'faturamento SEGREDO_XYZ da loja principal';
  feed(marcador);
  const serialized = JSON.stringify(snapshot());
  assert.ok(!serialized.includes('SEGREDO_XYZ'), 'pergunta real vazou nas métricas');
  // topIntents só contém rótulos do classificador.
  for (const item of snapshot().topIntents) {
    assert.ok(!item.intent.includes(' '), `intent parece texto livre: ${item.intent}`);
  }
});

test('recordDecision é robusto a entradas vazias e não lança', () => {
  assert.doesNotThrow(() => recordDecision());
  assert.doesNotThrow(() => recordDecision({}, {}));
  assert.strictEqual(snapshot().totalClassifications, 2);
});

test('resetHilMetrics zera os contadores', () => {
  feed('obrigado!');
  assert.strictEqual(snapshot().totalClassifications, 1);
  resetHilMetrics();
  assert.strictEqual(snapshot().totalClassifications, 0);
});
