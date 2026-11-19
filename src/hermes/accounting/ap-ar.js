'use strict';

const { cloneAndFreeze } = require('./immutability');

const OBLIGATION_STATUSES = Object.freeze([
  'OPEN',
  'DUE_SOON',
  'OVERDUE',
  'PARTIALLY_PAID',
  'PAID',
  'RENEGOTIATED',
  'BLOCKED',
  'READY_FOR_PAYMENT'
]);

const AGING_BUCKETS = Object.freeze([
  'A_VENCER',
  '1_30',
  '31_60',
  '61_90',
  '91_120',
  '120_PLUS'
]);

const FORECAST_WINDOWS = Object.freeze([7, 14, 30, 60, 90]);

function required(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(field + ' is required');
  }
}

function requireSafeCents(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(field + ' must be a non-negative safe integer');
  }
}

function requirePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(field + ' must be a positive integer');
  }
}

function requireIsoDate(value, field) {
  required(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(field + ' must be an ISO date');
  }
  const parts = value.split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (
    date.getUTCFullYear() !== parts[0] ||
    date.getUTCMonth() !== parts[1] - 1 ||
    date.getUTCDate() !== parts[2]
  ) {
    throw new Error(field + ' must be an ISO date');
  }
}

function requireEvidenceIds(value) {
  if (!Array.isArray(value)) {
    throw new Error('evidenceIds must be an array');
  }
  for (const evidenceId of value) required(evidenceId, 'evidenceId');
  return [...new Set(value)];
}

function requireStatus(value) {
  if (!OBLIGATION_STATUSES.includes(value)) {
    throw new Error('unsupported obligation status');
  }
}

function daysFromDue(dueDate, asOf) {
  requireIsoDate(dueDate, 'dueDate');
  requireIsoDate(asOf, 'asOf');
  const due = Date.parse(dueDate + 'T00:00:00Z');
  const now = Date.parse(asOf + 'T00:00:00Z');
  return Math.floor((now - due) / 86400000);
}

function deriveStatus(originalAmountCents, paidAmountCents) {
  if (paidAmountCents === originalAmountCents) return 'PAID';
  if (paidAmountCents > 0) return 'PARTIALLY_PAID';
  return 'OPEN';
}

function createObligation(input = {}) {
  for (const field of [
    'obligationId',
    'kind',
    'tenantId',
    'companyId',
    'counterpartyId',
    'dueDate',
    'sourceDocumentId'
  ]) {
    required(input[field], field);
  }
  if (!['PAYABLE', 'RECEIVABLE'].includes(input.kind)) {
    throw new Error('kind must be PAYABLE or RECEIVABLE');
  }
  requireSafeCents(input.originalAmountCents, 'originalAmountCents');
  requireIsoDate(input.dueDate, 'dueDate');
  const paidAmountCents = input.paidAmountCents ?? 0;
  requireSafeCents(paidAmountCents, 'paidAmountCents');
  if (paidAmountCents > input.originalAmountCents) {
    throw new Error('paidAmountCents exceeds originalAmountCents');
  }

  const status = input.status ?? deriveStatus(
    input.originalAmountCents,
    paidAmountCents
  );
  requireStatus(status);
  if (status === 'PAID' && paidAmountCents !== input.originalAmountCents) {
    throw new Error('PAID status requires full payment');
  }
  if (
    status === 'PARTIALLY_PAID' &&
    (paidAmountCents === 0 || paidAmountCents === input.originalAmountCents)
  ) {
    throw new Error('PARTIALLY_PAID status requires partial payment');
  }

  const evidenceIds = requireEvidenceIds(input.evidenceIds ?? []);
  const receiptIds = requireEvidenceIds(input.receiptIds ?? []);
  const installmentNumber = input.installmentNumber ?? 1;
  requirePositiveInteger(installmentNumber, 'installmentNumber');
  const currency = input.currency ?? 'BRL';
  required(currency, 'currency');
  const receiptLedger = input.receiptLedger ?? [];
  if (!Array.isArray(receiptLedger)) throw new Error('receiptLedger must be an array');
  for (const entry of receiptLedger) {
    if (!entry || typeof entry !== 'object') throw new Error('invalid receipt ledger entry');
    required(entry.receiptId, 'receiptId');
    requireIsoDate(entry.receivedAt, 'receivedAt');
    requireSafeCents(entry.amountCents, 'receipt amountCents');
    requireEvidenceIds(entry.evidenceIds ?? []);
  }

  return cloneAndFreeze({
    obligationId: input.obligationId,
    kind: input.kind,
    tenantId: input.tenantId,
    companyId: input.companyId,
    establishmentId: input.establishmentId ?? null,
    counterpartyId: input.counterpartyId,
    sourceDocumentId: input.sourceDocumentId,
    installmentNumber,
    currency,
    originalAmountCents: input.originalAmountCents,
    dueDate: input.dueDate,
    paidAmountCents,
    outstandingCents: input.originalAmountCents - paidAmountCents,
    status,
    evidenceIds,
    receiptIds,
    receiptLedger,
    crediarioId: input.crediarioId ?? null,
    customerId: input.customerId ?? null,
    paymentChannel: input.paymentChannel ?? null
  });
}

