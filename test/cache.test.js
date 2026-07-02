'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  createCacheKey,
  getCacheEntry,
  setCacheEntry,
  clearCache
} = require('../src/hermes/cache');

// ── Chave estável ────────────────────────────────────────────────────────────

test('createCacheKey: estável independente da ordem dos params', () => {
  const a = createCacheKey({
    templateName: 't1',
    templateVersion: 1,
    params: { ano: 2025, mes: 6 }
  });
  const b = createCacheKey({
    templateName: 't1',
    templateVersion: 1,
    params: { mes: 6, ano: 2025 }
  });
  assert.strictEqual(a, b, 'mesma entrada (ordem diferente) gera a mesma chave');
});

test('createCacheKey: muda quando params/versão/nome mudam', () => {
  const base = createCacheKey({ templateName: 't1', templateVersion: 1, params: { mes: 6 } });
  assert.notStrictEqual(base, createCacheKey({ templateName: 't1', templateVersion: 1, params: { mes: 7 } }));
  assert.notStrictEqual(base, createCacheKey({ templateName: 't1', templateVersion: 2, params: { mes: 6 } }));
  assert.notStrictEqual(base, createCacheKey({ templateName: 't2', templateVersion: 1, params: { mes: 6 } }));
});

// ── hit / miss / expired ─────────────────────────────────────────────────────

test('getCacheEntry: miss quando a chave não existe', () => {
  clearCache();
  const key = createCacheKey({ templateName: 't', templateVersion: 1, params: {} });
  assert.strictEqual(getCacheEntry(key).status, 'miss');
});

test('setCacheEntry + getCacheEntry: hit dentro do TTL', () => {
  clearCache();
  const key = createCacheKey({ templateName: 't', templateVersion: 1, params: { a: 1 } });
  const now = 1_000_000;
  setCacheEntry(key, 'resposta', 60_000, { rowCount: 3 }, now);
  const lookup = getCacheEntry(key, now + 30_000);
  assert.strictEqual(lookup.status, 'hit');
  assert.strictEqual(lookup.entry.value, 'resposta');
  assert.strictEqual(lookup.entry.metadata.rowCount, 3);
});

test('getCacheEntry: expired após o TTL e remove a entrada', () => {
  clearCache();
  const key = createCacheKey({ templateName: 't', templateVersion: 1, params: { a: 2 } });
  const now = 1_000_000;
  setCacheEntry(key, 'resposta', 60_000, {}, now);
  const expired = getCacheEntry(key, now + 60_001);
  assert.strictEqual(expired.status, 'expired');
  // Após expirar, a entrada é removida: a próxima consulta é miss.
  assert.strictEqual(getCacheEntry(key, now + 60_002).status, 'miss');
});

// ── Não cachear erro ─────────────────────────────────────────────────────────
// O servidor só grava no cache no caminho de sucesso (nunca no catch de erro).
// No nível do módulo, o contrato equivalente é: sem write não há entrada, e um
// TTL inválido/não-positivo não grava nada.

test('não cachear erro: sem setCacheEntry a chave permanece miss', () => {
  clearCache();
  const key = createCacheKey({ templateName: 't', templateVersion: 1, params: { erro: true } });
  // Simula o fluxo de erro: nenhuma gravação acontece.
  assert.strictEqual(getCacheEntry(key).status, 'miss');
});

test('setCacheEntry: TTL não-positivo não grava e retorna null', () => {
  clearCache();
  const key = createCacheKey({ templateName: 't', templateVersion: 1, params: { a: 3 } });
  assert.strictEqual(setCacheEntry(key, 'x', 0), null);
  assert.strictEqual(setCacheEntry(key, 'x', -5), null);
  assert.strictEqual(getCacheEntry(key).status, 'miss');
});
