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

function postConfirm(port, body) {
  return request(
    port,
    { method: 'POST', path: '/confirm', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify(body)
  );
}

function assertPublicConfirmResponse(body, decision) {
  assert.deepEqual(
    Object.keys(body).sort(),
    ['confirmation_id', 'decision', 'executed', 'message', 'status'].sort()
  );
  assert.equal(body.decision, decision);
  assert.equal(body.status, 'received');
  assert.equal(body.executed, false);
  assert.equal(Object.hasOwn(body, 'requiredAdapters'), false);
  assert.ok(typeof body.message === 'string' && body.message.length > 0);
}

test('POST /confirm aprova confirmacao com sim', withServer(async (port) => {
  const res = await postConfirm(port, { confirmation_id: 'confirm_abc', message: 'sim' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.confirmation_id, 'confirm_abc');
  assertPublicConfirmResponse(res.body, 'approved');
  assert.match(res.body.message, /execucao real ainda nao esta habilitada/i);
}));

test('POST /confirm rejeita confirmacao com nao', withServer(async (port) => {
  const res = await postConfirm(port, { confirmation_id: 'confirm_abc', message: 'não' });

  assert.equal(res.statusCode, 200);
  assertPublicConfirmResponse(res.body, 'rejected');
  assert.match(res.body.message, /cancelada/i);
}));

test('POST /confirm retorna unknown para texto ambiguo', withServer(async (port) => {
  const res = await postConfirm(port, { confirmation_id: 'confirm_abc', message: 'talvez' });

  assert.equal(res.statusCode, 200);
  assertPublicConfirmResponse(res.body, 'unknown');
  assert.match(res.body.message, /sim ou nao/i);
}));

test('POST /confirm exige confirmation_id', withServer(async (port) => {
  const res = await postConfirm(port, { message: 'sim' });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'invalid_request');
}));

test('POST /confirm registra log sem mensagem crua', withServer(async (port) => {
  const originalLog = console.log;
  const logs = [];
  console.log = (line) => { logs.push(JSON.parse(line)); };

  try {
    const res = await postConfirm(port, {
      confirmation_id: 'confirm_log',
      message: 'segredo de confirmacao'
    });

    assert.equal(res.statusCode, 200);
    const received = logs.find((log) => log.event === 'confirmation_response_received');
    assert.deepEqual(received, {
      level: 'info',
      event: 'confirmation_response_received',
      confirmation_id: 'confirm_log',
      decision: 'unknown',
      message_length: 'segredo de confirmacao'.length
    });
    assert.equal(JSON.stringify(logs).includes('segredo de confirmacao'), false);
  } finally {
    console.log = originalLog;
  }
}));
