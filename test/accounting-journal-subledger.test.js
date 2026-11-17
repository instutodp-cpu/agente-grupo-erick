'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createJournalEntry,
  validateBalanced,
  assertPostable,
  assertNoBalancingPlug,
  classifyAccount,
  createChartOfAccountsReference
} = require('../src/hermes/accounting/journal-subledger');

const base = {
  journalEntryId: 'journal-1',
  tenantId: 'tenant-a',
  companyId: 'company-a',
  occurredAt: '2026-10-02T10:00:00Z',
  competence: '2026-10',
  accountingRuleId: 'sale-rule',
  accountingRuleVersion: 'v1',
  chartOfAccountsVersion: '2026.1',
  sourceFactIds: ['fact-1'],
  evidenceIds: ['evidence-1']
};

function line(lineId, accountCode, side, amountCents, extra = {}) {
  return {
    lineId,
    accountCode,
    side,
    amountCents,
    ...extra
  };
}

test('balanced journal remains draft and preserves exact cents', () => {
  const journal = createJournalEntry({
    ...base,
    lines: [
      line('line-1', '1.1.1', 'DEBIT', 10001),
      line('line-2', '3.1.1', 'CREDIT', 10001)
    ]
  });
  assert.equal(journal.balance.balanced, true);
  assert.equal(journal.status, 'DRAFT');
  assert.equal(journal.balance.debitCents, 10001);
  assert.ok(Object.isFrozen(journal));
  assert.ok(Object.isFrozen(journal.lines));
  assert.ok(Object.isFrozen(journal.lines[0]));
});

test('one-cent imbalance is blocked', () => {
  const journal = createJournalEntry({
    ...base,
    lines: [
      line('line-1', '1', 'DEBIT', 10001),
      line('line-2', '2', 'CREDIT', 10000)
    ]
  });
  assert.equal(journal.status, 'BLOCKED');
  assert.equal(journal.balance.varianceCents, 1);
  assert.throws(
    () => assertPostable(journal, { humanApproved: true }),
    /UNBALANCED/
  );
});

test('journal rejects zero, duplicate, fractional, and invalid lines', () => {
  assert.throws(
    () => createJournalEntry({
      ...base,
      lines: [
        line('line-1', '1', 'DEBIT', 0),
        line('line-2', '2', 'CREDIT', 0)
      ]
    }),
    /zero journal line/
  );
  assert.throws(
    () => createJournalEntry({
      ...base,
      lines: [
        line('line-1', '1', 'DEBIT', 100),
        line('line-1', '2', 'CREDIT', 100)
      ]
    }),
    /duplicate journal line/
  );
  assert.throws(
    () => createJournalEntry({
      ...base,
      lines: [
        line('line-1', '1', 'DEBIT', 1.5),
        line('line-2', '2', 'CREDIT', 1.5)
      ]
    }),
    /safe integer/
  );
});

test('journal totals fail closed at safe integer boundary', () => {
  assert.throws(
    () => createJournalEntry({
      ...base,
      lines: [
        line('line-1', '1', 'DEBIT', Number.MAX_SAFE_INTEGER),
        line('line-2', '2', 'DEBIT', 1),
        line('line-3', '3', 'CREDIT', Number.MAX_SAFE_INTEGER)
      ]
    }),
    /exceeds safe integer/
  );
});

test('journal rejects cross-company line scope and invalid dates', () => {
  assert.throws(
    () => createJournalEntry({
      ...base,
      lines: [
        line('line-1', '1', 'DEBIT', 100, { companyId: 'company-b' }),
        line('line-2', '2', 'CREDIT', 100)
      ]
    }),
    /company scope/
  );
  assert.throws(
    () => createJournalEntry({
      ...base,
      occurredAt: 'invalid',
      lines: [
        line('line-1', '1', 'DEBIT', 100),
        line('line-2', '2', 'CREDIT', 100)
      ]
    }),
    /ISO date or timestamp/
  );
});

test('human approval is required before posting and posting is not performed', () => {
  const journal = createJournalEntry({
    ...base,
    lines: [
      line('line-1', '1', 'DEBIT', 10000),
      line('line-2', '2', 'CREDIT', 10000)
    ]
  });
  assert.throws(() => assertPostable(journal), /HUMAN_APPROVAL_REQUIRED/);
  assert.equal(assertPostable(journal, { humanApproved: true }), true);
  assert.throws(
    () => createJournalEntry({
      ...base,
      status: 'POSTED',
      lines: [
        line('line-1', '1', 'DEBIT', 100),
        line('line-2', '2', 'CREDIT', 100)
      ]
    }),
    /POSTING_NOT_GRANTED/
  );
});

test('unsupported balancing plug is denied', () => {
  assert.throws(
    () => assertNoBalancingPlug({ purpose: 'MAKE_IT_BALANCE' }),
    (error) => error.code === 'DENIED'
  );
  assert.throws(
    () => assertNoBalancingPlug({ unsupported: true }),
    /UNSUPPORTED_BALANCING/
  );
});

test('AI proposed classification stays reviewable until approved mapping exists', () => {
  assert.equal(
    classifyAccount({ proposedAccountCode: '5.1' }).status,
    'NEEDS_REVIEW'
  );
  assert.equal(
    classifyAccount({
      proposedAccountCode: '5.1',
      approvedMapping: true
    }).status,
    'DETERMINISTIC'
  );
});

test('chart of accounts cannot be invented by LLM', () => {
  assert.throws(
    () => createChartOfAccountsReference({
      chartId: 'chart-1',
      version: 'v1',
      source: 'LLM_INVENTED',
      validatedBy: 'operator'
    }),
    /approved real source/
  );
  const reference = createChartOfAccountsReference({
    chartId: 'chart-1',
    version: 'v1',
    source: 'ACCOUNTANT_IMPORT',
    validatedBy: 'accountant'
  });
  assert.equal(reference.authoritative, true);
  assert.equal(reference.authority, 'READ');
});

test('forecast, provision, assessed, and paid remain distinct', () => {
  const common = {
    ...base,
    lines: [
      line('line-1', '1', 'DEBIT', 100),
      line('line-2', '2', 'CREDIT', 100)
    ]
  };
  assert.equal(
    createJournalEntry({ ...common, valueType: 'FORECAST' }).valueType,
    'FORECAST'
  );
  assert.equal(
    createJournalEntry({ ...common, valueType: 'PROVISION' }).valueType,
    'PROVISION'
  );
  assert.equal(
    createJournalEntry({ ...common, valueType: 'ASSESSED' }).valueType,
    'ASSESSED'
  );
  assert.equal(
    createJournalEntry({ ...common, valueType: 'PAID' }).valueType,
    'PAID'
  );
});
