'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createServer } = require('../src/index');
const { resetConfirmationStore } = require('../src/core/confirmation-store');

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

function postConfirm(port, body) {
  return request(
    port,
    { method: 'POST', path: '/confirm', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify(body)
  );
}

function getConfirm(port, confirmationId) {
  return request(port, { method: 'GET', path: `/confirm/${confirmationId}` });
}

function assertPublicStatusResponse(body, status) {
  assert.deepEqual(
    Object.keys(body).sort(),
    ['confirmation_id', 'domain', 'executed', 'expires_at', 'intent', 'message', 'status'].sort()
  );
  assert.equal(body.status, status);
  assert.equal(body.executed, false);
  assert.equal(Object.hasOwn(body, 'requiredAdapters'), false);
  assert.ok(typeof body.message === 'string' && body.message.length > 0);
}

test('GET /confirm/:id retorna pending apos POST /message', withServer(async (port) => {
  resetConfirmationStore();
  const created = await postMessage(port, 'ver caixa e faturamento do mes');
  const res = await getConfirm(port, created.body.confirmation.id);

  assert.equal(res.statusCode, 200);
  assertPublicStatusResponse(res.body, 'pending');
  assert.equal(res.body.confirmation_id, created.body.confirmation.id);
  assert.equal(res.body.domain, 'financeiro');
  assert.equal(res.body.intent, 'consultar_financeiro');
}));

test('GET /confirm/:id retorna approved apos POST /confirm com sim', withServer(async (port) => {
  resetConfirmationStore();
  const created = await postMessage(port, 'ver caixa e faturamento do mes');
  const confirmationId = created.body.confirmation.id;

  const confirmed = await postConfirm(port, { confirmation_id: confirmationId, message: 'sim' });
  assert.equal(confirmed.body.confirmation_status, 'approved');

  const res = await getConfirm(port, confirmationId);
  assert.equal(res.statusCode, 200);
  assertPublicStatusResponse(res.body, 'approved');
  assert.equal(res.body.confirmation_id, confirmationId);
}));

test('GET /confirm/:id retorna rejected apos POST /confirm com nao', withServer(async (port) => {
  resetConfirmationStore();
  const created = await postMessage(port, 'ver caixa e faturamento do mes');
  const confirmationId = created.body.confirmation.id;

  const confirmed = await postConfirm(port, { confirmation_id: confirmationId, message: 'nao' });
  assert.equal(confirmed.body.confirmation_status, 'rejected');

  const res = await getConfirm(port, confirmationId);
  assert.equal(res.statusCode, 200);
  assertPublicStatusResponse(res.body, 'rejected');
}));

test('GET /confirm/:id retorna not_found para id inexistente', withServer(async (port) => {
  resetConfirmationStore();
  const res = await getConfirm(port, 'confirm_missing');

  assert.equal(res.statusCode, 200);
  assert.deepEqual(
    Object.keys(res.body).sort(),
    ['confirmation_id', 'executed', 'message', 'status'].sort()
  );
  assert.equal(res.body.status, 'not_found');
  assert.equal(res.body.executed, false);
  assert.equal(Object.hasOwn(res.body, 'requiredAdapters'), false);
}));

test('GET /confirm/:id registra log sem mensagem crua', withServer(async (port) => {
  resetConfirmationStore();
  const originalLog = console.log;
  const logs = [];
  console.log = (line) => { logs.push(JSON.parse(line)); };

  try {
    const created = await postMessage(port, 'ver caixa e faturamento do mes');
    const res = await getConfirm(port, created.body.confirmation.id);

    assert.equal(res.statusCode, 200);
    const checked = logs.find((log) => log.event === 'confirmation_status_checked');
    assert.deepEqual(checked, {
      level: 'info',
      event: 'confirmation_status_checked',
      confirmation_id: created.body.confirmation.id,
      confirmation_status: 'pending'
    });
    assert.equal(JSON.stringify(logs).includes('ver caixa e faturamento do mes'), false);
  } finally {
    console.log = originalLog;
  }
}));
