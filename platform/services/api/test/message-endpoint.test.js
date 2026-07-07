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

function assertPublicMessageResponse(body) {
  assert.deepEqual(
    Object.keys(body).sort(),
    ['confirmation_required', 'domain', 'intent', 'message', 'status', 'trace_id'].sort()
  );
  assert.equal(body.status, 'planned');
  assert.ok(typeof body.message === 'string' && body.message.length > 0);
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
  assertPublicMessageResponse(res.body);
}));

test('POST /message classifica compras', withServer(async (port) => {
  const res = await postMessage(port, 'abrir pedido de compra com o fornecedor');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.domain, 'compras');
  assert.equal(res.body.intent, 'consultar_compras');
  assert.equal(res.body.confirmation_required, true);
  assertPublicMessageResponse(res.body);
}));

test('POST /message classifica compras (vencimentos)', withServer(async (port) => {
  const res = await postMessage(port, 'qual o vencimento dessa duplicata?');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.domain, 'compras');
  assert.equal(res.body.intent, 'consultar_vencimentos');
  assert.equal(res.body.confirmation_required, true);
  assertPublicMessageResponse(res.body);
}));

test('POST /message classifica financeiro', withServer(async (port) => {
  const res = await postMessage(port, 'como está o faturamento e o caixa desse mês?');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.domain, 'financeiro');
  assert.equal(res.body.intent, 'consultar_financeiro');
  assert.equal(res.body.confirmation_required, true);
  assertPublicMessageResponse(res.body);
}));

test('POST /message classifica treinamento', withServer(async (port) => {
  const res = await postMessage(port, 'quero ver o certificado do curso');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.domain, 'treinamento');
  assert.equal(res.body.intent, 'consultar_treinamento');
  assert.equal(res.body.confirmation_required, true);
  assertPublicMessageResponse(res.body);
}));

test('POST /message classifica desenvolvimento e reaproveita trace_id enviado pelo cliente', withServer(async (port) => {
  const res = await postMessage(port, 'bug no deploy', { trace_id: 'trace-123' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.trace_id, 'trace-123');
  assert.equal(res.body.domain, 'desenvolvimento');
  assert.equal(res.body.intent, 'desenvolvimento');
  assert.equal(res.body.confirmation_required, true);
  assertPublicMessageResponse(res.body);
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
    assert.equal(JSON.stringify(logs).includes('segredo interno de caixa'), false);
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
