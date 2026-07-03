'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { classify, PATHS } = require('../src/hermes/intelligence/intent-classifier');
const { simulateDecision } = require('../src/hermes/intelligence/shadow');

function decide(question) {
  return simulateDecision(classify(question), question);
}

test('simulateDecision: retorna o formato completo', () => {
  const d = decide('bom dia');
  for (const key of [
    'recommendedPath', 'confidence', 'reason', 'wouldCallClaude',
    'wouldUseTemplate', 'wouldUseSemanticCache', 'wouldUseResponseLibrary', 'wouldUseKnowledge'
  ]) {
    assert.ok(key in d, `campo ${key} presente`);
  }
  assert.strictEqual(typeof d.reason, 'string');
  assert.ok(d.reason.length > 0);
});

test('simulateDecision: pergunta frequente → template, sem Claude', () => {
  const d = decide('Qual foi o faturamento de cada loja em junho de 2026?');
  assert.strictEqual(d.recommendedPath, PATHS.SQL_TEMPLATE);
  assert.strictEqual(d.wouldUseTemplate, true);
  assert.strictEqual(d.wouldCallClaude, false);
});

test('simulateDecision: smalltalk → response_library', () => {
  const d = decide('obrigado!');
  assert.strictEqual(d.recommendedPath, PATHS.RESPONSE_LIBRARY);
  assert.strictEqual(d.wouldUseResponseLibrary, true);
  assert.strictEqual(d.wouldCallClaude, false);
});

test('simulateDecision: pergunta desconhecida → Claude', () => {
  const d = decide('me fale algo aleatório sobre o universo');
  assert.strictEqual(d.recommendedPath, PATHS.CLAUDE);
  assert.strictEqual(d.wouldCallClaude, true);
  assert.strictEqual(d.wouldUseTemplate, false);
  assert.strictEqual(d.wouldUseSemanticCache, false);
  assert.strictEqual(d.wouldUseResponseLibrary, false);
  assert.strictEqual(d.wouldUseKnowledge, false);
});

test('simulateDecision: no máximo uma flag wouldUse* é verdadeira', () => {
  for (const q of ['oi', 'faturamento de cada loja em junho de 2026', 'exporte os dados', 'o que é crediário', 'xyz', '']) {
    const d = decide(q);
    const usados = [d.wouldUseTemplate, d.wouldUseSemanticCache, d.wouldUseResponseLibrary, d.wouldUseKnowledge]
      .filter(Boolean).length;
    assert.ok(usados <= 1, `mais de um wouldUse* verdadeiro para: ${JSON.stringify(q)}`);
  }
});

test('simulateDecision: nunca lança e sempre retorna caminho válido', () => {
  const validos = new Set(Object.values(PATHS));
  const entradas = ['', '   ', 'a'.repeat(3000), 'DROP TABLE x; --', '你好 😀', 'SELECT 1'];
  for (const q of entradas) {
    let d;
    assert.doesNotThrow(() => { d = decide(q); });
    assert.ok(validos.has(d.recommendedPath));
    assert.strictEqual(typeof d.wouldCallClaude, 'boolean');
  }
});

test('simulateDecision: robusto a entrada sem classificação', () => {
  const d = simulateDecision();
  assert.strictEqual(d.recommendedPath, PATHS.CLAUDE);
  assert.strictEqual(d.wouldCallClaude, true);
});
