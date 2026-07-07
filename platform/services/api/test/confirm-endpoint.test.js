'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createServer } = require('../src/index');
const {
  createPendingConfirmation,
  resetConfirmationStore
} = require('../src/core/confirmation-store');

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

function postMessage(port, message, extra) {
  return request(
    port,
    { method: 'POST', path: '/message', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({ message, ...extra })
  );
}

async function createConfirmationViaMessage(port) {
  const res = await postMessage(port, 'ver caixa e faturamento do mes');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.confirmation_required, true);
  assert.match(res.body.confirmation.id, /^confirm_[a-f0-9]{32}$/);
  return res.body.confirmation.id;
}

function assertPublicConfirmResponse(body, decision, confirmationStatus) {
  assert.deepEqual(
    Object.keys(body).sort(),
    ['confirmation_id', 'confirmation_status', 'decision', 'executed', 'message', 'status'].sort()
  );
  assert.equal(body.decision, decision);
  assert.equal(body.status, 'received');
  assert.equal(body.confirmation_status, confirmationStatus);
  assert.equal(body.executed, false);
  assert.equal(Object.hasOwn(body, 'requiredAdapters'), false);
  assert.ok(typeof body.message === 'string' && body.message.length > 0);
}

test('POST /confirm aprova confirmacao existente com sim', withServer(async (port) => {
  resetConfirmationStore();
  const confirmationId = await createConfirmationViaMessage(port);
  const res = await postConfirm(port, { confirmation_id: confirmationId, message: 'sim' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.confirmation_id, confirmationId);
  assertPublicConfirmResponse(res.body, 'approved', 'approved');
  assert.match(res.body.message, /execucao real ainda nao esta habilitada/i);
}));

test('POST /confirm rejeita confirmacao existente com nao', withServer(async (port) => {
  resetConfirmationStore();
  const confirmationId = await createConfirmationViaMessage(port);
  const res = await postConfirm(port, { confirmation_id: confirmationId, message: 'nao' });

  assert.equal(res.statusCode, 200);
  assertPublicConfirmResponse(res.body, 'rejected', 'rejected');
  assert.match(res.body.message, /cancelada/i);
}));

test('POST /confirm mantem pending para texto ambiguo', withServer(async (port) => {
  resetConfirmationStore();
  const confirmationId = await createConfirmationViaMessage(port);
  const res = await postConfirm(port, { confirmation_id: confirmationId, message: 'talvez' });

  assert.equal(res.statusCode, 200);
  assertPublicConfirmResponse(res.body, 'unknown', 'pending');
  assert.match(res.body.message, /sim ou nao/i);
}));

test('POST /confirm com id inexistente retorna not_found', withServer(async (port) => {
  resetConfirmationStore();
  const res = await postConfirm(port, { confirmation_id: 'confirm_missing', message: 'sim' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.confirmation_id, 'confirm_missing');
  assert.equal(res.body.decision, 'approved');
  assert.equal(res.body.status, 'not_found');
  assert.equal(res.body.confirmation_status, 'not_found');
  assert.equal(res.body.executed, false);
  assert.equal(Object.hasOwn(res.body, 'requiredAdapters'), false);
}));

test('POST /confirm com id expirado retorna expired', withServer(async (port) => {
  resetConfirmationStore();
  createPendingConfirmation({
    confirmation_id: 'confirm_expired_endpoint',
    trace_id: 'trace-expired',
    domain: 'financeiro',
    intent: 'consultar_financeiro',
    expires_in_seconds: -1
  });

  const res = await postConfirm(port, { confirmation_id: 'confirm_expired_endpoint', message: 'sim' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'expired');
  assert.equal(res.body.confirmation_status, 'expired');
  assert.equal(res.body.executed, false);
}));

test('POST /confirm exige confirmation_id', withServer(async (port) => {
  resetConfirmationStore();
  const res = await postConfirm(port, { message: 'sim' });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'invalid_request');
}));

test('POST /confirm registra log sem mensagem crua', withServer(async (port) => {
  resetConfirmationStore();
  const originalLog = console.log;
  const logs = [];
  console.log = (line) => { logs.push(JSON.parse(line)); };

  try {
    const confirmationId = await createConfirmationViaMessage(port);
    const res = await postConfirm(port, {
      confirmation_id: confirmationId,
      message: 'segredo de confirmacao'
    });

    assert.equal(res.statusCode, 200);
    const received = logs.find((log) => log.event === 'confirmation_response_received');
    assert.deepEqual(received, {
      level: 'info',
      event: 'confirmation_response_received',
      confirmation_id: confirmationId,
      decision: 'unknown',
      message_length: 'segredo de confirmacao'.length
    });
    const resolved = logs.find((log) => log.event === 'confirmation_store_resolved');
    assert.deepEqual(resolved, {
      level: 'info',
      event: 'confirmation_store_resolved',
      confirmation_id: confirmationId,
      decision: 'unknown',
      confirmation_status: 'pending'
    });
    assert.equal(JSON.stringify(logs).includes('segredo de confirmacao'), false);
  } finally {
    console.log = originalLog;
  }
}));

test('POST /confirm loga miss sem mensagem crua', withServer(async (port) => {
  resetConfirmationStore();
  const originalLog = console.log;
  const logs = [];
  console.log = (line) => { logs.push(JSON.parse(line)); };

  try {
    const res = await postConfirm(port, {
      confirmation_id: 'confirm_missing_log',
      message: 'segredo em miss'
    });

    assert.equal(res.statusCode, 200);
    const miss = logs.find((log) => log.event === 'confirmation_store_miss');
    assert.deepEqual(miss, {
      level: 'info',
      event: 'confirmation_store_miss',
      confirmation_id: 'confirm_missing_log'
    });
    assert.equal(JSON.stringify(logs).includes('segredo em miss'), false);
  } finally {
    console.log = originalLog;
  }
}));
