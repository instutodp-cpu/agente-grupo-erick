'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const {
  CALLER_OBSERVABILITY_EVENT_NAME,
  CALLER_OBSERVABILITY_EVENT_VERSION,
  beginCallerObservation,
  routeIdFor
} = require('../src/core/caller-observability');

function response() {
  const output = new EventEmitter();
  output.statusCode = 200;
  return output;
}

function emitFor(req, statusCode = 200) {
  const logs = [];
  const res = response();
  res.statusCode = statusCode;
  beginCallerObservation(req, res, {
    logger: (line) => logs.push(JSON.parse(line)),
    now: () => Date.parse('2026-01-02T03:04:05.000Z'),
    requestIdFactory: () => 'generated-request-id'
  });
  res.emit('finish');
  res.emit('close');
  return logs;
}

test('route ids are stable and never include confirmation ids', () => {
  assert.equal(routeIdFor('POST', '/message?secret=SECRET_SENTINEL_BODY'), 'message.post');
  assert.equal(routeIdFor('POST', '/confirm'), 'confirm.post');
  assert.equal(routeIdFor('GET', '/confirm/SECRET_SENTINEL_CONFIRMATION_ID'), 'confirm.get');
  assert.equal(routeIdFor('GET', '/health'), null);
});

test('observes routes once with redacted auth, body and URL metadata', () => {
  const logs = emitFor({
    method: 'POST',
    url: '/message?phone=SECRET_SENTINEL_PHONE',
    headers: {
      authorization: 'Bearer SECRET_SENTINEL_TOKEN',
      'user-agent': 'Mozilla/5.0 SECRET_SENTINEL_BODY',
      'x-twilio-signature': 'SECRET_SENTINEL_AUTHORIZATION',
      'x-forwarded-for': 'SECRET_SENTINEL_PHONE'
    },
    body: {
      message: 'SECRET_SENTINEL_BODY',
      token: 'SECRET_SENTINEL_TOKEN'
    },
    context: {
      identity: {
        principal: { type: 'machine', id: 'hermes-service' },
        tenant_id: 'grupo_erick',
        key_id: 'machine-key'
      }
    }
  }, 201);

  assert.equal(logs.length, 1);
  const line = JSON.stringify(logs[0]);
  assert.equal(logs[0].event_name, CALLER_OBSERVABILITY_EVENT_NAME);
  assert.equal(logs[0].event_version, CALLER_OBSERVABILITY_EVENT_VERSION);
  assert.equal(logs[0].route_id, 'message.post');
  assert.equal(logs[0].auth.authorization_present, true);
  assert.equal(logs[0].auth.auth_scheme, 'bearer');
  assert.equal(logs[0].auth.credential_value_logged, false);
  assert.equal(logs[0].identity.principal_id, 'hermes-service');
  assert.equal(logs[0].identity.tenant_id, 'grupo_erick');
  assert.equal(logs[0].caller.user_agent_family, 'browser');
  assert.equal(logs[0].caller.provider_header_hints.twilio_signature_present, true);
  assert.equal(logs[0].caller.gateway_header_hints.x_forwarded_for_present, true);
  assert.equal(logs[0].outcome.status_code, 201);
  assert.equal(logs[0].safety.payload_logged, false);
  assert.equal(logs[0].safety.secrets_logged, false);
  for (const sentinel of [
    'SECRET_SENTINEL_TOKEN',
    'SECRET_SENTINEL_AUTHORIZATION',
    'SECRET_SENTINEL_BODY',
    'SECRET_SENTINEL_PHONE',
    'SECRET_SENTINEL_CONFIRMATION_ID'
  ]) assert.equal(line.includes(sentinel), false, sentinel);
});

test('missing identity and insufficient caller evidence remain safe and unknown', () => {
  const logs = emitFor({ method: 'GET', url: '/confirm/confirm_private_id', headers: {} }, 200);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].route_id, 'confirm.get');
  assert.equal(logs[0].auth.authorization_present, false);
  assert.equal(logs[0].identity.present, false);
  assert.equal(logs[0].caller.classification_candidate, 'UNKNOWN');
  assert.equal(logs[0].caller.confidence, 'LOW');
});

test('local and provider-like hints remain candidates, not trusted identity', () => {
  const local = emitFor({ method: 'POST', url: '/confirm', headers: { 'user-agent': 'curl/8.0' } });
  assert.equal(local[0].caller.classification_candidate, 'LOCAL_SMOKE');

  const provider = emitFor({ method: 'POST', url: '/confirm', headers: { 'x-elevenlabs-signature': 'present' } });
  assert.equal(provider[0].caller.classification_candidate, 'PROVIDER_LIKE');
  assert.equal(provider[0].identity.present, false);
});
