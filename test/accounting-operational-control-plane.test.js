'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createCapabilityFlag,
  assertCapabilityEnabled,
  reserveExecution,
  acquireLease,
  createExecutionAttempt,
  completeExecutionAttempt,
  assertTenantIsolation
} = require('../src/hermes/accounting/operational-control-plane');

const base = {
  tenantId: 't1',
  capability: 'FINANCIAL_EXECUTION',
  idempotencyKey: 'k1',
  operationId: 'op1',
  ownerId: 'worker1',
  leaseUntil: '2026-10-03T13:00:00Z',
  createdAt: '2026-10-03T12:00:00Z'
};

test('capability is disabled unless both tenant gates are explicit', () => {
  const flag = createCapabilityFlag({
    tenantId: 't1',
    capability: 'FINANCIAL_EXECUTION',
    version: '1',
    updatedBy: 'operator',
    updatedAt: '2026-10-03T12:00:00Z'
  });
  assert.equal(flag.simulationOnly, true);
  assert.equal(flag.externalEffectAllowed, false);
  assert.throws(() => assertCapabilityEnabled(flag), (error) => error.code === 'CAPABILITY_DISABLED');
});

test('capability requires both gates and remains simulation-only', () => {
  const flag = createCapabilityFlag({
    tenantId: 't1',
    capability: 'FISCAL_SUBMISSION',
    version: '1',
    updatedBy: 'operator',
    updatedAt: '2026-10-03T12:00:00Z',
    enabled: true,
    realProviderEnabled: true
  });
  assert.equal(assertCapabilityEnabled(flag), true);
  assert.equal(flag.simulationOnly, true);
  assert.equal(flag.externalEffectAllowed, false);
});

test('invalid operational timestamps fail closed', () => {
  assert.throws(() => createCapabilityFlag({
    tenantId: 't1',
    capability: 'FINANCIAL_EXECUTION',
    version: '1',
    updatedBy: 'operator',
    updatedAt: 'not-a-date'
  }));
});

test('same tenant capability and idempotency key cannot be reserved twice', () => {
  const reservation = reserveExecution({
    candidate: base,
    existingReservations: [],
    now: '2026-10-03T12:00:00Z'
  });
  assert.equal(reservation.auditRequired, true);
  assert.equal(reservation.externalEffectAllowed, false);
  assert.throws(() => reserveExecution({
    candidate: base,
    existingReservations: [reservation],
    now: '2026-10-03T12:01:00Z'
  }), (error) => error.code === 'CONFLICT');
});

test('same idempotency key in another tenant is not a false conflict', () => {
  const otherTenant = { ...base, tenantId: 't2' };
  const reservation = reserveExecution({
    candidate: otherTenant,
    existingReservations: [],
    now: '2026-10-03T12:00:00Z'
  });
  assert.equal(reservation.tenantId, 't2');
});

test('active lease prevents another worker from executing the reservation', () => {
  const reservation = reserveExecution({
    candidate: base,
    existingReservations: [],
    now: '2026-10-03T12:00:00Z'
  });
  assert.throws(() => acquireLease({
    reservation,
    ownerId: 'worker2',
    now: '2026-10-03T12:30:00Z',
    newLeaseUntil: '2026-10-03T13:30:00Z'
  }), (error) => error.code === 'LOCKED');
});

test('expired lease can be recovered by another worker with a future lease', () => {
  const reservation = reserveExecution({
    candidate: base,
    existingReservations: [],
    now: '2026-10-03T12:00:00Z'
  });
  const recovered = acquireLease({
    reservation,
    ownerId: 'worker2',
    now: '2026-10-03T13:01:00Z',
    newLeaseUntil: '2026-10-03T14:00:00Z'
  });
  assert.equal(recovered.ownerId, 'worker2');
  assert.equal(recovered.state, 'RUNNING');
  assert.equal(recovered.externalEffectAllowed, false);
});

test('expired or future-invalid lease cannot be acquired', () => {
  const reservation = reserveExecution({
    candidate: base,
    existingReservations: [],
    now: '2026-10-03T12:00:00Z'
  });
  assert.throws(() => acquireLease({
    reservation,
    ownerId: 'worker2',
    now: '2026-10-03T13:01:00Z',
    newLeaseUntil: '2026-10-03T13:00:00Z'
  }));
});

test('every failed attempt remains auditable and successful completion needs a reference', () => {
  const attempt = createExecutionAttempt({
    attemptId: 'a1',
    tenantId: 't1',
    capability: 'FINANCIAL_EXECUTION',
    operationId: 'op1',
    idempotencyKey: 'k1',
    startedAt: '2026-10-03T12:00:00Z'
  });
  const failed = completeExecutionAttempt(attempt, {
    success: false,
    completedAt: '2026-10-03T12:01:00Z',
    failureCode: 'TIMEOUT'
  });
  assert.equal(failed.state, 'FAILED');
  assert.equal(failed.auditRequired, true);
  assert.throws(() => completeExecutionAttempt(attempt, {
    success: true,
    completedAt: '2026-10-03T12:01:00Z'
  }));
  const succeeded = completeExecutionAttempt(attempt, {
    success: true,
    completedAt: '2026-10-03T12:01:00Z',
    providerReference: 'synthetic-ref-1'
  });
  assert.equal(succeeded.state, 'SUCCEEDED');
  assert.equal(succeeded.externalEffectAllowed, false);
});

test('a capability flag from another tenant cannot authorize a reservation', () => {
  const flag = createCapabilityFlag({
    tenantId: 't2',
    capability: 'FINANCIAL_EXECUTION',
    version: '1',
    updatedBy: 'operator',
    updatedAt: '2026-10-03T12:00:00Z',
    enabled: true,
    realProviderEnabled: true
  });
  assert.throws(() => assertTenantIsolation({ flag, reservation: base }), (error) => error.code === 'DENIED');
});
