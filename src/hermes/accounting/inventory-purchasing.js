'use strict';

const { cloneAndFreeze } = require('./immutability');

const INVENTORY_MOVEMENT_TYPES = Object.freeze([
  'OPENING',
  'PURCHASE',
  'TRANSFER_IN',
  'CUSTOMER_RETURN',
  'POSITIVE_ADJUSTMENT',
  'SALE',
  'TRANSFER_OUT',
  'SUPPLIER_RETURN',
  'LOSS_DAMAGE',
  'NEGATIVE_ADJUSTMENT'
]);

const RECEIPT_STATUSES = Object.freeze([
  'COMPLETE',
  'PARTIAL',
  'OVER_RECEIVED',
  'REJECTED'
]);

const TRANSFER_STATUSES = Object.freeze([
  'CREATED',
  'DISPATCHED',
  'IN_TRANSIT',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CONFLICT'
]);

const MOVEMENT_INCREASES = new Set([
  'PURCHASE',
  'TRANSFER_IN',
  'CUSTOMER_RETURN',
  'POSITIVE_ADJUSTMENT'
]);

const MOVEMENT_DECREASES = new Set([
  'SALE',
  'TRANSFER_OUT',
  'SUPPLIER_RETURN',
  'LOSS_DAMAGE',
  'NEGATIVE_ADJUSTMENT'
]);

function required(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(field + ' is required');
  }
}

function requireInteger(value, field, nonNegative = false) {
  if (!Number.isSafeInteger(value) || (nonNegative && value < 0)) {
    throw new Error(
      field + ' must be a ' + (nonNegative ? 'non-negative ' : '') + 'safe integer'
    );
  }
}

