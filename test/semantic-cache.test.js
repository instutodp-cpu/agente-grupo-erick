'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  normalizeSemanticQuestion,
  canonicalTokenSignature,
  buildSemanticKey,
  findSemanticCacheEntry,
  saveSemanticCacheEntry,
  SEMANTIC_CACHE_COLUMNS
} = require('../src/hermes/intelligence/semantic-cache');

// ── normalizeSemanticQuestion ────────────────────────────────────────────────

test('normalizeSemanticQuestion: minúsculas, sem acento, sem pontuação', () => {
  assert.strictEqual(normalizeSemanticQuestion('Inadimplência RECUPERÁVEL, agora!'), 'inadimplencia recuperavel agora');
});

test('normalizeSemanticQuestion: pergunta vazia/nula não quebra', () => {
  assert.strictEqual(normalizeSemanticQuestion(''), '');
  assert.strictEqual(normalizeSemanticQuestion(null), '');
  assert.strictEqual(normalizeSemanticQuestion(undefined), '');
});

// ── buildSemanticKey ─────────────────────────────────────────────────────────

test('buildSemanticKey: mesma intenção + params reordenados → mesma chave', () => {
  const c = { intent: 'monthly_revenue_by_store' };
  assert.strictEqual(
    buildSemanticKey(c, { mes: 6, ano: 2026 }),
    buildSemanticKey(c, { ano: 2026, mes: 6 })
  );
});

test('buildSemanticKey: intenções diferentes → chaves diferentes', () => {
  assert.notStrictEqual(
    buildSemanticKey({ intent: 'monthly_revenue_by_store' }, { mes: 6 }),
    buildSemanticKey({ intent: 'average_ticket_last_three_months' }, { mes: 6 })
  );
});

test('buildSemanticKey: perguntas equivalentes (intent desconhecido) → mesma chave', () => {
  // Reordenação + stopwords não devem mudar a chave canônica.
  const k1 = buildSemanticKey({ intent: 'unknown', question: 'qual o faturamento total da loja' }, {});
  const k2 = buildSemanticKey({ intent: 'unknown', question: 'o faturamento total da loja, e qual?' }, {});
  assert.strictEqual(k1, k2);
});

test('buildSemanticKey: perguntas diferentes (intent desconhecido) → chaves diferentes', () => {
  const k1 = buildSemanticKey({ intent: 'unknown', question: 'faturamento total da loja' }, {});
  const k2 = buildSemanticKey({ intent: 'unknown', question: 'inadimplencia por faixa de atraso' }, {});
  assert.notStrictEqual(k1, k2);
});

test('buildSemanticKey: pergunta vazia não quebra e retorna hash estável', () => {
  const k1 = buildSemanticKey({ intent: 'empty', question: '' }, {});
  const k2 = buildSemanticKey({ intent: 'empty', question: '' }, {});
  assert.strictEqual(typeof k1, 'string');
  assert.ok(k1.length === 64, 'sha256 hex');
  assert.strictEqual(k1, k2);
});

test('buildSemanticKey: chamado sem argumentos não quebra', () => {
  assert.doesNotThrow(() => buildSemanticKey());
  assert.strictEqual(typeof buildSemanticKey(), 'string');
});

test('canonicalTokenSignature: ordem dos tokens é estável', () => {
  assert.strictEqual(
    canonicalTokenSignature('faturamento loja junho'),
    canonicalTokenSignature('junho faturamento loja')
  );
});

// ── Interfaces no-op ─────────────────────────────────────────────────────────

test('findSemanticCacheEntry: no-op retorna null', async () => {
  assert.strictEqual(await findSemanticCacheEntry({ semanticKey: 'x' }), null);
  assert.strictEqual(await findSemanticCacheEntry(), null);
});

test('saveSemanticCacheEntry: no-op retorna false', async () => {
  assert.strictEqual(await saveSemanticCacheEntry({ semanticKey: 'x', response: 'y' }), false);
  assert.strictEqual(await saveSemanticCacheEntry(), false);
});

test('SEMANTIC_CACHE_COLUMNS inclui os campos-chave', () => {
  for (const col of ['id', 'semantic_key', 'intent', 'normalized_question', 'parameter_signature', 'response', 'expires_at', 'created_at']) {
    assert.ok(SEMANTIC_CACHE_COLUMNS.includes(col), `coluna ${col} listada`);
  }
});
