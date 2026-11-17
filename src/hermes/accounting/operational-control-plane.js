'use strict';

const CAPABILITIES = Object.freeze(['FINANCIAL_EXECUTION', 'FISCAL_SUBMISSION']);
const ATTEMPT_STATES = Object.freeze(['RESERVED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'RECONCILED']);

function fail(message, code = 'INVALID_INPUT') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function requiredString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') fail(field + ' is required');
  return value;
}

function instant(value, field) {
  requiredString(value, field);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    fail(field + ' must be an ISO UTC instant');
  }
  return value;
}

function capability(value) {
  requiredString(value, 'capability');
  if (!CAPABILITIES.includes(value)) fail('unsupported capability');
  return value;
}

function assertBoolean(value, field) {
  if (typeof value !== 'boolean') fail(field + ' must be boolean');
  return value;
}

function assertCapabilityEnabled(flag) {
  if (flag?.enabled !== true || flag?.realProviderEnabled !== true) {
    fail('OPERATIONAL_CAPABILITY_DISABLED', 'CAPABILITY_DISABLED');
  }
  return true;
}

function createCapabilityFlag(input = {}) {
  for (const field of ['tenantId', 'capability', 'version', 'updatedBy']) requiredString(input[field], field);
  capability(input.capability);
  instant(input.updatedAt, 'updatedAt');
  const enabled = input.enabled === undefined ? false : assertBoolean(input.enabled, 'enabled');
  const realProviderEnabled = input.realProviderEnabled === undefined
    ? false
    : assertBoolean(input.realProviderEnabled, 'realProviderEnabled');

  return Object.freeze({
    tenantId: input.tenantId,
    capability: input.capability,
    version: input.version,
    updatedBy: input.updatedBy,
    updatedAt: input.updatedAt,
    enabled,
    realProviderEnabled,
    simulationOnly: true,
    externalEffectAllowed: false
  });
}

function createExecutionReservation(input = {}) {
  for (const field of ['tenantId', 'idempotencyKey', 'operationId', 'ownerId']) requiredString(input[field], field);
  capability(input.capability);
  instant(input.leaseUntil, 'leaseUntil');
  instant(input.createdAt, 'createdAt');
  if (Date.parse(input.leaseUntil) <= Date.parse(input.createdAt)) {
    fail('leaseUntil must be after createdAt');
  }

  return Object.freeze({
    tenantId: input.tenantId,
    capability: input.capability,
    idempotencyKey: input.idempotencyKey,
    operationId: input.operationId,
    ownerId: input.ownerId,
    leaseUntil: input.leaseUntil,
    createdAt: input.createdAt,
    state: 'RESERVED',
    auditRequired: true,
    simulationOnly: true,
    externalEffectAllowed: false
  });
}

function reserveExecution({ candidate, existingReservations = [], now } = {}) {
  if (!candidate || typeof candidate !== 'object') fail('candidate is required');
  instant(now, 'now');
  if (!Array.isArray(existingReservations)) fail('existingReservations must be an array');
  if (Date.parse(candidate.createdAt) > Date.parse(now)) fail('candidate cannot be from the future');
  if (Date.parse(candidate.leaseUntil) <= Date.parse(now)) fail('candidate lease must be active');

  const conflict = existingReservations.find((reservation) =>
    reservation?.tenantId === candidate.tenantId &&
    reservation?.capability === candidate.capability &&
    reservation?.idempotencyKey === candidate.idempotencyKey
  );
  if (conflict) fail('IDEMPOTENCY_RESERVATION_CONFLICT', 'CONFLICT');

  return createExecutionReservation(candidate);
}

function acquireLease({ reservation, ownerId, now, newLeaseUntil } = {}) {
  if (!reservation || typeof reservation !== 'object') fail('reservation is required');
  requiredString(ownerId, 'ownerId');
  instant(now, 'now');
  instant(newLeaseUntil, 'newLeaseUntil');
  if (!['RESERVED', 'RUNNING'].includes(reservation.state)) fail('reservation is not leasable');
  instant(reservation.leaseUntil, 'reservation.leaseUntil');

  if (reservation.ownerId !== ownerId && Date.parse(reservation.leaseUntil) > Date.parse(now)) {
    fail('EXECUTION_LEASE_HELD', 'LOCKED');
  }
  if (Date.parse(newLeaseUntil) <= Date.parse(now)) fail('newLeaseUntil must be after now');

  return Object.freeze({
    ...reservation,
    ownerId,
    leaseUntil: newLeaseUntil,
    leaseAcquiredAt: now,
    state: 'RUNNING',
    simulationOnly: true,
    externalEffectAllowed: false
  });
}

function createExecutionAttempt(input = {}) {
  for (const field of ['attemptId', 'tenantId', 'operationId', 'idempotencyKey']) requiredString(input[field], field);
  capability(input.capability);
  instant(input.startedAt, 'startedAt');
  const state = input.state === undefined ? 'RUNNING' : input.state;
  if (!ATTEMPT_STATES.includes(state)) fail('unsupported attempt state');

  return Object.freeze({
    attemptId: input.attemptId,
    tenantId: input.tenantId,
    capability: input.capability,
    operationId: input.operationId,
    idempotencyKey: input.idempotencyKey,
    startedAt: input.startedAt,
    state,
    auditRequired: true,
    simulationOnly: true,
    externalEffectAllowed: false
  });
}

function completeExecutionAttempt(attempt, { success, completedAt, providerReference, failureCode } = {}) {
  if (!attempt || typeof attempt !== 'object') fail('attempt is required');
  if (attempt.state !== 'RUNNING') fail('attempt is not running');
  instant(completedAt, 'completedAt');
  assertBoolean(success, 'success');

  if (success === true) {
    requiredString(providerReference, 'providerReference');
    return Object.freeze({
      ...attempt,
      state: 'SUCCEEDED',
      completedAt,
      providerReference,
      simulationOnly: true,
      externalEffectAllowed: false
    });
  }

  return Object.freeze({
    ...attempt,
    state: 'FAILED',
    completedAt,
    failureCode: failureCode === undefined ? 'UNKNOWN_FAILURE' : requiredString(failureCode, 'failureCode'),
    simulationOnly: true,
    externalEffectAllowed: false
  });
}

function assertTenantIsolation({ flag, reservation } = {}) {
  requiredString(flag?.tenantId, 'flag.tenantId');
  requiredString(reservation?.tenantId, 'reservation.tenantId');
  if (flag.tenantId !== reservation.tenantId) fail('TENANT_BOUNDARY_VIOLATION', 'DENIED');
  return true;
}

module.exports = {
  CAPABILITIES,
  ATTEMPT_STATES,
  createCapabilityFlag,
  assertCapabilityEnabled,
  createExecutionReservation,
  reserveExecution,
  acquireLease,
  createExecutionAttempt,
  completeExecutionAttempt,
  assertTenantIsolation
};
