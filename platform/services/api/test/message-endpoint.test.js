'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createServer } = require('../src/index');

function request(port, options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, ...options }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: raw ? JSON.parse(raw) : null });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function withServer(fn) {
  return async (t) => {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const { port } = server.address();
    await fn(port);
  };
}

function postMessage(port, message, extra) {
  return request(
    port,
    { method: 'POST', path: '/message', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({ message, ...extra })
  );
}

function assertPublicMessageResponse(body, expectsConfirmation = false) {
  const expectedKeys = ['confirmation_required', 'domain', 'intent', 'message', 'status', 'trace_id'];
  if (expectsConfirmation) expectedKeys.push('confirmation');

  assert.deepEqual(
    Object.keys(body).sort(),
    expectedKeys.sort()
  );
  assert.equal(body.status, 'planned');
  assert.ok(typeof body.message === 'string' && body.message.length > 0);
  assert.equal(Object.hasOwn(body, 'requiredAdapters'), false);

  if (expectsConfirmation) {
    assert.deepEqual(Object.keys(body.confirmation).sort(), ['expires_in_seconds', 'id', 'status'].sort());
    assert.match(body.confirmation.id, /^confirm_[a-f0-9]{32}$/);
    assert.equal(body.confirmation.status, 'pending');
    assert.equal(body.confirmation.expires_in_seconds, 900);
  } else {
    assert.equal(Object.hasOwn(body, 'confirmation'), false);
  }
}

test('GET /health responde 200', withServer(async (port) => {
  const res = await request(port, { method: 'GET', path: '/health' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.service, 'hermes-api');
}));

test('POST /message retorna trace_id, domain, intent, status e message', withServer(async (port) => {
  const res = await postMessage(port, 'lançar campanha de marketing');

  assert.equal(res.statusCode, 200);
  assert.ok(typeof res.body.trace_id === 'string' && res.body.trace_id.length > 0);
  assert.equal(res.body.domain, 'marketing');
  assert.equal(res.body.intent, 'planejar_marketing');
  assert.equal(res.body.confirmation_required, true);
  assertPublicMessageResponse(res.body, true);
}));

test('POST /message classifica compras', withServer(async (port) => {
  const res = await postMessage(port, 'abrir pedido de compra com o fornecedor');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.domain, 'compras');
  assert.equal(res.body.intent, 'consultar_compras');
  assert.equal(res.body.confirmation_required, true);
  assertPublicMessageResponse(res.body, true);
}));

test('POST /message classifica compras (vencimentos)', withServer(async (port) => {
  const res = await postMessage(port, 'qual o vencimento dessa duplicata?');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.domain, 'compras');
  assert.equal(res.body.intent, 'consultar_vencimentos');
  assert.equal(res.body.confirmation_required, true);
  assertPublicMessageResponse(res.body, true);
}));

test('POST /message classifica financeiro', withServer(async (port) => {
  const res = await postMessage(port, 'como está o faturamento e o caixa desse mês?');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.domain, 'financeiro');
  assert.equal(res.body.intent, 'consultar_financeiro');
  assert.equal(res.body.confirmation_required, true);
  assertPublicMessageResponse(res.body, true);
}));

test('POST /message classifica treinamento', withServer(async (port) => {
  const res = await postMessage(port, 'quero ver o certificado do curso');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.domain, 'treinamento');
  assert.equal(res.body.intent, 'consultar_treinamento');
  assert.equal(res.body.confirmation_required, true);
  assertPublicMessageResponse(res.body, true);
}));

test('POST /message classifica desenvolvimento e reaproveita trace_id enviado pelo cliente', withServer(async (port) => {
  const res = await postMessage(port, 'bug no deploy', { trace_id: 'trace-123' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.trace_id, 'trace-123');
  assert.equal(res.body.domain, 'desenvolvimento');
  assert.equal(res.body.intent, 'desenvolvimento');
  assert.equal(res.body.confirmation_required, true);
  assertPublicMessageResponse(res.body, true);
}));

test('POST /message mensagem genérica cai em desconhecido', withServer(async (port) => {
  const res = await postMessage(port, 'bom dia, tudo bem?');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.domain, 'desconhecido');
  assert.equal(res.body.intent, 'desconhecido');
  assert.equal(res.body.confirmation_required, false);
  assertPublicMessageResponse(res.body);
  assert.match(res.body.message, /nenhuma acao foi executada/i);
}));

test('POST /message registra capability_planned sem mensagem crua', withServer(async (port) => {
  const originalLog = console.log;
  const logs = [];
  console.log = (line) => { logs.push(JSON.parse(line)); };

  try {
    const res = await postMessage(port, 'segredo interno de caixa', { trace_id: 'trace-log' });

    assert.equal(res.statusCode, 200);
    const received = logs.find((log) => log.event === 'message_received');
    const planned = logs.find((log) => log.event === 'capability_planned');
    const confirmation = logs.find((log) => log.event === 'confirmation_gate_evaluated');
    const created = logs.find((log) => log.event === 'confirmation_created');

    assert.deepEqual(received, {
      level: 'info',
      event: 'message_received',
      trace_id: 'trace-log',
      domain: 'financeiro',
      intent: 'consultar_financeiro',
      message_length: 'segredo interno de caixa'.length
    });
    assert.deepEqual(planned, {
      level: 'info',
      event: 'capability_planned',
      trace_id: 'trace-log',
      domain: 'financeiro',
      intent: 'consultar_financeiro',
      status: 'planned',
      required_adapters_count: 1
    });
    assert.deepEqual(confirmation, {
      level: 'info',
      event: 'confirmation_gate_evaluated',
      trace_id: 'trace-log',
      domain: 'financeiro',
      intent: 'consultar_financeiro',
      confirmation_required: true
    });
    assert.equal(created.level, 'info');
    assert.equal(created.event, 'confirmation_created');
    assert.equal(created.trace_id, 'trace-log');
    assert.equal(created.domain, 'financeiro');
    assert.equal(created.intent, 'consultar_financeiro');
    assert.match(created.confirmation_id, /^confirm_[a-f0-9]{32}$/);
    assert.equal(created.expires_in_seconds, 900);
    assert.equal(JSON.stringify(logs).includes('segredo interno de caixa'), false);
  } finally {
    console.log = originalLog;
  }
}));

test('POST /message desconhecido nao cria confirmation_created', withServer(async (port) => {
  const originalLog = console.log;
  const logs = [];
  console.log = (line) => { logs.push(JSON.parse(line)); };

  try {
    const res = await postMessage(port, 'mensagem sem dominio', { trace_id: 'trace-unknown' });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.domain, 'desconhecido');
    assert.equal(res.body.confirmation_required, false);
    assertPublicMessageResponse(res.body, false);
    assert.equal(logs.some((log) => log.event === 'confirmation_created'), false);
    assert.equal(JSON.stringify(logs).includes('mensagem sem dominio'), false);
  } finally {
    console.log = originalLog;
  }
}));

test('POST /message sem "message" retorna 400', withServer(async (port) => {
  const res = await request(
    port,
    { method: 'POST', path: '/message', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({})
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'invalid_request');
}));
