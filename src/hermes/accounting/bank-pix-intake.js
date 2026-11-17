'use strict';

const { stableHash } = require('./evidence-ledger');
const { cloneAndFreeze } = require('./immutability');

const BANK_READ_POLICY = Object.freeze({
  gatewayId: 'bank_read_v1',
  mode: 'READ_ONLY',
  balanceRead: true,
  transactionsRead: true,
  pixRead: true,
  paymentPrepare: false,
  paymentExecute: false,
  pixSend: false,
  refund: false,
  credentialsToLlm: false,
  failClosed: true
});

const TRANSPORT_PRIORITY = Object.freeze([
  'OFFICIAL_API',
  'AUTHORIZED_OPEN_FINANCE_API',
  'OFX',
  'CNAB_OR_STRUCTURED_FILE',
  'CONTROLLED_MANUAL'
]);

const PIX_STATUSES = Object.freeze([
  'PENDING',
  'SETTLED',
  'REVERSED',
  'CANCELED'
]);

function required(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} is required`);
  }
}

function requireIsoTimestamp(value, field) {
  required(value, field);
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be an ISO timestamp`);
  }
}

function requireEvidenceIds(value) {
  if (value !== undefined && !Array.isArray(value)) {
    throw new Error('evidenceIds must be an array');
  }
  const evidenceIds = value ?? [];
  for (const evidenceId of evidenceIds) required(evidenceId, 'evidenceId');
  return evidenceIds;
}

function requireCents(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('amountCents must be a non-negative safe integer');
  }
}

function assertBankReadOperation(operation) {
  if (!['balance.read', 'transactions.read', 'pix.read'].includes(operation)) {
    const err = new Error('BANK_EFFECT_DENIED');
    err.code = 'CAPABILITY_NOT_GRANTED';
    throw err;
  }
}

function createBankTransaction(input = {}) {
  for (const field of [
    'transactionId',
    'tenantId',
    'companyId',
    'bankAccountId',
    'postedAt',
    'direction',
    'sourceReference'
  ]) {
    required(input[field], field);
  }
  if (!['CREDIT', 'DEBIT'].includes(input.direction)) {
    throw new Error('unsupported direction');
  }
  requireIsoTimestamp(input.postedAt, 'postedAt');
  if (input.bookedAt !== undefined && input.bookedAt !== null) {
    requireIsoTimestamp(input.bookedAt, 'bookedAt');
  }
  requireCents(input.amountCents);
  const evidenceIds = requireEvidenceIds(input.evidenceIds);

  const identityHash = stableHash({
    tenantId: input.tenantId,
    companyId: input.companyId,
    bankAccountId: input.bankAccountId,
    sourceReference: input.sourceReference,
    postedAt: input.postedAt,
    direction: input.direction,
    amountCents: input.amountCents
  });

  return cloneAndFreeze({
    transactionId: input.transactionId,
    tenantId: input.tenantId,
    companyId: input.companyId,
    establishmentId: input.establishmentId ?? null,
    bankAccountId: input.bankAccountId,
    bookedAt: input.bookedAt ?? null,
    postedAt: input.postedAt,
    direction: input.direction,
    amountCents: input.amountCents,
    balanceAfterCents: input.balanceAfterCents ?? null,
    transactionType: input.transactionType ?? null,
    counterparty: input.counterparty ?? null,
    bankReference: input.bankReference ?? null,
    endToEndId: input.endToEndId ?? null,
    txid: input.txid ?? null,
    rawDescription: input.rawDescription ?? null,
    sourceReference: input.sourceReference,
    evidenceIds,
    identityHash
  });
}

function createPixTransaction(input = {}) {
  for (const field of [
    'pixId',
    'tenantId',
    'companyId',
    'bankAccountId',
    'occurredAt',
    'direction',
    'status'
  ]) {
    required(input[field], field);
  }
  if (!input.endToEndId && !input.txid) {
    throw new Error('Pix requires endToEndId or txid');
  }
  if (!['CREDIT', 'DEBIT'].includes(input.direction)) {
    throw new Error('unsupported direction');
  }
  if (!PIX_STATUSES.includes(input.status)) {
    throw new Error('unsupported Pix status');
  }
  requireIsoTimestamp(input.occurredAt, 'occurredAt');
  requireCents(input.amountCents);
  const evidenceIds = requireEvidenceIds(input.evidenceIds);

  return cloneAndFreeze({
    pixId: input.pixId,
    tenantId: input.tenantId,
    companyId: input.companyId,
    establishmentId: input.establishmentId ?? null,
    bankAccountId: input.bankAccountId,
    endToEndId: input.endToEndId ?? null,
    txid: input.txid ?? null,
    amountCents: input.amountCents,
    direction: input.direction,
    occurredAt: input.occurredAt,
    payer: input.payer ?? null,
    receiver: input.receiver ?? null,
    status: input.status,
    evidenceIds
  });
}

function sameBankTransaction(a, b) {
  return Boolean(a && b && a.identityHash && a.identityHash === b.identityHash);
}

function samePixScope(a, b) {
  return a.tenantId === b.tenantId &&
    a.companyId === b.companyId &&
    a.bankAccountId === b.bankAccountId;
}

function samePixTransaction(a, b) {
  if (!a || !b || !samePixScope(a, b)) return false;
  if (a.endToEndId && b.endToEndId) {
    return a.endToEndId === b.endToEndId;
  }
  if (a.txid && b.txid) {
    return a.txid === b.txid;
  }
  return false;
}

function assertWebhookVerified(input = {}) {
  if (input.signatureVerified !== true) {
    const err = new Error('UNVERIFIED_BANK_WEBHOOK');
    err.code = 'UNVERIFIED_SOURCE';
    throw err;
  }
  return true;
}

module.exports = {
  BANK_READ_POLICY,
  TRANSPORT_PRIORITY,
  PIX_STATUSES,
  assertBankReadOperation,
  createBankTransaction,
  createPixTransaction,
  sameBankTransaction,
  samePixTransaction,
  assertWebhookVerified
};
