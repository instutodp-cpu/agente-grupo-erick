'use strict';

const { cloneAndFreeze } = require('./immutability');

const JOURNAL_STATUSES = Object.freeze([
  'DRAFT',
  'NEEDS_REVIEW',
  'VALIDATED',
  'APPROVED',
  'POSTED',
  'BLOCKED'
]);

const JOURNAL_VALUE_TYPES = Object.freeze([
  'ACTUAL',
  'FORECAST',
  'PROVISION',
  'ASSESSED',
  'PAID'
]);

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

function requireIsoDateOrTimestamp(value, field) {
  required(value, field);
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) {
    const parts = value.split('-').map(Number);
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    if (
      date.getUTCFullYear() !== parts[0] ||
      date.getUTCMonth() !== parts[1] - 1 ||
      date.getUTCDate() !== parts[2]
    ) {
      throw new Error(field + ' must be an ISO date or timestamp');
    }
    return;
  }
  if (
    !/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?(?:Z|[+-]\\d{2}:\\d{2})$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new Error(field + ' must be an ISO date or timestamp');
  }
}

function requireCompetence(value) {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string' || !/^\\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error('competence must be YYYY-MM');
  }
}

function requireStringList(value, field) {
  if (!Array.isArray(value)) throw new Error(field + ' must be an array');
  for (const item of value) required(item, field + ' item');
  return [...new Set(value)];
}

function toSafeNumber(value, field) {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > max) throw new Error(field + ' exceeds safe integer range');
  return Number(value);
}

function createJournalLine(input = {}) {
  for (const field of ['lineId', 'accountCode', 'side']) {
    required(input[field], field);
  }
  if (!['DEBIT', 'CREDIT'].includes(input.side)) {
    throw new Error('side must be DEBIT or CREDIT');
  }
  requireSafeCents(input.amountCents, 'amountCents');
  if (input.amountCents === 0) {
    throw new Error('zero journal line is not allowed');
  }

  return cloneAndFreeze({
    lineId: input.lineId,
    accountCode: input.accountCode,
    side: input.side,
    amountCents: input.amountCents,
    companyId: input.companyId ?? null,
    establishmentId: input.establishmentId ?? null,
    costCenterId: input.costCenterId ?? null,
    departmentId: input.departmentId ?? null,
    evidenceIds: requireStringList(input.evidenceIds ?? [], 'evidenceIds')
  });
}

function validateBalanced(lines = []) {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new Error('journal requires at least two lines');
  }
  const lineIds = new Set();
  let debit = 0n;
  let credit = 0n;

  for (const line of lines) {
    if (!line || typeof line !== 'object') throw new Error('invalid journal line');
    if (lineIds.has(line.lineId)) throw new Error('duplicate journal line');
    lineIds.add(line.lineId);
    required(line.accountCode, 'accountCode');
    if (!['DEBIT', 'CREDIT'].includes(line.side)) {
      throw new Error('side must be DEBIT or CREDIT');
    }
    requireSafeCents(line.amountCents, 'amountCents');
    if (line.amountCents === 0) {
      throw new Error('zero journal line is not allowed');
    }
    if (line.side === 'DEBIT') debit += BigInt(line.amountCents);
    else credit += BigInt(line.amountCents);
  }

  const debitCents = toSafeNumber(debit, 'debit total');
  const creditCents = toSafeNumber(credit, 'credit total');
  return cloneAndFreeze({
    debitCents,
    creditCents,
    balanced: debitCents === creditCents,
    varianceCents: debitCents - creditCents
  });
}

