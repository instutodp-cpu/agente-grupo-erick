'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MATCH_LEVELS,
  classifyMatch,
  reconcileAmounts,
  createReconciliation,
  createException,
  promoteHeuristicToRule
} = require('../src/hermes/accounting/reconciliation-engine');

test('strong deterministic exact match becomes MATCHED', () => {
  assert.equal(
    classifyMatch({
      matchLevel: MATCH_LEVELS.STRONG_IDENTITY,
      deterministicPassed: true,
      varianceCents: 0
    }),
    'MATCHED'
  );
});

test('fuzzy and AI-assisted hypotheses never auto-match', () => {
  assert.equal(
    classifyMatch({
      matchLevel: MATCH_LEVELS.FUZZY,
      deterministicPassed: true,
      varianceCents: 0
    }),
    'NEEDS_REVIEW'
  );
  assert.equal(
    classifyMatch({
      matchLevel: MATCH_LEVELS.AI_ASSISTED,
      deterministicPassed: true,
      varianceCents: 0
    }),
    'NEEDS_REVIEW'
  );
});

test('invalid or missing match level blocks closed', () => {
  assert.equal(
    classifyMatch({ deterministicPassed: true, varianceCents: 0 }),
    'BLOCKED'
  );
});

test('supports grouped N:M amount reconciliation', () => {
  const reconciliation = reconcileAmounts({
    reconciliationId: 'r1',
    reconciliationType: 'CARD_TO_BANK',
    expectedAmountsCents: [5000, 3000, 2000],
    observedAmountsCents: [7000, 3000],
    matchLevel: MATCH_LEVELS.GROUPING,
    deterministicPassed: true
  });
  assert.equal(reconciliation.expectedCents, 10000);
  assert.equal(reconciliation.observedCents, 10000);
  assert.equal(reconciliation.varianceCents, 0);
  assert.equal(reconciliation.status, 'MATCHED');
});

test('explained fee variance is visible, never hidden', () => {
  const reconciliation = reconcileAmounts({
    reconciliationId: 'r2',
    expectedAmountsCents: [10000],
    observedAmountsCents: [9700],
    matchLevel: MATCH_LEVELS.DETERMINISTIC_COMPOSITE,
    deterministicPassed: true,
    explainedVariance: true,
    explanation: 'contractual fee'
  });
  assert.equal(reconciliation.varianceCents, -300);
  assert.equal(reconciliation.status, 'EXPLAINED_VARIANCE');
  assert.equal(reconciliation.explanation, 'contractual fee');
});

test('unexplained variance remains partial', () => {
  const reconciliation = reconcileAmounts({
    reconciliationId: 'r3',
    expectedAmountsCents: [10000],
    observedAmountsCents: [9999],
    matchLevel: MATCH_LEVELS.DETERMINISTIC_COMPOSITE,
    deterministicPassed: true
  });
  assert.equal(reconciliation.status, 'PARTIAL');
});

test('reconciliation detaches arrays and rejects invalid status/confidence', () => {
  const expectedEvidenceIds = ['e1'];
  const reconciliation = createReconciliation({
    reconciliationId: 'r4',
    expectedCents: 100,
    observedCents: 100,
    expectedEvidenceIds,
    status: 'MATCHED',
    confidence: 1
  });
  expectedEvidenceIds.push('e2');
  assert.deepEqual(reconciliation.expectedEvidenceIds, ['e1']);
  assert.ok(Object.isFrozen(reconciliation));
  assert.ok(Object.isFrozen(reconciliation.expectedEvidenceIds));
  assert.throws(
    () => createReconciliation({
      reconciliationId: 'bad-status',
      expectedCents: 1,
      observedCents: 1,
      status: 'UNKNOWN'
    }),
    /unsupported reconciliation status/
  );
  assert.throws(
    () => createReconciliation({
      reconciliationId: 'bad-confidence',
      expectedCents: 1,
      observedCents: 1,
      confidence: 1.1
    }),
    /confidence must be between 0 and 1/
  );
});

test('amounts reject fractional, negative and overflowing inputs', () => {
  assert.throws(
    () => reconcileAmounts({
      reconciliationId: 'r5',
      expectedAmountsCents: [10.5],
      observedAmountsCents: [10],
      matchLevel: MATCH_LEVELS.STRONG_IDENTITY,
      deterministicPassed: true
    }),
    /non-negative safe integer/
  );
  assert.throws(
    () => reconcileAmounts({
      reconciliationId: 'r6',
      expectedAmountsCents: [-1],
      observedAmountsCents: [1],
      matchLevel: MATCH_LEVELS.STRONG_IDENTITY,
      deterministicPassed: true
    }),
    /non-negative safe integer/
  );
  assert.throws(
    () => reconcileAmounts({
      reconciliationId: 'r7',
      expectedAmountsCents: [Number.MAX_SAFE_INTEGER, 1],
      observedAmountsCents: [1],
      matchLevel: MATCH_LEVELS.STRONG_IDENTITY,
      deterministicPassed: true
    }),
    /sum exceeds safe integer/
  );
});

test('exceptions are first-class and human review defaults on', () => {
  const exception = createException({
    exceptionId: 'e1',
    reconciliationId: 'r3',
    reasonCode: 'AMOUNT_MISMATCH',
    evidenceIds: ['evidence-1']
  });
  assert.equal(exception.status, 'OPEN');
  assert.equal(exception.requiresHumanReview, true);
  assert.ok(Object.isFrozen(exception.evidenceIds));
});

test('heuristic cannot silently become deterministic rule', () => {
  assert.throws(
    () => promoteHeuristicToRule(),
    error => error.code === 'APPROVAL_REQUIRED'
  );
});
