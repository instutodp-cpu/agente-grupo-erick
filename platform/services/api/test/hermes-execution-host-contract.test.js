'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CAPABILITIES,
  buildHermesExecutionHostContract,
  hashContract,
  validateHermesExecutionHostContract
} = require('../src/core/hermes-execution-host-contract');

function valid() { return buildHermesExecutionHostContract(); }
function mutable() { return JSON.parse(JSON.stringify(valid())); }
function errors(value) { return validateHermesExecutionHostContract(value).errors; }

test('V1 is a valid deterministic staging host contract', () => {
  const a = valid();
  const b = valid();
  assert.equal(validateHermesExecutionHostContract(a).valid, true);
  assert.deepEqual(a, b);
  assert.equal(a.contract_fingerprint, hashContract(a));
  assert.equal(a.environment, 'staging');
  assert.equal(a.production_allowed, false);
});

test('production is fail-closed', () => {
  const value = mutable();
  value.environment = 'production';
  value.contract_fingerprint = hashContract(value);
  assert.ok(errors(value).includes('environment_blocked'));
});

test('network is deny by default and only HTTPS 443 is inbound', () => {
  const value = mutable();
  value.network.outbound.default = 'allow';
  value.contract_fingerprint = hashContract(value);
  assert.ok(errors(value).includes('outbound_not_deny_by_default'));
  const inbound = mutable();
  inbound.network.inbound.allowed = ['http_80'];
  inbound.contract_fingerprint = hashContract(inbound);
  assert.ok(errors(inbound).includes('inbound_not_deny_by_default'));
});

test('host presence grants no execution capability', () => {
  const value = mutable();
  assert.deepEqual(Object.keys(value.capabilities).sort(), [...CAPABILITIES].sort());
  assert.deepEqual(Object.values(value.capabilities), CAPABILITIES.map(() => false));
  assert.equal(value.execution.provider_without_authorization, 'forbidden');
  assert.equal(value.execution.shell_without_authorization, 'forbidden');
  assert.equal(value.execution.network_without_authorization, 'forbidden');
});

test('queue, scheduler, worker, and canary service presence does not authorize dispatch', () => {
  const value = mutable();
  assert.equal(value.services.queue, true);
  assert.equal(value.services.scheduler, true);
  assert.equal(value.services.hermes_worker, true);
  assert.equal(value.services.public_web_canary, true);
  assert.equal(value.capabilities.CAPABILITY_QUEUE_MUTATION, false);
  assert.equal(value.capabilities.CAPABILITY_SCHEDULER_MUTATION, false);
  assert.equal(value.capabilities.CAPABILITY_DISPATCH, false);
});

test('plaintext secret policy and explicit runtime injection are mandatory', () => {
  const value = mutable();
  value.secrets.plaintext_repository = 'allowed';
  value.contract_fingerprint = hashContract(value);
  assert.ok(errors(value).includes('secret_policy_invalid'));
});

test('receipts, correlation IDs, and exact authorization binding are mandatory', () => {
  const value = mutable();
  value.audit.correlation_id_required = false;
  value.contract_fingerprint = hashContract(value);
  assert.ok(errors(value).includes('audit_requirement_missing'));
});

test('Public Web Canary remains isolated and non-production', () => {
  const value = mutable();
  assert.equal(value.services.public_web_canary, true);
  assert.equal(value.environment, 'staging');
  assert.equal(value.production_allowed, false);
  assert.equal(value.capabilities.CAPABILITY_PROVIDER_CALL, false);
  assert.equal(value.capabilities.CAPABILITY_NETWORK_OUTBOUND, false);
  assert.equal(value.capabilities.CAPABILITY_PRODUCTION_EFFECT, false);
});

test('control and execution planes cannot silently collapse', () => {
  const value = mutable();
  value.execution_plane = value.control_plane;
  value.contract_fingerprint = hashContract(value);
  assert.ok(errors(value).includes('plane_identity_invalid'));
});

test('unknown relevant fields are rejected', () => {
  const value = { ...valid(), unexpected_policy: true };
  assert.ok(errors(value).some((error) => error.startsWith('host_contract_unknown_field::')));
});

test('contract fingerprint changes with relevant content', () => {
  const a = valid();
  const b = mutable();
  b.services.scheduler = false;
  b.contract_fingerprint = hashContract(b);
  assert.notEqual(a.contract_fingerprint, b.contract_fingerprint);
});