function createJournalEntry(input = {}) {
  for (const field of [
    'journalEntryId',
    'tenantId',
    'companyId',
    'occurredAt',
    'accountingRuleId',
    'accountingRuleVersion',
    'chartOfAccountsVersion'
  ]) {
    required(input[field], field);
  }
  requireIsoDateOrTimestamp(input.occurredAt, 'occurredAt');
  requireCompetence(input.competence);

  const valueType = input.valueType ?? 'ACTUAL';
  if (!JOURNAL_VALUE_TYPES.includes(valueType)) {
    throw new Error('unsupported journal value type');
  }

  const requestedStatus = input.status ?? 'DRAFT';
  if (!JOURNAL_STATUSES.includes(requestedStatus)) {
    throw new Error('unsupported journal status');
  }
  if (requestedStatus === 'POSTED') {
    throw new Error('POSTING_NOT_GRANTED_IN_C11');
  }
  if (requestedStatus === 'APPROVED') {
    throw new Error('HUMAN_APPROVAL_REQUIRED');
  }

  if (!Array.isArray(input.lines)) {
    throw new Error('lines must be an array');
  }
  const lines = input.lines.map((line) => createJournalLine(line));
  for (const line of lines) {
    if (line.companyId !== null && line.companyId !== input.companyId) {
      throw new Error('journal line company scope mismatch');
    }
    if (
      line.establishmentId !== null &&
      input.establishmentId !== undefined &&
      input.establishmentId !== null &&
      line.establishmentId !== input.establishmentId
    ) {
      throw new Error('journal line establishment scope mismatch');
    }
  }

  const balance = validateBalanced(lines);
  const status = balance.balanced
    ? requestedStatus
    : 'BLOCKED';

  return cloneAndFreeze({
    journalEntryId: input.journalEntryId,
    tenantId: input.tenantId,
    companyId: input.companyId,
    establishmentId: input.establishmentId ?? null,
    occurredAt: input.occurredAt,
    competence: input.competence ?? null,
    accountingRuleId: input.accountingRuleId,
    accountingRuleVersion: input.accountingRuleVersion,
    chartOfAccountsVersion: input.chartOfAccountsVersion,
    valueType,
    sourceFactIds: requireStringList(input.sourceFactIds ?? [], 'sourceFactIds'),
    evidenceIds: requireStringList(input.evidenceIds ?? [], 'evidenceIds'),
    lines,
    status,
    balance
  });
}

function assertPostable(entry, context = {}) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('journal entry is required');
  }
  if (!entry.balance?.balanced) {
    throw new Error('UNBALANCED_JOURNAL_BLOCKED');
  }
  if (entry.status === 'BLOCKED') {
    throw new Error('BLOCKED_JOURNAL');
  }
  if (entry.status === 'POSTED') {
    throw new Error('POSTING_ALREADY_OR_NOT_GRANTED');
  }
  if (context.humanApproved !== true) {
    throw new Error('HUMAN_APPROVAL_REQUIRED');
  }
  return true;
}

function assertNoBalancingPlug(input = {}) {
  if (input.purpose === 'MAKE_IT_BALANCE' || input.unsupported === true) {
    const error = new Error('UNSUPPORTED_BALANCING_ENTRY_DENIED');
    error.code = 'DENIED';
    throw error;
  }
  return true;
}

function classifyAccount(input = {}) {
  required(input.proposedAccountCode, 'proposedAccountCode');
  if (input.approvedMapping !== true) {
    return cloneAndFreeze({
      accountCode: input.proposedAccountCode,
      status: 'NEEDS_REVIEW'
    });
  }
  return cloneAndFreeze({
    accountCode: input.proposedAccountCode,
    status: 'DETERMINISTIC'
  });
}

function createChartOfAccountsReference(input = {}) {
  for (const field of ['chartId', 'version', 'source', 'validatedBy']) {
    required(input[field], field);
  }
  if (input.source === 'LLM_INVENTED') {
    throw new Error('chart of accounts must come from an approved real source');
  }
  return cloneAndFreeze({
    chartId: input.chartId,
    version: input.version,
    source: input.source,
    validatedBy: input.validatedBy,
    authority: 'READ',
    authoritative: true
  });
}

module.exports = {
  JOURNAL_STATUSES,
  JOURNAL_VALUE_TYPES,
  createJournalLine,
  validateBalanced,
  createJournalEntry,
  assertPostable,
  assertNoBalancingPlug,
  classifyAccount,
  createChartOfAccountsReference
};
