'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MATCH_LEVELS, classifyMatch, reconcileAmounts, createException, promoteHeuristicToRule
} = require('../src/hermes/accounting/reconciliation-engine');

test('strong deterministic exact match becomes MATCHED', () => {
  assert.equal(classifyMatch({matchLevel:MATCH_LEVELS.STRONG_IDENTITY,deterministicPassed:true,varianceCents:0}), 'MATCHED');
});

test('fuzzy and AI-assisted hypotheses never auto-match', () => {
  assert.equal(classifyMatch({matchLevel:MATCH_LEVELS.FUZZY,deterministicPassed:true,varianceCents:0}), 'NEEDS_REVIEW');
  assert.equal(classifyMatch({matchLevel:MATCH_LEVELS.AI_ASSISTED,deterministicPassed:true,varianceCents:0}), 'NEEDS_REVIEW');
});

test('supports grouped N:M amount reconciliation', () => {
  const r = reconcileAmounts({
    reconciliationId:'r1', reconciliationType:'CARD_TO_BANK',
    expectedAmountsCents:[5000,3000,2000], observedAmountsCents:[7000,3000],
    matchLevel:MATCH_LEVELS.GROUPING, deterministicPassed:true
  });
  assert.equal(r.expectedCents,10000);
  assert.equal(r.observedCents,10000);
  assert.equal(r.status,'MATCHED');
});

test('explained fee variance is visible, never hidden', () => {
  const r = reconcileAmounts({
    reconciliationId:'r2', expectedAmountsCents:[10000], observedAmountsCents:[9700],
    matchLevel:MATCH_LEVELS.DETERMINISTIC_COMPOSITE, deterministicPassed:true,
    explainedVariance:true, explanation:'contractual fee'
  });
  assert.equal(r.varianceCents,-300);
  assert.equal(r.status,'EXPLAINED_VARIANCE');
});

test('unexplained variance remains partial', () => {
  const r = reconcileAmounts({
    reconciliationId:'r3', expectedAmountsCents:[10000], observedAmountsCents:[9999],
    matchLevel:MATCH_LEVELS.DETERMINISTIC_COMPOSITE, deterministicPassed:true
  });
  assert.equal(r.status,'PARTIAL');
});

test('exceptions are first-class and human review defaults on', () => {
  const e=createException({exceptionId:'e1',reconciliationId:'r3',reasonCode:'AMOUNT_MISMATCH'});
  assert.equal(e.status,'OPEN');
  assert.equal(e.requiresHumanReview,true);
});

test('heuristic cannot silently become deterministic rule', () => {
  assert.throws(()=>promoteHeuristicToRule(), e=>e.code==='APPROVAL_REQUIRED');
});