function requireIsoDate(value, field) {
  required(value, field);
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) {
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

function toSafeNumber(value, field) {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  const min = BigInt(Number.MIN_SAFE_INTEGER);
  if (value > max || value < min) {
    throw new Error(field + ' exceeds safe integer range');
  }
  return Number(value);
}

function safeDifference(left, right, field) {
  return toSafeNumber(BigInt(left) - BigInt(right), field);
}

function createInventoryMovement(input = {}) {
  for (const field of [
    'movementId',
    'tenantId',
    'companyId',
    'establishmentId',
    'sku',
    'movementType',
    'occurredAt'
  ]) {
    required(input[field], field);
  }
  if (!INVENTORY_MOVEMENT_TYPES.includes(input.movementType)) {
    throw new Error('unsupported inventory movement type');
  }
  requireInteger(input.quantityMilliUnits, 'quantityMilliUnits', true);
  requireIsoDate(input.occurredAt, 'occurredAt');

  if (input.unitCostCents !== undefined && input.unitCostCents !== null) {
    requireInteger(input.unitCostCents, 'unitCostCents', true);
  }

  return cloneAndFreeze({
    movementId: input.movementId,
    tenantId: input.tenantId,
    companyId: input.companyId,
    establishmentId: input.establishmentId,
    sku: input.sku,
    movementType: input.movementType,
    quantityMilliUnits: input.quantityMilliUnits,
    unitCostCents: input.unitCostCents ?? null,
    occurredAt: input.occurredAt,
    sourceDocumentId: input.sourceDocumentId ?? null,
    evidenceIds: requireEvidenceIds(input.evidenceIds ?? [])
  });
}

function rollForward(openingMilliUnits, movements = []) {
  requireInteger(openingMilliUnits, 'openingMilliUnits');
  if (!Array.isArray(movements)) {
    throw new Error('movements must be an array');
  }

  let balance = BigInt(openingMilliUnits);
  for (const movement of movements) {
    if (!movement || typeof movement !== 'object') {
      throw new Error('invalid inventory movement');
    }
    if (!INVENTORY_MOVEMENT_TYPES.includes(movement.movementType)) {
      throw new Error('unsupported inventory movement type');
    }
    requireInteger(movement.quantityMilliUnits, 'quantityMilliUnits', true);
    const quantity = BigInt(movement.quantityMilliUnits);
    if (MOVEMENT_INCREASES.has(movement.movementType)) balance += quantity;
    if (MOVEMENT_DECREASES.has(movement.movementType)) balance -= quantity;
  }
  return toSafeNumber(balance, 'inventory roll-forward');
}

function assessGoodsReceipt(input = {}) {
  requireInteger(input.orderedMilliUnits, 'orderedMilliUnits', true);
  requireInteger(input.receivedMilliUnits, 'receivedMilliUnits', true);
  if (input.rejected === true) return 'REJECTED';
  if (input.receivedMilliUnits === input.orderedMilliUnits) return 'COMPLETE';
  if (input.receivedMilliUnits < input.orderedMilliUnits) return 'PARTIAL';
  return 'OVER_RECEIVED';
}

function reconcilePurchaseFiveWay(checks = {}) {
  if (!checks || typeof checks !== 'object' || Array.isArray(checks)) {
    throw new Error('purchase checks must be an object');
  }
  const requiredChecks = [
    'purchaseOrderMatched',
    'fiscalDocumentMatched',
    'goodsReceiptMatched',
    'payableMatched',
    'inventoryMatched'
  ];
  const failedChecks = requiredChecks.filter((check) => checks[check] !== true);
  return cloneAndFreeze({
    status: failedChecks.length === 0 ? 'MATCHED' : 'NEEDS_REVIEW',
    authority: 'ANALYZE',
    failedChecks
  });
}

function reconcileInventory(input = {}) {
  for (const field of [
    'theoreticalMilliUnits',
    'physicalMilliUnits',
    'erpMilliUnits'
  ]) {
    requireInteger(input[field], field);
  }
  const physicalVarianceMilliUnits = safeDifference(
    input.physicalMilliUnits,
    input.theoreticalMilliUnits,
    'physical variance'
  );
  const erpVarianceMilliUnits = safeDifference(
    input.erpMilliUnits,
    input.theoreticalMilliUnits,
    'ERP variance'
  );

  return cloneAndFreeze({
    theoreticalMilliUnits: input.theoreticalMilliUnits,
    physicalMilliUnits: input.physicalMilliUnits,
    erpMilliUnits: input.erpMilliUnits,
    physicalVarianceMilliUnits,
    erpVarianceMilliUnits,
    status: physicalVarianceMilliUnits === 0 && erpVarianceMilliUnits === 0
      ? 'MATCHED'
      : 'NEEDS_REVIEW',
    authority: 'ANALYZE'
  });
}

function createTransfer(input = {}) {
  for (const field of [
    'transferId',
    'tenantId',
    'companyId',
    'sku',
    'fromEstablishmentId',
    'toEstablishmentId'
  ]) {
    required(input[field], field);
  }
  if (input.fromEstablishmentId === input.toEstablishmentId) {
    throw new Error('transfer establishments must differ');
  }
  requireInteger(input.dispatchedMilliUnits, 'dispatchedMilliUnits', true);
  const receivedMilliUnits = input.receivedMilliUnits ?? 0;
  requireInteger(receivedMilliUnits, 'receivedMilliUnits', true);
  if (input.occurredAt !== undefined && input.occurredAt !== null) {
    requireIsoDate(input.occurredAt, 'occurredAt');
  }

  let status = 'IN_TRANSIT';
  if (receivedMilliUnits === input.dispatchedMilliUnits) status = 'RECEIVED';
  if (receivedMilliUnits > 0 && receivedMilliUnits < input.dispatchedMilliUnits) {
    status = 'PARTIALLY_RECEIVED';
  }
  if (receivedMilliUnits > input.dispatchedMilliUnits) status = 'CONFLICT';

  return cloneAndFreeze({
    transferId: input.transferId,
    tenantId: input.tenantId,
    companyId: input.companyId,
    sku: input.sku,
    fromEstablishmentId: input.fromEstablishmentId,
    toEstablishmentId: input.toEstablishmentId,
    dispatchedMilliUnits: input.dispatchedMilliUnits,
    receivedMilliUnits,
    status,
    occurredAt: input.occurredAt ?? null,
    evidenceIds: requireEvidenceIds(input.evidenceIds ?? [])
  });
}

function lossSignal(input = {}) {
  const severity = input.severity ?? 'MEDIUM';
  if (!['LOW', 'MEDIUM', 'HIGH'].includes(severity)) {
    throw new Error('unsupported loss severity');
  }
  return cloneAndFreeze({
    signalId: input.signalId ?? null,
    tenantId: input.tenantId ?? null,
    companyId: input.companyId ?? null,
    establishmentId: input.establishmentId ?? null,
    sku: input.sku ?? null,
    signalType: 'INVENTORY_VARIANCE',
    severity,
    requiresHumanReview: true,
    fraudConclusion: false,
    evidenceIds: requireEvidenceIds(input.evidenceIds ?? [])
  });
}

function assertInventoryWrite(action = 'STOCK_ADJUSTMENT') {
  const error = new Error(action + '_NOT_GRANTED_IN_C9');
  error.code = 'CAPABILITY_NOT_GRANTED';
  throw error;
}

module.exports = {
  INVENTORY_MOVEMENT_TYPES,
  RECEIPT_STATUSES,
  TRANSFER_STATUSES,
  createInventoryMovement,
  rollForward,
  assessGoodsReceipt,
  reconcilePurchaseFiveWay,
  reconcileInventory,
  createTransfer,
  lossSignal,
  assertInventoryWrite
};
