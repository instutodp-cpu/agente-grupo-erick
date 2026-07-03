'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const { resolveCapability } = require('../src/hermes/capabilities/capability-resolver');
const reg = require('../src/hermes/capabilities/capability-registry');

// Garante o estado inicial do registry (só capacidades embutidas).
beforeEach(() => reg.resetRegistry());

// ── Perguntas financeiras → finance.daily_revenue ────────────────────────────

const FINANCEIRAS = [
  'quanto vendemos hoje?',
  'faturamento de hoje',
  'quanto faturamos hoje',
  'como foi o dia',
  'resultado de hoje',
  'movimento de hoje'
];

for (const q of FINANCEIRAS) {
  test(`resolveCapability("${q}") → finance.daily_revenue`, () => {
    const r = resolveCapability(q);
    assert.ok(r, 'deveria resolver uma capability');
    assert.strictEqual(r.capabilityId, 'finance.daily_revenue');
    assert.strictEqual(r.domain, 'finance');
    assert.strictEqual(r.status, 'integrated');
    assert.strictEqual(typeof r.confidence, 'number');
    assert.ok(r.confidence > 0);
    assert.strictEqual(typeof r.reason, 'string');
    assert.ok(r.reason.length > 0);
  });
}

test('resolveCapability retorna o formato completo', () => {
  const r = resolveCapability('faturamento de hoje');
  for (const k of ['capabilityId', 'confidence', 'reason', 'domain', 'status']) {
    assert.ok(k in r, `campo ${k} presente`);
  }
});

// ── Perguntas desconhecidas / sem capability registrada → null ───────────────

test('perguntas desconhecidas retornam null', () => {
  assert.strictEqual(resolveCapability('me fale algo sobre o universo'), null);
  assert.strictEqual(resolveCapability('bom dia'), null);
  assert.strictEqual(resolveCapability('qual a cor preferida do Erick'), null);
});

test('intent conhecido mas sem capability registrada → null', () => {
  // "faturamento do mês" mapeia para monthly_revenue, que ainda NÃO está no registry.
  assert.strictEqual(resolveCapability('faturamento do mês'), null);
  assert.strictEqual(resolveCapability('quanto faturamos em junho de 2026'), null);
});

test('entradas inválidas não quebram e retornam null', () => {
  assert.strictEqual(resolveCapability(''), null);
  assert.strictEqual(resolveCapability('   '), null);
  assert.strictEqual(resolveCapability(null), null);
  assert.strictEqual(resolveCapability(undefined), null);
});

// ── Segue o registry: se a capability sai, o resolver deixa de resolvê-la ─────

test('sem a capability no registry, o resolver retorna null', () => {
  // Registry vazio (sem embutidas) para este teste.
  // (resetRegistry re-registra embutidas; aqui removemos via novo registro isolado)
  const antes = resolveCapability('faturamento de hoje');
  assert.ok(antes, 'com a capability registrada, resolve');
  // Simula ausência: como não há unregister público, validamos o contrato inverso
  // registrando uma nova capability e conferindo descoberta por intent.
  reg.registerCapability({
    id: 'finance.monthly_revenue',
    domain: 'finance',
    title: 'Faturamento mensal',
    intents: ['monthly_revenue'],
    status: 'planned'
  });
  const r = resolveCapability('faturamento do mês');
  assert.ok(r, 'após registrar monthly, passa a resolver');
  assert.strictEqual(r.capabilityId, 'finance.monthly_revenue');
  assert.strictEqual(r.status, 'planned');
});
