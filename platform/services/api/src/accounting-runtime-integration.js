'use strict';

const { CAPABILITIES } = require('../../../../src/hermes/accounting/operational-control-plane');

const MODES = Object.freeze(['SIMULATION', 'SHADOW']);
const CONTRACT = 'HERMES_ACCOUNTING_RUNTIME_HANDOFF_V1';

function fail(message) {
  throw new Error(message);
}

function requiredString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') fail(field + ' is required');
  return value;
}

function validateAccountingRuntimeHandoff(handoff) {
  const blockers = [];
  if (!handoff || typeof handoff !== 'object') {
    return Object.freeze({ valid: false, blockers: Object.freeze(['HANDOFF_REQUIRED']) });
  }
  if (handoff.contract !== CONTRACT) blockers.push('CONTRACT_INVALID');
  if (!CAPABILITIES.includes(handoff.capability)) blockers.push('CAPABILITY_INVALID');
  if (!MODES.includes(handoff.mode)) blockers.push('MODE_NOT_ALLOWED');
  if (handoff.executed !== false) blockers.push('EXECUTED_MUST_BE_FALSE');
  if (handoff.externalEffectAllowed !== false) blockers.push('EXTERNAL_EFFECT_MUST_BE_FALSE');
  if (handoff.realProviderAllowed !== false) blockers.push('REAL_PROVIDER_MUST_BE_FALSE');
  for (const [field, blocker] of [
    ['requiresCanonicalExecutionJob', 'CANONICAL_JOB_REQUIREMENT_MISSING'],
    ['requiresCanonicalExecutionAttempt', 'CANONICAL_ATTEMPT_REQUIREMENT_MISSING'],
    ['requiresDurableAdmission', 'DURABLE_ADMISSION_REQUIREMENT_MISSING']
  ]) {
    if (handoff[field] !== true) blockers.push(blocker);
  }
  for (const field of [
    'handoffId',
    'tenantId',
    'organizationId',
    'projectId',
    'sessionReferenceId',
    'actorId',
    'operationId',
    'idempotencyKey'
  ]) {
    if (typeof handoff[field] !== 'string' || handoff[field].trim() === '') blockers.push(field.toUpperCase() + '_REQUIRED');
  }
  return Object.freeze({ valid: blockers.length === 0, blockers: Object.freeze(blockers) });
}

function buildAccountingRuntimeHandoff(input = {}) {
  for (const field of [
    'handoffId',
    'tenantId',
    'organizationId',
    'projectId',
    'sessionReferenceId',
    'actorId',
    'operationId',
    'idempotencyKey'
  ]) requiredString(input[field], field);
  if (!CAPABILITIES.includes(input.capability)) fail('unsupported accounting capability');
  if (!MODES.includes(input.mode)) fail('C25_ONLY_SIMULATION_OR_SHADOW');

  return Object.freeze({
    contract: CONTRACT,
    handoffId: input.handoffId,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    sessionReferenceId: input.sessionReferenceId,
    actorId: input.actorId,
    operationId: input.operationId,
    capability: input.capability,
    idempotencyKey: input.idempotencyKey,
    mode: input.mode,
    executed: false,
    externalEffectAllowed: false,
    realProviderAllowed: false,
    requiresCanonicalExecutionJob: true,
    requiresCanonicalExecutionAttempt: true,
    requiresDurableAdmission: true
  });
}

function blocked(reason, extra = {}) {
  return Object.freeze({
    status: 'BLOCKED',
    reason,
    executed: false,
    externalEffectAllowed: false,
    ...extra
  });
}

async function admitAccountingRuntime({ handoff, runtime } = {}) {
  const validation = validateAccountingRuntimeHandoff(handoff);
  if (!validation.valid) return blocked('HANDOFF_INVALID', { blockers: validation.blockers });
  if (
    !runtime ||
    typeof runtime.admitExecutionJob !== 'function' ||
    typeof runtime.materializeExecutionAttempt !== 'function' ||
    typeof runtime.admitExecutionAttempt !== 'function'
  ) {
    return blocked('CANONICAL_RUNTIME_UNAVAILABLE');
  }

  let job;
  try {
    job = await runtime.admitExecutionJob(handoff);
  } catch {
    return blocked('JOB_ADMISSION_ERROR');
  }
  if (!job || !['ADMITTED', 'EXISTING_IDENTICAL'].includes(job.outcome)) {
    return blocked('JOB_ADMISSION_DENIED', { job });
  }

  let attempt;
  try {
    attempt = await runtime.materializeExecutionAttempt({ handoff, job });
  } catch {
    return blocked('ATTEMPT_MATERIALIZATION_ERROR', { job });
  }
  if (!attempt || typeof attempt !== 'object') {
    return blocked('ATTEMPT_MATERIALIZATION_FAILED', { job });
  }

  let admission;
  try {
    admission = await runtime.admitExecutionAttempt({ handoff, job, attempt });
  } catch {
    return blocked('ATTEMPT_ADMISSION_ERROR', { job, attempt });
  }
  if (!admission || admission.outcome !== 'ADMITTED') {
    return blocked('ATTEMPT_ADMISSION_DENIED', { job, attempt, admission });
  }

  return Object.freeze({
    status: 'ADMITTED_SIMULATION',
    mode: handoff.mode,
    executed: false,
    externalEffectAllowed: false,
    realProviderAllowed: false,
    job,
    attempt,
    admission
  });
}

module.exports = {
  MODES,
  CONTRACT,
  buildAccountingRuntimeHandoff,
  validateAccountingRuntimeHandoff,
  admitAccountingRuntime
};
