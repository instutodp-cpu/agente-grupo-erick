'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAdapterAuditEvent,
  sanitizeAdapterAuditEvent,
  validateAdapterAuditEvent
} = require('../src/core/adapter-audit-event');

test('buildAdapterAuditEvent cria evento seguro', () => {
  const event = buildAdapterAuditEvent({
    event_type: 'adapter_simulation_started',
    trace_id: 'trace-123',
    confirmation_id: 'confirm-123',
    domain: 'compras',
    intent: 'registrar_compra',
    adapter_id: 'mock-compras',
    status: 'simulated',
    simulated: true,
    executed: false,
    rawMessage: 'nao pode',
    payload: { secret: true }
  });

  assert.equal(event.event_type, 'adapter_simulation_started');
  assert.equal(event.trace_id, 'trace-123');
  assert.equal(event.confirmation_id, 'confirm-123');
  assert.equal(event.domain, 'compras');
  assert.equal(event.intent, 'registrar_compra');
  assert.equal(event.adapter_id, 'mock-compras');
  assert.equal(event.adapter_mode, 'mock');
  assert.equal(event.status, 'simulated');
  assert.equal(event.simulated, true);
  assert.equal(event.executed, false);
  assert.ok(typeof event.timestamp === 'string');
  assert.equal(Object.hasOwn(event, 'rawMessage'), false);
  assert.equal(Object.hasOwn(event, 'payload'), false);
});

test('sanitize remove rawMessage userMessage requiredAdapters payload internal env token secret credentials authorization cookie headers', () => {
  const { event, removed_fields_count } = sanitizeAdapterAuditEvent({
    event_type: 'adapter_result_sanitized',
    trace_id: 'trace-123',
    confirmation_id: 'confirm-123',
    domain: 'financeiro',
    intent: 'consultar_financeiro',
    adapter_id: 'mock-financeiro',
    adapter_mode: 'mock',
    status: 'simulated',
    executed: false,
    simulated: true,
    timestamp: new Date().toISOString(),
    rawMessage: 'x',
    userMessage: 'y',
    requiredAdapters: ['DataStore'],
    payload: { token: 'secret' },
    internal: { nested: true },
    env: { SECRET: 'x' },
    token: 't',
    secret: 's',
    credentials: { apiKey: 'k' },
    authorization: 'Bearer x',
    cookie: 'cookie',
    headers: { authorization: 'x' }
  });

  assert.equal(removed_fields_count >= 10, true);
  assert.deepEqual(event, {
    event_type: 'adapter_result_sanitized',
    trace_id: 'trace-123',
    confirmation_id: 'confirm-123',
    domain: 'financeiro',
    intent: 'consultar_financeiro',
    adapter_id: 'mock-financeiro',
    adapter_mode: 'mock',
    status: 'simulated',
    executed: false,
    simulated: true,
    timestamp: event.timestamp
  });
});

test('validate rejeita executed:true e adapter_mode real', () => {
  const invalidExecuted = validateAdapterAuditEvent({
    event_type: 'adapter_result_validated',
    trace_id: 'trace-123',
    confirmation_id: 'confirm-123',
    domain: 'compras',
    intent: 'registrar_compra',
    adapter_id: 'mock-compras',
    adapter_mode: 'mock',
    status: 'simulated',
    executed: true,
    simulated: true,
    timestamp: new Date().toISOString()
  });
  assert.equal(invalidExecuted.valid, false);
  assert.equal(invalidExecuted.errors.includes('executed must be false'), true);

  const invalidMode = validateAdapterAuditEvent({
    event_type: 'adapter_result_validated',
    trace_id: 'trace-123',
    confirmation_id: 'confirm-123',
    domain: 'compras',
    intent: 'registrar_compra',
    adapter_id: 'mock-compras',
    adapter_mode: 'real',
    status: 'simulated',
    executed: false,
    simulated: true,
    timestamp: new Date().toISOString()
  });
  assert.equal(invalidMode.valid, false);
  assert.equal(invalidMode.errors.includes('adapter_mode must be mock'), true);
});
