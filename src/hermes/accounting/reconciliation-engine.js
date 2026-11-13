'use strict';

const RECONCILIATION_STATUSES = Object.freeze([
  'MATCHED','PARTIAL','UNMATCHED','CONFLICT','NEEDS_REVIEW','EXPLAINED_VARIANCE','BLOCKED'
]);

const MATCH_LEVELS = Object.freeze({
  STRONG_IDENTITY: 0,
  DETERMINISTIC_COMPOSITE: 1,
  TEMPORAL: 2,
  GROUPING: 3,
  FUZZY: 4,
  AI_ASSISTED: 5
});

function integer(value, field) {
  if (!Number.isSafeInteger(value)) throw new Error(`${field} must be a safe integer`);
}

function createReconciliation(input = {}) {
  if (!input.reconciliationId) throw new Error('reconciliationId is required');
  integer(input.expectedCents, 'expectedCents');
  integer(input.observedCents, 'observedCents');
  const varianceCents = input.observedCents - input.expectedCents;
  return Object.freeze({
    reconciliationId: input.reconciliationId,
    reconciliationType: input.reconciliationType ?? 'GENERIC',
    period: input.period ?? null,
    expectedEvidenceIds: Object.freeze([...(input.expectedEvidenceIds ?? [])]),
    observedEvidenceIds: Object.freeze([...(input.observedEvidenceIds ?? [])]),
    expectedCents: input.expectedCents,
    observedCents: input.observedCents,
    varianceCents,
    method: input.method ?? null,
    matchLevel: input.matchLevel ?? null,
    confidence: input.confidence ?? null,
    deterministicChecks: Object.freeze([...(input.deterministicChecks ?? [])]),
    status: input.status ?? 'UNMATCHED',
    explanation: input.explanation ?? null,
    ruleVersion: input.ruleVersion ?? null
  });
}

function classifyMatch({matchLevel, deterministicPassed, varianceCents, explainedVariance = false}) {
  if (matchLevel === MATCH_LEVELS.AI_ASSISTED || matchLevel === MATCH_LEVELS.FUZZY) return 'NEEDS_REVIEW';
  if (deterministicPassed !== true) return 'UNMATCHED';
  if (varianceCents === 0) return 'MATCHED';
  if (explainedVariance === true) return 'EXPLAINED_VARIANCE';
  return 'PARTIAL';
}

function reconcileAmounts(input = {}) {
  const expected = input.expectedAmountsCents ?? [];
  const observed = input.observedAmountsCents ?? [];
  expected.forEach((v,i)=>integer(v,`expectedAmountsCents[${i}]`));
  observed.forEach((v,i)=>integer(v,`observedAmountsCents[${i}]`));
  const expectedCents = expected.reduce((a,b)=>a+b,0);
  const observedCents = observed.reduce((a,b)=>a+b,0);
  const varianceCents = observedCents - expectedCents;
  const status = classifyMatch({
    matchLevel: input.matchLevel,
    deterministicPassed: input.deterministicPassed,
    varianceCents,
    explainedVariance: input.explainedVariance
  });
  return createReconciliation({...input, expectedCents, observedCents, status});
}

function createException(input = {}) {
  if (!input.exceptionId || !input.reconciliationId || !input.reasonCode) {
    throw new Error('exceptionId, reconciliationId and reasonCode are required');
  }
  return Object.freeze({
    exceptionId: input.exceptionId,
    reconciliationId: input.reconciliationId,
    severity: input.severity ?? 'MEDIUM',
    reasonCode: input.reasonCode,
    evidenceIds: Object.freeze([...(input.evidenceIds ?? [])]),
    status: 'OPEN',
    proposedResolution: input.proposedResolution ?? null,
    requiresHumanReview: input.requiresHumanReview !== false
  });
}

function promoteHeuristicToRule() {
  const err = new Error('HEURISTIC_PROMOTION_REQUIRES_GROUND_TRUTH_AND_HUMAN_APPROVAL');
  err.code = 'APPROVAL_REQUIRED';
  throw err;
}

module.exports = {
  RECONCILIATION_STATUSES, MATCH_LEVELS, createReconciliation,
  classifyMatch, reconcileAmounts, createException, promoteHeuristicToRule
};