function agingBucket(dueDate, asOf) {
  const days = daysFromDue(dueDate, asOf);
  if (days <= 0) return 'A_VENCER';
  if (days <= 30) return '1_30';
  if (days <= 60) return '31_60';
  if (days <= 90) return '61_90';
  if (days <= 120) return '91_120';
  return '120_PLUS';
}

function sameIdentity(a, b) {
  return a.tenantId === b.tenantId &&
    a.kind === b.kind &&
    a.companyId === b.companyId &&
    a.counterpartyId === b.counterpartyId &&
    a.sourceDocumentId === b.sourceDocumentId &&
    a.installmentNumber === b.installmentNumber &&
    (a.currency ?? 'BRL') === (b.currency ?? 'BRL');
}

function sameFinancialFacts(a, b) {
  return a.originalAmountCents === b.originalAmountCents &&
    a.dueDate === b.dueDate;
}

function detectDuplicateObligation(a, b) {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
    throw new Error('obligations are required');
  }
  if (!sameIdentity(a, b)) return 'DISTINCT';
  return sameFinancialFacts(a, b) ? 'DUPLICATE' : 'CONFLICT';
}

function decideObligationSyncAction(current, incoming) {
  const duplicate = detectDuplicateObligation(current, incoming);
  if (duplicate === 'DISTINCT') return 'CREATE';
  if (!sameFinancialFacts(current, incoming)) return 'CRITICAL_CONFLICT';
  if (
    current.paidAmountCents === incoming.paidAmountCents &&
    current.status === incoming.status &&
    JSON.stringify(current.evidenceIds) === JSON.stringify(incoming.evidenceIds) &&
    JSON.stringify(current.receiptIds) === JSON.stringify(incoming.receiptIds)
  ) {
    return 'IGNORE_IDENTICAL';
  }
  return 'CREATE_VERSION';
}

function assessPaymentReadiness(input = {}) {
  if (input.kind !== undefined && input.kind !== 'PAYABLE') {
    return cloneAndFreeze({
      status: 'BLOCKED',
      authority: 'PREPARE',
      blockers: ['kind must be PAYABLE']
    });
  }
  const checks = input.checks ?? {};
  const requiredChecks = [
    'documentMatched',
    'goodsReceiptMatched',
    'amountMatched',
    'beneficiaryVerified',
    'noDuplicate',
    'evidenceComplete'
  ];
  const blockers = requiredChecks.filter((check) => checks[check] !== true);
  if (blockers.length > 0) {
    return cloneAndFreeze({
      status: 'BLOCKED',
      authority: 'PREPARE',
      blockers
    });
  }
  return cloneAndFreeze({
    status: 'READY_FOR_PAYMENT',
    authority: 'PREPARE',
    blockers: []
  });
}

