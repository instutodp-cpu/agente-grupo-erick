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

test('GET /health responde 200', async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const res = await request(port, { method: 'GET', path: '/health' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.service, 'hermes-api');
});

test('POST /message classifica intenção e retorna trace_id', async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const res = await request(
    port,
    { method: 'POST', path: '/message', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({ message: 'lançar campanha de marketing' })
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.intent, 'marketing');
  assert.ok(typeof res.body.trace_id === 'string' && res.body.trace_id.length > 0);
});

test('POST /message classifica intenção de compras', async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const res = await request(
    port,
    { method: 'POST', path: '/message', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({ message: 'abrir pedido de compra com o fornecedor' })
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.intent, 'compras');
  assert.ok(typeof res.body.trace_id === 'string' && res.body.trace_id.length > 0);
});

test('POST /message sem "message" retorna 400', async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const res = await request(
    port,
    { method: 'POST', path: '/message', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({})
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'invalid_request');
});

test('POST /message reaproveita trace_id enviado pelo cliente', async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const res = await request(
    port,
    { method: 'POST', path: '/message', headers: { 'Content-Type': 'application/json' } },
    JSON.stringify({ message: 'bug no deploy', trace_id: 'trace-123' })
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.trace_id, 'trace-123');
  assert.equal(res.body.intent, 'desenvolvimento');
});
