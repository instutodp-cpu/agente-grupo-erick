'use strict';

const PAYMENT_STATES = Object.freeze([
  'DRAFT', 'VALIDATING', 'READY_FOR_REVIEW', 'APPROVED',
  'READY_TO_EXECUTE', 'EXECUTED', 'FAILED', 'RECONCILED'
]);
const PAYMENT_REQUIREMENTS = Object.freeze([
  ['obligationMatched', 'OBLIGATION_NOT_MATCHED'],
  ['amountMatched', 'AMOUNT_NOT_MATCHED'],
  ['beneficiaryVerified', 'BENEFICIARY_NOT_VERIFIED'],
  ['destinationVerified', 'DESTINATION_NOT_VERIFIED'],
  ['duplicateCheckPassed', 'DUPLICATE_RISK'],
  ['evidenceComplete', 'EVIDENCE_INCOMPLETE'],
  ['dueDateValid', 'DUE_DATE_INVALID']
]);
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
function strictDate(value, field) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw failure('INVALID_DATE', field + ' must be YYYY-MM-DD');
  }
  const date = new Date(value + 'T00:00:00.000Z');
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw failure('INVALID_DATE', field + ' is not a calendar date');
  }
  return value;
}
function strictInstant(value, field) {
  if (typeof value !== 'string' || !INSTANT_RE.test(value) || Number.isNaN(new Date(value).getTime())) {
    throw failure('INVALID_INSTANT', field + ' must be an ISO UTC instant');
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
function positiveCents(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw failure('INVALID_AMOUNT', field + ' must be a positive safe integer');
  }
  return value;
}

function createPaymentInstruction(input = {}) {
  for (const field of [
    'instructionId', 'tenantId', 'companyId', 'obligationId',
    'beneficiaryId', 'destinationAccountRef', 'createdBy'
  ]) {
    requiredString(input[field], field);
  }
  const amountCents = positiveCents(input.amountCents, 'amountCents');
  const dueDate = strictDate(input.dueDate, 'dueDate');
  const createdAt = strictInstant(input.createdAt, 'createdAt');
  const evidenceIds = uniqueStrings(input.evidenceIds ?? [], 'evidenceIds');
  return deepFreeze({
    instructionId: input.instructionId,
    tenantId: input.tenantId,
    companyId: input.companyId,
    obligationId: input.obligationId,
    beneficiaryId: input.beneficiaryId,
    amountCents,
    dueDate,
    destinationAccountRef: input.destinationAccountRef,
    createdBy: input.createdBy,
    createdAt,
    evidenceIds,
    state: 'DRAFT',
    authority: 'PREPARE',
    simulationOnly: true,
    executionAuthorityGranted: false
  });
}

function validatePaymentInstruction(input = {}) {
  const blockers = [];
  for (const [field, blocker] of PAYMENT_REQUIREMENTS) {
    if (input[field] !== true) blockers.push(blocker);
  }
  return deepFreeze({
    state: blockers.length === 0 ? 'READY_FOR_REVIEW' : 'VALIDATING',
    blockers
  });
}

function paymentIdentity(input = {}) {
  const tenantId = requiredString(input.tenantId, 'tenantId');
  const companyId = requiredString(input.companyId, 'companyId');
  const obligationId = requiredString(input.obligationId, 'obligationId');
  const beneficiaryId = requiredString(input.beneficiaryId, 'beneficiaryId');
  const amountCents = positiveCents(input.amountCents, 'amountCents');
  const dueDate = strictDate(input.dueDate, 'dueDate');
  const destinationAccountRef = requiredString(input.destinationAccountRef, 'destinationAccountRef');
  return [tenantId, companyId, obligationId, beneficiaryId, amountCents, dueDate, destinationAccountRef].join('|');
}

function detectDuplicatePayment(candidate, existing = []) {
  if (!Array.isArray(existing)) throw failure('INVALID_LIST', 'existing must be an array');
  const identity = paymentIdentity(candidate);
  const duplicate = existing.some((payment) => paymentIdentity(payment) === identity);
  return deepFreeze({ duplicate, identity });
}

function createPaymentApproval(input = {}) {
  for (const field of ['approvalId', 'instructionId', 'preparedBy', 'approvedBy']) {
    requiredString(input[field], field);
  }
  const approvedAt = strictInstant(input.approvedAt, 'approvedAt');
  if (input.preparedBy === input.approvedBy) {
    throw failure('SEGREGATION_OF_DUTIES_VIOLATION', 'preparer cannot approve own payment');
  }
  return deepFreeze({
    approvalId: input.approvalId,
    instructionId: input.instructionId,
    preparedBy: input.preparedBy,
    approvedBy: input.approvedBy,
    approvedAt,
    status: 'APPROVED',
    simulationOnly: true,
    executionAuthorityGranted: false
  });
}

function assertPaymentExecution() {
  throw failure('CAPABILITY_NOT_GRANTED', 'payment execution is not granted in preparation stage');
}

function createExecutionEnvelope(input = {}) {
  requiredString(input.instructionId, 'instructionId');
  requiredString(input.approvalId, 'approvalId');
  requiredString(input.idempotencyKey, 'idempotencyKey');
  const expiresAt = strictInstant(input.expiresAt, 'expiresAt');
  return deepFreeze({
    instructionId: input.instructionId,
    approvalId: input.approvalId,
    idempotencyKey: input.idempotencyKey,
    expiresAt,
    state: 'READY_TO_EXECUTE',
    executionAuthorityGranted: false,
    externalEffectAllowed: false,
    simulationOnly: true
  });
}

module.exports = {
  PAYMENT_STATES,
  createPaymentInstruction,
  validatePaymentInstruction,
  paymentIdentity,
  detectDuplicatePayment,
  createPaymentApproval,
  assertPaymentExecution,
  createExecutionEnvelope
};