function createCrediarioInstallment(input = {}) {
  for (const field of ['crediarioId', 'customerId']) required(input[field], field);
  const obligation = createObligation({
    ...input,
    kind: 'RECEIVABLE',
    counterpartyId: input.customerId,
    sourceDocumentId: input.sourceDocumentId ?? 'crediario:' + input.crediarioId,
    crediarioId: input.crediarioId,
    customerId: input.customerId,
    paymentChannel: 'CREDIARIO'
  });
  return obligation;
}

function recordReceipt(obligation, receipt = {}) {
  if (!obligation || obligation.kind !== 'RECEIVABLE') {
    throw new Error('a RECEIVABLE obligation is required');
  }
  for (const field of ['receiptId', 'receivedAt']) required(receipt[field], field);
  requireIsoDate(receipt.receivedAt, 'receivedAt');
  requireSafeCents(receipt.amountCents, 'amountCents');

  const receiptIds = obligation.receiptIds ?? [];
  const receiptLedger = obligation.receiptLedger ?? [];
  const previousReceipt = receiptLedger.find((entry) => entry.receiptId === receipt.receiptId);
  if (receiptIds.includes(receipt.receiptId)) {
    if (
      !previousReceipt ||
      previousReceipt.amountCents !== receipt.amountCents ||
      previousReceipt.receivedAt !== receipt.receivedAt
    ) {
      throw new Error('RECEIPT_CONFLICT');
    }
    return cloneAndFreeze({
      action: 'IGNORE_IDENTICAL',
      obligation
    });
  }
  if (receipt.amountCents > obligation.outstandingCents) {
    throw new Error('receipt amount exceeds outstanding balance');
  }

  const paidAmountCents = obligation.paidAmountCents + receipt.amountCents;
  const updated = createObligation({
    ...obligation,
    obligationId: obligation.obligationId,
    paidAmountCents,
    status: deriveStatus(obligation.originalAmountCents, paidAmountCents),
    receiptIds: [...receiptIds, receipt.receiptId],
    receiptLedger: [...receiptLedger, {
      receiptId: receipt.receiptId,
      amountCents: receipt.amountCents,
      receivedAt: receipt.receivedAt,
      evidenceIds: [...(receipt.evidenceIds ?? [])]
    }],
    evidenceIds: [...(obligation.evidenceIds ?? []), ...(receipt.evidenceIds ?? [])]
  });
  return cloneAndFreeze({
    action: 'CREATE_VERSION',
    obligation: updated
  });
}

function applyReceipt(obligation, receipt = {}) {
  return recordReceipt(obligation, receipt).obligation;
}

function prepareCollectionCase(input = {}) {
  for (const field of ['collectionCaseId', 'asOf']) required(input[field], field);
  requireIsoDate(input.asOf, 'asOf');
  if (!input.obligation || input.obligation.kind !== 'RECEIVABLE') {
    throw new Error('a RECEIVABLE obligation is required');
  }
  if (input.obligation.outstandingCents <= 0) {
    throw new Error('fully paid receivable cannot enter collection review');
  }
  const days = daysFromDue(input.obligation.dueDate, input.asOf);
  if (days <= 0) {
    throw new Error('receivable is not overdue');
  }
  return cloneAndFreeze({
    collectionCaseId: input.collectionCaseId,
    obligationId: input.obligation.obligationId,
    agingBucket: agingBucket(input.obligation.dueDate, input.asOf),
    outstandingCents: input.obligation.outstandingCents,
    authority: 'PREPARE',
    requiresHumanApproval: true,
    externalDispatch: false
  });
}

