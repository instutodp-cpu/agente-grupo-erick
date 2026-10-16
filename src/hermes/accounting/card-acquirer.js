'use strict';

const CARD_RECEIVABLE_STATUSES = Object.freeze([
  'EXPECTED','SCHEDULED','SETTLED','PARTIAL','CHARGEBACK','CANCELLED','CONFLICT'
]);

function required(v, f) {
  if (v === undefined || v === null || v === '') throw new Error(`${f} is required`);
}
function cents(v, f) {
  if (!Number.isSafeInteger(v) || v < 0) throw new Error(`${f} must be a non-negative safe integer`);
}

function createCardTransaction(input = {}) {
  for (const f of ['cardTransactionId','tenantId','companyId','saleId','acquirer','grossCents','installments','occurredAt']) required(input[f], f);
  cents(input.grossCents,'grossCents');
  if (!Number.isSafeInteger(input.installments) || input.installments < 1) throw new Error('installments must be a positive integer');
  if (!input.nsu && !input.authorizationCode) throw new Error('NSU or authorizationCode is required');
  return Object.freeze({
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
    evidenceIds: Object.freeze([...(input.evidenceIds ?? [])])
  });
}

function createCardReceivable(input = {}) {
  for (const f of ['receivableId','cardTransactionId','installmentNumber','grossCents','expectedNetCents','expectedSettlementDate']) required(input[f], f);
  cents(input.grossCents,'grossCents'); cents(input.expectedNetCents,'expectedNetCents');
  if (input.expectedNetCents > input.grossCents) throw new Error('expectedNetCents cannot exceed grossCents');
  const mdrCents = input.mdrCents ?? (input.grossCents - input.expectedNetCents);
  cents(mdrCents,'mdrCents');
  return Object.freeze({
    receivableId: input.receivableId,
    cardTransactionId: input.cardTransactionId,
    installmentNumber: input.installmentNumber,
    grossCents: input.grossCents,
    mdrCents,
    otherFeeCents: input.otherFeeCents ?? 0,
    expectedNetCents: input.expectedNetCents,
    expectedSettlementDate: input.expectedSettlementDate,
    actualNetCents: input.actualNetCents ?? null,
    actualSettlementDate: input.actualSettlementDate ?? null,
    urReference: input.urReference ?? null,
    status: input.status ?? 'EXPECTED',
    evidenceIds: Object.freeze([...(input.evidenceIds ?? [])])
  });
}

function auditMdr(receivable, contract) {
  if (!contract || !Number.isSafeInteger(contract.mdrBasisPoints)) throw new Error('versioned acquirer contract required');
  const expectedFee = Math.round(receivable.grossCents * contract.mdrBasisPoints / 10000);
  return Object.freeze({
    expectedMdrCents: expectedFee,
    observedMdrCents: receivable.mdrCents,
    varianceCents: receivable.mdrCents - expectedFee,
    contractVersion: contract.version,
    status: receivable.mdrCents === expectedFee ? 'MATCHED' : 'NEEDS_REVIEW'
  });
}

function createAnticipation(input = {}) {
  for (const f of ['anticipationId','receivableIds','grossCents','feeCents','netCents','occurredAt']) required(input[f], f);
  cents(input.grossCents,'grossCents'); cents(input.feeCents,'feeCents'); cents(input.netCents,'netCents');
  if (input.grossCents - input.feeCents !== input.netCents) throw new Error('anticipation arithmetic mismatch');
  return Object.freeze({...input, receivableIds:Object.freeze([...input.receivableIds])});
}

function createChargeback(input = {}) {
  for (const f of ['chargebackId','cardTransactionId','amountCents','occurredAt','reasonCode']) required(input[f], f);
  cents(input.amountCents,'amountCents');
  return Object.freeze({
    chargebackId: input.chargebackId,
    cardTransactionId: input.cardTransactionId,
    amountCents: input.amountCents,
    occurredAt: input.occurredAt,
    reasonCode: input.reasonCode,
    evidenceIds: Object.freeze([...(input.evidenceIds ?? [])]),
    externalDefenseAuthority: 'PREPARE'
  });
}

module.exports = {
  CARD_RECEIVABLE_STATUSES, createCardTransaction, createCardReceivable,
  auditMdr, createAnticipation, createChargeback
};
