'use strict';

const { cloneAndFreeze } = require('./immutability');

const CARD_RECEIVABLE_STATUSES = Object.freeze([
  'EXPECTED',
  'SCHEDULED',
  'SETTLED',
  'PARTIAL',
  'CHARGEBACK',
  'CANCELLED',
  'CONFLICT'
]);

function required(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} is required`);
  }
}

function requireCents(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
}

function requireIsoTimestamp(value, field) {
  required(value, field);
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be an ISO timestamp`);
  }
}

function requireEvidenceIds(value) {
  if (!Array.isArray(value)) throw new Error('evidenceIds must be an array');
  for (const evidenceId of value) required(evidenceId, 'evidenceId');
  return value;
}

function requirePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
}

function requireReceivableStatus(value) {
  if (!CARD_RECEIVABLE_STATUSES.includes(value)) {
    throw new Error('unsupported receivable status');
  }
}

function hasStrongIdentity(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function createCardTransaction(input = {}) {
  for (const field of [
    'cardTransactionId',
    'tenantId',
    'companyId',
    'saleId',
    'acquirer',
    'occurredAt'
  ]) {
    required(input[field], field);
  }
  requireCents(input.grossCents, 'grossCents');
  requirePositiveInteger(input.installments, 'installments');
  requireIsoTimestamp(input.occurredAt, 'occurredAt');
  if (!hasStrongIdentity(input.nsu) && !hasStrongIdentity(input.authorizationCode)) {
    throw new Error('NSU or authorizationCode is required');
  }
  const evidenceIds = requireEvidenceIds(input.evidenceIds ?? []);

  return cloneAndFreeze({
    cardTransactionId: input.cardTransactionId,
    tenantId: input.tenantId,
    companyId: input.companyId,
    establishmentId: input.establishmentId ?? null,
    saleId: input.saleId,
    acquirer: input.acquirer,
    merchantId: input.merchantId ?? null,
    terminalId: input.terminalId ?? null,
    nsu: input.nsu ?? null,
    authorizationCode: input.authorizationCode ?? null,
    brand: input.brand ?? null,
    modality: input.modality ?? null,
    grossCents: input.grossCents,
    installments: input.installments,
    occurredAt: input.occurredAt,
    status: input.status ?? 'AUTHORIZED',
    evidenceIds
  });
}

function createCardReceivable(input = {}) {
  for (const field of [
    'receivableId',
    'cardTransactionId',
    'expectedSettlementDate'
  ]) {
    required(input[field], field);
  }
  requirePositiveInteger(input.installmentNumber, 'installmentNumber');
  requireCents(input.grossCents, 'grossCents');
  requireCents(input.expectedNetCents, 'expectedNetCents');
  if (input.expectedNetCents > input.grossCents) {
    throw new Error('expectedNetCents cannot exceed grossCents');
  }

  const mdrCents = input.mdrCents ?? (input.grossCents - input.expectedNetCents);
  const otherFeeCents = input.otherFeeCents ?? 0;
  requireCents(mdrCents, 'mdrCents');
  requireCents(otherFeeCents, 'otherFeeCents');
  if (input.grossCents - mdrCents - otherFeeCents !== input.expectedNetCents) {
    throw new Error('receivable arithmetic mismatch');
  }
  requireIsoTimestamp(input.expectedSettlementDate, 'expectedSettlementDate');
  if (input.actualSettlementDate !== undefined && input.actualSettlementDate !== null) {
    requireIsoTimestamp(input.actualSettlementDate, 'actualSettlementDate');
  }
  if (input.actualNetCents !== undefined && input.actualNetCents !== null) {
    requireCents(input.actualNetCents, 'actualNetCents');
  }

  const status = input.status ?? 'EXPECTED';
  requireReceivableStatus(status);
  const evidenceIds = requireEvidenceIds(input.evidenceIds ?? []);

  return cloneAndFreeze({
    receivableId: input.receivableId,
    cardTransactionId: input.cardTransactionId,
    installmentNumber: input.installmentNumber,
    grossCents: input.grossCents,
    mdrCents,
    otherFeeCents,
    expectedNetCents: input.expectedNetCents,
    expectedSettlementDate: input.expectedSettlementDate,
    actualNetCents: input.actualNetCents ?? null,
    actualSettlementDate: input.actualSettlementDate ?? null,
    urReference: input.urReference ?? null,
    status,
    evidenceIds
  });
}

function auditMdr(receivable, contract) {
  if (!receivable || typeof receivable !== 'object') {
    throw new Error('receivable is required');
  }
  required(contract?.version, 'version');
  if (!Number.isSafeInteger(contract.mdrBasisPoints) ||
      contract.mdrBasisPoints < 0 || contract.mdrBasisPoints > 10000) {
    throw new Error('mdrBasisPoints must be between 0 and 10000');
  }
  requireCents(receivable.grossCents, 'grossCents');
  requireCents(receivable.mdrCents, 'mdrCents');

  const numerator = BigInt(receivable.grossCents) * BigInt(contract.mdrBasisPoints);
  const expectedFee = Number((numerator + 5000n) / 10000n);
  const varianceCents = receivable.mdrCents - expectedFee;

  return cloneAndFreeze({
    expectedMdrCents: expectedFee,
    observedMdrCents: receivable.mdrCents,
    varianceCents,
    contractVersion: contract.version,
    status: varianceCents === 0 ? 'MATCHED' : 'NEEDS_REVIEW'
  });
}

function createAnticipation(input = {}) {
  required(input.anticipationId, 'anticipationId');
  if (!Array.isArray(input.receivableIds) || input.receivableIds.length === 0) {
    throw new Error('receivableIds must be a non-empty array');
  }
  for (const receivableId of input.receivableIds) required(receivableId, 'receivableId');
  for (const field of ['occurredAt']) required(input[field], field);
  requireCents(input.grossCents, 'grossCents');
  requireCents(input.feeCents, 'feeCents');
  requireCents(input.netCents, 'netCents');
  if (input.feeCents > input.grossCents ||
      input.grossCents - input.feeCents !== input.netCents) {
    throw new Error('anticipation arithmetic mismatch');
  }
  requireIsoTimestamp(input.occurredAt, 'occurredAt');

  return cloneAndFreeze({
    anticipationId: input.anticipationId,
    receivableIds: input.receivableIds,
    grossCents: input.grossCents,
    feeCents: input.feeCents,
    netCents: input.netCents,
    occurredAt: input.occurredAt
  });
}

function createChargeback(input = {}) {
  for (const field of [
    'chargebackId',
    'cardTransactionId',
    'occurredAt',
    'reasonCode'
  ]) {
    required(input[field], field);
  }
  requireCents(input.amountCents, 'amountCents');
  requireIsoTimestamp(input.occurredAt, 'occurredAt');
  const evidenceIds = requireEvidenceIds(input.evidenceIds ?? []);

  return cloneAndFreeze({
    chargebackId: input.chargebackId,
    cardTransactionId: input.cardTransactionId,
    amountCents: input.amountCents,
    occurredAt: input.occurredAt,
    reasonCode: input.reasonCode,
    evidenceIds,
    externalDefenseAuthority: 'PREPARE',
    requiresHumanApproval: true
  });
}

module.exports = {
  CARD_RECEIVABLE_STATUSES,
  createCardTransaction,
  createCardReceivable,
  auditMdr,
  createAnticipation,
  createChargeback
};
