'use strict';

const ACCOUNTING_ENTITY_TYPES = Object.freeze([
  'AccountingEntity','Establishment','Counterparty','AccountingEvent','Transaction',
  'LedgerEntry','LedgerLine','Sale','Purchase','Receivable','Payable','Payment',
  'Settlement','BankTransaction','PixTransaction','CardTransaction','FiscalDocument',
  'FiscalEvent','TaxAssessment','InventoryMovement','GoodsReceipt','PayrollEvent',
  'Reconciliation','ReconciliationMatch','Exception','Evidence','SourceDocument',
  'RuleSet','RuleVersion','ApprovalRequest','AccountingAction','ClosePeriod',
  'CloseTask','AuditEvent'
]);

const AUTHORITY_LEVELS = Object.freeze([
  'READ','ANALYZE','PREPARE','WRITE','MONEY','FISCAL_SUBMIT'
]);

const VALUE_STATES = Object.freeze([
  'FORECAST','EXPECTED','ASSESSED','PAID','RECONCILED'
]);

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function requireIsoTimestamp(value, field) {
  requireNonEmptyString(value, field);
  if (Number.isNaN(Date.parse(value))) throw new Error(`${field} must be an ISO timestamp`);
}

function createCanonicalRecord(input = {}) {
  requireNonEmptyString(input.entityType, 'entityType');
  if (!ACCOUNTING_ENTITY_TYPES.includes(input.entityType)) {
    throw new Error(`unsupported accounting entityType: ${input.entityType}`);
  }
  requireNonEmptyString(input.id, 'id');
  requireNonEmptyString(input.tenantId, 'tenantId');
  requireNonEmptyString(input.companyId, 'companyId');
  requireNonEmptyString(input.sourceSystem, 'sourceSystem');
  requireNonEmptyString(input.sourceReference, 'sourceReference');
  requireIsoTimestamp(input.occurredAt, 'occurredAt');

  if (input.authorityLevel != null && !AUTHORITY_LEVELS.includes(input.authorityLevel)) {
    throw new Error(`unsupported authorityLevel: ${input.authorityLevel}`);
  }
  if (input.valueState != null && !VALUE_STATES.includes(input.valueState)) {
    throw new Error(`unsupported valueState: ${input.valueState}`);
  }

  return Object.freeze({
    schemaVersion: 'accounting-canonical-v1',
    entityType: input.entityType,
    id: input.id,
    tenantId: input.tenantId,
    companyId: input.companyId,
    establishmentId: input.establishmentId ?? null,
    sourceSystem: input.sourceSystem,
    sourceReference: input.sourceReference,
    occurredAt: input.occurredAt,
    competence: input.competence ?? null,
    authorityLevel: input.authorityLevel ?? 'READ',
    valueState: input.valueState ?? null,
    evidenceIds: Object.freeze([...(input.evidenceIds ?? [])]),
    payload: Object.freeze({...(input.payload ?? {})})
  });
}

module.exports = {
  ACCOUNTING_ENTITY_TYPES,
  AUTHORITY_LEVELS,
  VALUE_STATES,
  createCanonicalRecord
};
