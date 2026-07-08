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

function withEnv(overrides, fn) {
  return async (t) => {
    const previous = {};
    for (const [key, value] of Object.entries(overrides)) {
      previous[key] = process.env[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    t.after(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });

    await fn(t);
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

function assertPublicConfirmResponse(body, decision, confirmationStatus, options = {}) {
  const {
    executionStatus = 'not_requested',
    executionPolicy = null,
    simulated = false,
    adapterId = null,
    adapterMode = null
  } = options;
  const expectedKeys = ['confirmation_id', 'confirmation_status', 'decision', 'execution_status', 'executed', 'message', 'status'];
  if (executionPolicy) expectedKeys.push('execution_policy');
  if (simulated) expectedKeys.push('simulated');
  if (adapterId) expectedKeys.push('adapter_id');
  if (adapterMode) expectedKeys.push('adapter_mode');
  assert.deepEqual(
    Object.keys(body).sort(),
    expectedKeys.sort()
  );
  assert.equal(body.decision, decision);
  assert.equal(body.status, 'received');
  assert.equal(body.confirmation_status, confirmationStatus);
  assert.equal(body.execution_status, executionStatus);
  if (executionPolicy) assert.equal(body.execution_policy, executionPolicy);
  if (simulated) assert.equal(body.simulated, true);
  if (adapterId) assert.equal(body.adapter_id, adapterId);
  if (adapterMode) assert.equal(body.adapter_mode, adapterMode);
  assert.equal(body.executed, false);
  assert.equal(Object.hasOwn(body, 'requiredAdapters'), false);
  assert.equal(Object.hasOwn(body, 'payload'), false);
  assert.equal(Object.hasOwn(body, 'rawMessage'), false);
  assert.equal(Object.hasOwn(body, 'userMessage'), false);
  assert.equal(Object.hasOwn(body, 'secret'), false);
  assert.equal(Object.hasOwn(body, 'token'), false);
  assert.equal(Object.hasOwn(body, 'env'), false);
  assert.equal(Object.hasOwn(body, 'internal'), false);
  assert.equal(Object.hasOwn(body, 'credentials'), false);
  assert.equal(Object.hasOwn(body, 'audit_event'), false);
  assert.equal(Object.hasOwn(body, 'audit_events'), false);
  assert.ok(typeof body.message === 'string' && body.message.length > 0);
}

test('POST /confirm aprova confirmacao existente com sim', withServer(async (port) => {
  resetConfirmationStore();
  const originalLog = console.log;
  const logs = [];
  console.log = (line) => { logs.push(JSON.parse(line)); };

  try {
    const confirmationId = await createConfirmationViaMessage(port);
    const res = await postConfirm(port, { confirmation_id: confirmationId, message: 'yes' });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.confirmation_id, confirmationId);
    assertPublicConfirmResponse(res.body, 'approved', 'approved', {
      executionStatus: 'disabled',
      executionPolicy: 'disabled'
    });
    assert.match(res.body.message, /execucao real ainda nao esta habilitada/i);

    const policy = logs.find((log) => log.event === 'execution_policy_evaluated');
    const planned = logs.find((log) => log.event === 'adapter_execution_planned');
    assert.deepEqual(policy, {
      level: 'info',
      event: 'execution_policy_evaluated',
      execution_enabled: false,
      kill_switch_active: false,
      reason: 'execution_disabled_by_default'
    });
    assert.deepEqual(planned, {
      level: 'info',
      event: 'adapter_execution_planned',
      confirmation_id: confirmationId,
      decision: 'approved',
      execution_allowed: false,
      executed: false,
      reason: 'execution_disabled_by_policy',
      required_adapters_count: 1,
      execution_status: 'disabled',
      simulated: false
    });
    assert.equal(logs.some((log) => log.event === 'adapter_result_sanitized'), false);
    assert.equal(logs.some((log) => log.event === 'adapter_result_validated'), false);
    assert.equal(JSON.stringify(logs).includes('yes'), false);
  } finally {
    console.log = originalLog;
  }
}));

test('POST /confirm rejeita confirmacao existente com nao', withServer(async (port) => {
  resetConfirmationStore();
  const originalLog = console.log;
  const logs = [];
  console.log = (line) => { logs.push(JSON.parse(line)); };

  try {
    const confirmationId = await createConfirmationViaMessage(port);
    const res = await postConfirm(port, { confirmation_id: confirmationId, message: 'nao' });

    assert.equal(res.statusCode, 200);
    assertPublicConfirmResponse(res.body, 'rejected', 'rejected');
    assert.match(res.body.message, /cancelada/i);
    assert.equal(Object.hasOwn(res.body, 'execution_policy'), false);
    assert.equal(Object.hasOwn(res.body, 'simulated'), false);
    assert.equal(logs.some((log) => log.event === 'adapter_execution_planned'), false);
    assert.equal(logs.some((log) => log.event === 'adapter_result_sanitized'), false);
    assert.equal(logs.some((log) => log.event === 'adapter_result_validated'), false);
    assert.equal(JSON.stringify(logs).includes('nao'), false);
  } finally {
    console.log = originalLog;
  }
}));

test('POST /confirm mantem pending para texto ambiguo', withServer(async (port) => {
  resetConfirmationStore();
  const originalLog = console.log;
  const logs = [];
  console.log = (line) => { logs.push(JSON.parse(line)); };

  try {
    const confirmationId = await createConfirmationViaMessage(port);
    const res = await postConfirm(port, { confirmation_id: confirmationId, message: 'talvez' });

    assert.equal(res.statusCode, 200);
    assertPublicConfirmResponse(res.body, 'unknown', 'pending');
    assert.match(res.body.message, /sim ou nao/i);
    assert.equal(Object.hasOwn(res.body, 'execution_policy'), false);
    assert.equal(Object.hasOwn(res.body, 'simulated'), false);
    assert.equal(logs.some((log) => log.event === 'adapter_execution_planned'), false);
    assert.equal(logs.some((log) => log.event === 'adapter_result_sanitized'), false);
    assert.equal(logs.some((log) => log.event === 'adapter_result_validated'), false);
    assert.equal(JSON.stringify(logs).includes('talvez'), false);
  } finally {
    console.log = originalLog;
  }
}));

test('POST /confirm com id inexistente retorna not_found', withServer(async (port) => {
  resetConfirmationStore();
  const originalLog = console.log;
  const logs = [];
  console.log = (line) => { logs.push(JSON.parse(line)); };

  try {
    const res = await postConfirm(port, { confirmation_id: 'confirm_missing', message: 'sim' });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.confirmation_id, 'confirm_missing');
    assert.equal(res.body.decision, 'approved');
    assert.equal(res.body.status, 'not_found');
    assert.equal(res.body.confirmation_status, 'not_found');
    assert.equal(res.body.execution_status, 'not_requested');
    assert.equal(Object.hasOwn(res.body, 'execution_policy'), false);
    assert.equal(Object.hasOwn(res.body, 'simulated'), false);
    assert.equal(res.body.executed, false);
    assert.equal(Object.hasOwn(res.body, 'requiredAdapters'), false);
    assert.equal(logs.some((log) => log.event === 'adapter_execution_planned'), false);
    assert.equal(logs.some((log) => log.event === 'adapter_result_sanitized'), false);
    assert.equal(logs.some((log) => log.event === 'adapter_result_validated'), false);
  } finally {
    console.log = originalLog;
  }
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
  assert.equal(res.body.execution_status, 'not_requested');
  assert.equal(Object.hasOwn(res.body, 'execution_policy'), false);
  assert.equal(Object.hasOwn(res.body, 'simulated'), false);
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

test('POST /confirm com policy habilitada continua sem executar adapter real', withEnv({
  HERMES_EXECUTION_ENABLED: 'true',
  HERMES_EXECUTION_KILL_SWITCH: undefined
}, withServer(async (port) => {
  resetConfirmationStore();
  const originalLog = console.log;
  const logs = [];
  console.log = (line) => { logs.push(JSON.parse(line)); };

  try {
    const confirmationId = await createConfirmationViaMessage(port);
    const res = await postConfirm(port, { confirmation_id: confirmationId, message: 'yes' });

    assert.equal(res.statusCode, 200);
    assertPublicConfirmResponse(res.body, 'approved', 'approved', {
      executionStatus: 'simulated',
      executionPolicy: 'not_implemented',
      simulated: true,
      adapterId: 'mock-financeiro',
      adapterMode: 'mock'
    });
    assert.equal(logs.some((log) => log.event === 'execution_policy_evaluated'), true);
    const policy = logs.find((log) => log.event === 'execution_policy_evaluated');
    assert.deepEqual(policy, {
      level: 'info',
      event: 'execution_policy_evaluated',
      execution_enabled: true,
      kill_switch_active: false,
      reason: 'execution_enabled_by_env'
    });
    const selected = logs.find((log) => log.event === 'domain_mock_adapter_selected');
    assert.deepEqual(selected, {
      level: 'info',
      event: 'domain_mock_adapter_selected',
      confirmation_id: confirmationId,
      domain: 'financeiro',
      adapter_id: 'mock-financeiro',
      adapter_mode: 'mock'
    });
    const simulated = logs.find((log) => log.event === 'mock_adapter_simulated');
    assert.deepEqual(simulated, {
      level: 'info',
      event: 'mock_adapter_simulated',
      confirmation_id: confirmationId,
      domain: 'financeiro',
      intent: 'consultar_financeiro',
      adapter_mode: 'mock',
      simulated: true,
      executed: false
    });
    const sanitized = logs.find((log) => log.event === 'adapter_result_sanitized');
    assert.deepEqual(sanitized, {
      level: 'info',
      event: 'adapter_result_sanitized',
      adapter_id: 'mock-financeiro',
      domain: 'financeiro',
      removed_fields_count: 0
    });
    const validated = logs.find((log) => log.event === 'adapter_result_validated');
    assert.deepEqual(validated, {
      level: 'info',
      event: 'adapter_result_validated',
      adapter_id: 'mock-financeiro',
      domain: 'financeiro',
      status: 'simulated',
      executed: false
    });
    const planned = logs.find((log) => log.event === 'adapter_execution_planned');
    assert.deepEqual(planned, {
      level: 'info',
      event: 'adapter_execution_planned',
      confirmation_id: confirmationId,
      decision: 'approved',
      execution_allowed: false,
      executed: false,
      reason: 'adapter_execution_simulated',
      required_adapters_count: 1,
      execution_status: 'simulated',
      simulated: true,
      adapter_id: 'mock-financeiro',
      adapter_mode: 'mock'
    });
    assert.equal(JSON.stringify(logs).includes('yes'), false);
  } finally {
    console.log = originalLog;
  }
})));

test('POST /confirm com kill switch bloqueia tudo', withEnv({
  HERMES_EXECUTION_ENABLED: 'true',
  HERMES_EXECUTION_KILL_SWITCH: 'true'
}, withServer(async (port) => {
  resetConfirmationStore();
  const originalLog = console.log;
  const logs = [];
  console.log = (line) => { logs.push(JSON.parse(line)); };

  try {
    const confirmationId = await createConfirmationViaMessage(port);
    const res = await postConfirm(port, { confirmation_id: confirmationId, message: 'yes' });

    assert.equal(res.statusCode, 200);
    assertPublicConfirmResponse(res.body, 'approved', 'approved', {
      executionStatus: 'disabled',
      executionPolicy: 'kill_switch_active'
    });
    assert.equal(Object.hasOwn(res.body, 'simulated'), false);
    assert.equal(Object.hasOwn(res.body, 'adapter_id'), false);
    assert.equal(Object.hasOwn(res.body, 'adapter_mode'), false);
    const policy = logs.find((log) => log.event === 'execution_policy_evaluated');
    assert.equal(logs.some((log) => log.event === 'adapter_result_sanitized'), false);
    assert.equal(logs.some((log) => log.event === 'adapter_result_validated'), false);
    assert.deepEqual(policy, {
      level: 'info',
      event: 'execution_policy_evaluated',
      execution_enabled: false,
      kill_switch_active: true,
      reason: 'execution_kill_switch_active'
    });
    const planned = logs.find((log) => log.event === 'adapter_execution_planned');
    assert.deepEqual(planned, {
      level: 'info',
      event: 'adapter_execution_planned',
      confirmation_id: confirmationId,
      decision: 'approved',
      execution_allowed: false,
      executed: false,
      reason: 'execution_kill_switch_active',
      required_adapters_count: 1,
      execution_status: 'disabled',
      simulated: false
    });
    assert.equal(JSON.stringify(logs).includes('yes'), false);
  } finally {
    console.log = originalLog;
  }
})));

test('POST /confirm aprovado com dominio desconhecido nao roda mock', withEnv({
  HERMES_EXECUTION_ENABLED: 'true',
  HERMES_EXECUTION_KILL_SWITCH: undefined
}, withServer(async (port) => {
  resetConfirmationStore();
  const originalLog = console.log;
  const logs = [];
  console.log = (line) => { logs.push(JSON.parse(line)); };

  try {
    createPendingConfirmation({
      confirmation_id: 'confirm_unknown_domain',
      trace_id: 'trace-unknown-domain',
      domain: 'desconhecido',
      intent: 'desconhecido',
      expires_in_seconds: 900
    });

    const res = await postConfirm(port, { confirmation_id: 'confirm_unknown_domain', message: 'yes' });

    assert.equal(res.statusCode, 200);
    assertPublicConfirmResponse(res.body, 'approved', 'approved', {
      executionStatus: 'not_available',
      executionPolicy: 'not_implemented'
    });
    assert.equal(Object.hasOwn(res.body, 'simulated'), false);
    assert.equal(Object.hasOwn(res.body, 'adapter_id'), false);
    assert.equal(Object.hasOwn(res.body, 'adapter_mode'), false);
    assert.equal(logs.some((log) => log.event === 'domain_mock_adapter_selected'), false);
    const sanitized = logs.find((log) => log.event === 'adapter_result_sanitized');
    const validated = logs.find((log) => log.event === 'adapter_result_validated');
    assert.deepEqual(sanitized, {
      level: 'info',
      event: 'adapter_result_sanitized',
      adapter_id: null,
      domain: 'desconhecido',
      removed_fields_count: 0
    });
    assert.deepEqual(validated, {
      level: 'info',
      event: 'adapter_result_validated',
      adapter_id: null,
      domain: 'desconhecido',
      status: 'not_available',
      executed: false
    });
    const missing = logs.find((log) => log.event === 'domain_mock_adapter_missing');
    assert.deepEqual(missing, {
      level: 'info',
      event: 'domain_mock_adapter_missing',
      confirmation_id: 'confirm_unknown_domain',
      domain: 'desconhecido'
    });
    const planned = logs.find((log) => log.event === 'adapter_execution_planned');
    assert.deepEqual(planned, {
      level: 'info',
      event: 'adapter_execution_planned',
      confirmation_id: 'confirm_unknown_domain',
      decision: 'approved',
      execution_allowed: false,
      executed: false,
      reason: 'adapter_execution_not_available',
      required_adapters_count: 0,
      execution_status: 'not_available',
      simulated: false
    });
    assert.equal(JSON.stringify(logs).includes('yes'), false);
  } finally {
    console.log = originalLog;
  }
})));
