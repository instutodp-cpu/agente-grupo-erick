'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const reg = require('../src/hermes/capabilities/capability-registry');

beforeEach(() => reg.resetRegistry());

const CAP_VALIDA = {
  id: 'compras.top_suppliers',
  domain: 'compras',
  title: 'Maiores fornecedores',
  intents: ['top_suppliers'],
  status: 'planned'
};

// ── Capacidade embutida ──────────────────────────────────────────────────────

test('finance.daily_revenue está registrada por padrão', () => {
  const cap = reg.getCapability('finance.daily_revenue');
  assert.ok(cap, 'daily_revenue deveria estar no registry');
  assert.strictEqual(cap.domain, 'finance');
  assert.strictEqual(cap.status, 'integrated');
  assert.ok(cap.intents.includes('daily_revenue'));
  assert.strictEqual(cap.templateName, 'finance_daily_revenue');
  assert.strictEqual(typeof cap.handler, 'function');
  assert.strictEqual(typeof cap.responseBuilder, 'function');
});

// ── Descoberta ───────────────────────────────────────────────────────────────

test('listCapabilities inclui a capacidade embutida', () => {
  const ids = reg.listCapabilities().map(c => c.id);
  assert.ok(ids.includes('finance.daily_revenue'));
});

test('findCapabilitiesByDomain filtra por domínio', () => {
  assert.deepStrictEqual(reg.findCapabilitiesByDomain('finance').map(c => c.id), ['finance.daily_revenue']);
  assert.deepStrictEqual(reg.findCapabilitiesByDomain('rh'), []);
});

test('findCapabilitiesByIntent filtra por intent', () => {
  assert.deepStrictEqual(reg.findCapabilitiesByIntent('daily_revenue').map(c => c.id), ['finance.daily_revenue']);
  assert.deepStrictEqual(reg.findCapabilitiesByIntent('inexistente'), []);
});

// ── Registro ─────────────────────────────────────────────────────────────────

test('registerCapability adiciona e normaliza com defaults', () => {
  const cap = reg.registerCapability(CAP_VALIDA);
  assert.strictEqual(cap.riskLevel, 'low');
  assert.strictEqual(cap.requiresApproval, false);
  assert.deepStrictEqual(cap.permissions, []);
  assert.strictEqual(cap.handler, null);
  assert.ok(reg.getCapability('compras.top_suppliers'));
  assert.strictEqual(reg.listCapabilities().length, 2);
});

test('registerCapability impede ids duplicados', () => {
  reg.registerCapability(CAP_VALIDA);
  assert.throws(() => reg.registerCapability(CAP_VALIDA), /id duplicado/);
  assert.throws(() => reg.registerCapability({ ...CAP_VALIDA, title: 'Outro' }), /id duplicado/);
});

// ── Validação de contrato ────────────────────────────────────────────────────

test('registerCapability exige campos obrigatórios', () => {
  assert.throws(() => reg.registerCapability({ ...CAP_VALIDA, id: undefined }), /obrigatório: id/);
  assert.throws(() => reg.registerCapability({ ...CAP_VALIDA, domain: '' }), /obrigatório: domain/);
  assert.throws(() => reg.registerCapability({ ...CAP_VALIDA, title: '' }), /obrigatório: title/);
  assert.throws(() => reg.registerCapability({ ...CAP_VALIDA, intents: [] }), /intents/);
  assert.throws(() => reg.registerCapability({ ...CAP_VALIDA, status: 'xyz' }), /status inválido/);
});

test('registerCapability valida tipos opcionais', () => {
  assert.throws(() => reg.registerCapability({ ...CAP_VALIDA, riskLevel: 'urgente' }), /riskLevel/);
  assert.throws(() => reg.registerCapability({ ...CAP_VALIDA, requiresApproval: 'sim' }), /requiresApproval/);
  assert.throws(() => reg.registerCapability({ ...CAP_VALIDA, permissions: 'x' }), /permissions/);
  assert.throws(() => reg.registerCapability({ ...CAP_VALIDA, handler: 123 }), /handler/);
});

test('resetRegistry restaura o estado inicial (só embutidas)', () => {
  reg.registerCapability(CAP_VALIDA);
  assert.strictEqual(reg.listCapabilities().length, 2);
  reg.resetRegistry();
  assert.strictEqual(reg.listCapabilities().length, 1);
  assert.ok(reg.getCapability('finance.daily_revenue'));
  assert.strictEqual(reg.getCapability('compras.top_suppliers'), null);
});