function createCreditPolicy(input = {}) {
  for (const field of ['policyId', 'version', 'effectiveFrom']) required(input[field], field);
  requireIsoDate(input.effectiveFrom, 'effectiveFrom');
  if (input.effectiveUntil !== undefined && input.effectiveUntil !== null) {
    requireIsoDate(input.effectiveUntil, 'effectiveUntil');
    if (input.effectiveUntil < input.effectiveFrom) {
      throw new Error('effectiveUntil cannot precede effectiveFrom');
    }
  }
  return cloneAndFreeze({
    policyId: input.policyId,
    version: input.version,
    effectiveFrom: input.effectiveFrom,
    effectiveUntil: input.effectiveUntil ?? null,
    limitChangeRequiresApproval: true,
    renegotiationRequiresApproval: true,
    discountRequiresApproval: true,
    negativeListingRequiresApproval: true
  });
}

function addSafe(a, b, field) {
  const result = BigInt(a) + BigInt(b);
  if (
    result > BigInt(Number.MAX_SAFE_INTEGER) ||
    result < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new Error(field + ' exceeds safe integer range');
  }
  return Number(result);
}

function forecastCash(obligations, input = {}) {
  if (!Array.isArray(obligations)) throw new Error('obligations must be an array');
  requireIsoDate(input.asOf, 'asOf');
  const windows = {};
  for (const window of FORECAST_WINDOWS) {
    windows[window] = {
      inflowCents: 0,
      outflowCents: 0,
      netCents: 0
    };
  }

  for (const obligation of obligations) {
    if (!obligation || !['PAYABLE', 'RECEIVABLE'].includes(obligation.kind)) {
      throw new Error('unsupported obligation in forecast');
    }
    requireSafeCents(obligation.outstandingCents, 'outstandingCents');
    const days = daysFromDue(obligation.dueDate, input.asOf);
    if (days <= 0) continue;
    for (const window of FORECAST_WINDOWS) {
      if (days > window) continue;
      if (obligation.kind === 'RECEIVABLE') {
        windows[window].inflowCents = addSafe(
          windows[window].inflowCents,
          obligation.outstandingCents,
          'forecast inflow'
        );
      } else {
        windows[window].outflowCents = addSafe(
          windows[window].outflowCents,
          obligation.outstandingCents,
          'forecast outflow'
        );
      }
      windows[window].netCents = windows[window].inflowCents - windows[window].outflowCents;
    }
  }

  return cloneAndFreeze({
    asOf: input.asOf,
    windows,
    authority: 'ANALYZE',
    mutatesObligations: false
  });
}

function assertFinancialEffect(action) {
  const blocked = [
    'PAYMENT_EXECUTE',
    'COLLECTION_DISPATCH',
    'CREDIT_LIMIT_MUTATE',
    'DISCOUNT_APPLY',
    'RENEGOTIATION_APPLY',
    'NEGATIVE_LISTING_SUBMIT'
  ];
  if (!blocked.includes(action)) throw new Error('unknown financial effect');
  const error = new Error(action + '_NOT_GRANTED_IN_C8');
  error.code = 'CAPABILITY_NOT_GRANTED';
  throw error;
}

function assertPaymentExecution() {
  return assertFinancialEffect('PAYMENT_EXECUTE');
}

function assertCollectionExecution() {
  return assertFinancialEffect('COLLECTION_DISPATCH');
}

function assertCreditPolicyMutation() {
  return assertFinancialEffect('CREDIT_LIMIT_MUTATE');
}

module.exports = {
  OBLIGATION_STATUSES,
  AGING_BUCKETS,
  FORECAST_WINDOWS,
  createObligation,
  createCrediarioInstallment,
  agingBucket,
  detectDuplicateObligation,
  decideObligationSyncAction,
  assessPaymentReadiness,
  recordReceipt,
  applyReceipt,
  prepareCollectionCase,
  createCreditPolicy,
  forecastCash,
  assertFinancialEffect,
  assertPaymentExecution,
  assertCollectionExecution,
  assertCreditPolicyMutation
};
