'use strict';

const { stableHash } = require('./evidence-ledger');

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
  'OFFICIAL_API','AUTHORIZED_OPEN_FINANCE_API','OFX','CNAB_OR_STRUCTURED_FILE','CONTROLLED_MANUAL'
]);

function required(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} is required`);
}

function assertBankReadOperation(operation) {
  if (!['balance.read','transactions.read','pix.read'].includes(operation)) {
    const err = new Error('BANK_EFFECT_DENIED');
    err.code = 'CAPABILITY_NOT_GRANTED';
    throw err;
  }
}

function createBankTransaction(input = {}) {
  for (const field of ['transactionId','tenantId','companyId','bankAccountId','postedAt','direction','amountCents','sourceReference']) {
    if (input[field] === undefined || input[field] === null || input[field] === '') throw new Error(`${field} is required`);
  }
  if (!['CREDIT','DEBIT'].includes(input.direction)) throw new Error('unsupported direction');
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 0) throw new Error('amountCents must be a non-negative safe integer');
  return Object.freeze({
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
    evidenceIds: Object.freeze([...(input.evidenceIds ?? [])]),
    identityHash: stableHash({
      bankAccountId: input.bankAccountId,
      sourceReference: input.sourceReference,
      postedAt: input.postedAt,
      direction: input.direction,
      amountCents: input.amountCents
    })
  });
}

function createPixTransaction(input = {}) {
  for (const field of ['pixId','tenantId','companyId','bankAccountId','occurredAt','amountCents','direction','status']) {
    if (input[field] === undefined || input[field] === null || input[field] === '') throw new Error(`${field} is required`);
  }
  if (!input.endToEndId && !input.txid) throw new Error('Pix requires endToEndId or txid');
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 0) throw new Error('amountCents must be a non-negative safe integer');
  return Object.freeze({
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
    evidenceIds: Object.freeze([...(input.evidenceIds ?? [])])
  });
}

function sameBankTransaction(a, b) {
  return a.identityHash === b.identityHash;
}

function samePixTransaction(a, b) {
  if (a.endToEndId && b.endToEndId) return a.endToEndId === b.endToEndId;
  if (a.txid && b.txid) return a.txid === b.txid && a.bankAccountId === b.bankAccountId;
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
  BANK_READ_POLICY, TRANSPORT_PRIORITY, assertBankReadOperation,
  createBankTransaction, createPixTransaction, sameBankTransaction,
  samePixTransaction, assertWebhookVerified
};
