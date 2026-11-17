'use strict';

const EXECUTION_STATES = Object.freeze([
  'DISABLED', 'VALIDATING', 'AUTHORIZED', 'SUBMITTING',
  'SUBMITTED', 'CONFIRMED', 'FAILED', 'RECONCILED'
]);
const SIMULATION_PROVIDERS = Object.freeze(['synthetic']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}
function failure(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}
function requiredString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw failure('REQUIRED_FIELD', field + ' is required');
  }
  return value;
}
function strictInstant(value, field) {
  if (typeof value !== 'string' || !INSTANT_RE.test(value) || Number.isNaN(new Date(value).getTime())) {
    throw failure('INVALID_INSTANT', field + ' must be an ISO UTC instant');
  }
  return value;
}
function positiveCents(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw failure('INVALID_AMOUNT', field + ' must be a positive safe integer');
  }
  return value;
}
function uniqueStrings(values, field) {
  if (!Array.isArray(values)) throw failure('INVALID_LIST', field + ' must be an array');
  const result = [];
  const seen = new Set();
  for (const value of values) {
    requiredString(value, field + ' item');
    if (seen.has(value)) throw failure('DUPLICATE_ID', field + ' contains duplicates');
    seen.add(value);
    result.push(value);
  }
  return result;
}
function requiredObject(value, field) {
  if (!value || typeof value !== 'object') throw failure('REQUIRED_FIELD', field + ' is required');
  return value;
}

function createExecutionPolicy(input = {}) {
  const policyId = requiredString(input.policyId, 'policyId');
  const version = requiredString(input.version, 'version');
  const maxAmountCents = positiveCents(input.maxAmountCents, 'maxAmountCents');
  const allowedDestinationRefs = uniqueStrings(input.allowedDestinationRefs, 'allowedDestinationRefs');
  if (allowedDestinationRefs.length === 0) {
    throw failure('ALLOWLIST_REQUIRED', 'allowedDestinationRefs must not be empty');
  }
  return deepFreeze({
    policyId,
    version,
    maxAmountCents,
    allowedDestinationRefs,
    featureEnabled: input.featureEnabled === true,
    realProviderEnabled: input.realProviderEnabled === true,
    simulationOnly: true,
    externalEffectAllowed: false
  });
}

function authorizeExecution({ envelope, policy, now, approval, preparedBy } = {}) {
  requiredObject(envelope, 'envelope');
  requiredObject(policy, 'policy');
  requiredObject(approval, 'approval');
  const prepared = requiredString(preparedBy, 'preparedBy');
  const currentInstant = strictInstant(now, 'now');
  const expiresAt = strictInstant(envelope.expiresAt, 'envelope.expiresAt');
  const blockers = [];
  if (policy.featureEnabled !== true) blockers.push('FEATURE_DISABLED');
  if (policy.realProviderEnabled !== true) blockers.push('REAL_PROVIDER_DISABLED');
  if (approval.status !== 'APPROVED') blockers.push('APPROVAL_MISSING');
  const approvedBy = requiredString(approval.approvedBy, 'approval.approvedBy');
  if (approvedBy === prepared) blockers.push('SEGREGATION_VIOLATION');
  if (approval.instructionId !== undefined && approval.instructionId !== envelope.instructionId) {
    blockers.push('INSTRUCTION_MISMATCH');
  }
  if (new Date(currentInstant).getTime() >= new Date(expiresAt).getTime()) {
    blockers.push('ENVELOPE_EXPIRED');
  }
  const destination = requiredString(envelope.destinationAccountRef, 'envelope.destinationAccountRef');
  if (!policy.allowedDestinationRefs.includes(destination)) blockers.push('DESTINATION_NOT_ALLOWLISTED');
  const amountCents = positiveCents(envelope.amountCents, 'envelope.amountCents');
  if (amountCents > policy.maxAmountCents) blockers.push('AMOUNT_OUT_OF_POLICY');
  requiredString(envelope.idempotencyKey, 'envelope.idempotencyKey');
  return deepFreeze({
    state: blockers.length ? 'DISABLED' : 'AUTHORIZED',
    blockers,
    simulationOnly: true,
    externalEffectAllowed: false
  });
}

function reserveIdempotency({ idempotencyKey, existingKeys = [] } = {}) {
  const key = requiredString(idempotencyKey, 'idempotencyKey');
  const existing = uniqueStrings(existingKeys, 'existingKeys');
  if (existing.includes(key)) throw failure('IDEMPOTENCY_CONFLICT', 'duplicate execution denied');
  return deepFreeze({ idempotencyKey: key, reserved: true, persistentReservation: false });
}

function createProviderSubmission(input = {}) {
  for (const field of ['executionId', 'instructionId', 'provider', 'idempotencyKey']) {
    requiredString(input[field], field);
  }
  if (!SIMULATION_PROVIDERS.includes(input.provider)) {
    throw failure('REAL_PROVIDER_NOT_ALLOWED', 'only synthetic provider is allowed');
  }
  const submittedAt = strictInstant(input.submittedAt, 'submittedAt');
  return deepFreeze({
    executionId: input.executionId,
    instructionId: input.instructionId,
    provider: input.provider,
    idempotencyKey: input.idempotencyKey,
    submittedAt,
    state: 'SUBMITTED',
    providerConfirmed: false,
    simulationOnly: true,
    externalEffectAllowed: false
  });
}

function recordProviderConfirmation(submission, response = {}) {
  requiredObject(submission, 'submission');
  requiredString(response.providerReference, 'response.providerReference');
  if (response.confirmed !== true) {
    return deepFreeze({
      ...submission,
      state: 'FAILED',
      providerConfirmed: false,
      failureCode: requiredString(response.failureCode ?? 'UNCONFIRMED', 'failureCode')
    });
  }
  const confirmedAt = strictInstant(response.confirmedAt, 'confirmedAt');
  return deepFreeze({
    ...submission,
    state: 'CONFIRMED',
    providerConfirmed: true,
    providerReference: response.providerReference,
    confirmedAt,
    simulationOnly: true,
    externalEffectAllowed: false
  });
}

function reconcileExecution({ submission, bankTransactionId, amountMatched, destinationMatched } = {}) {
  requiredObject(submission, 'submission');
  if (submission.state !== 'CONFIRMED') throw failure('PROVIDER_CONFIRMATION_REQUIRED', 'provider confirmation required');
  const reference = requiredString(bankTransactionId, 'bankTransactionId');
  const pass = amountMatched === true && destinationMatched === true;
  return deepFreeze({
    state: pass ? 'RECONCILED' : 'FAILED',
    bankTransactionId: reference,
    amountMatched: amountMatched === true,
    destinationMatched: destinationMatched === true,
    simulationOnly: true,
    externalEffectAllowed: false
  });
}

module.exports = {
  EXECUTION_STATES,
  createExecutionPolicy,
  authorizeExecution,
  reserveIdempotency,
  createProviderSubmission,
  recordProviderConfirmation,
  reconcileExecution
};
