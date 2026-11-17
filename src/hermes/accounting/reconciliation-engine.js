'use strict';

const { cloneAndFreeze } = require('./immutability');

const RECONCILIATION_STATUSES = Object.freeze([
  'MATCHED',
  'PARTIAL',
  'UNMATCHED',
  'CONFLICT',
  'NEEDS_REVIEW',
  'EXPLAINED_VARIANCE',
  'BLOCKED'
]);

const MATCH_LEVELS = Object.freeze({
  STRONG_IDENTITY: 0,
  DETERMINISTIC_COMPOSITE: 1,
  TEMPORAL: 2,
  GROUPING: 3,
  FUZZY: 4,
  AI_ASSISTED: 5
});

const MATCH_LEVEL_VALUES = Object.freeze(Object.values(MATCH_LEVELS));
const EXCEPTION_SEVERITIES = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

function required(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} is required`);
  }
}

function requireCents(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
}

function requireArray(value, field) {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
}

function requireEvidenceIds(value) {
  requireArray(value, 'evidenceIds');
  for (const evidenceId of value) required(evidenceId, 'evidenceId');
  return value;
}

function requireMatchLevel(value) {
  if (!MATCH_LEVEL_VALUES.includes(value)) {
    throw new Error('unsupported matchLevel');
  }
}

function requireStatus(value) {
  if (!RECONCILIATION_STATUSES.includes(value)) {
    throw new Error('unsupported reconciliation status');
  }
}

function requireConfidence(value) {
  if (value !== null && value !== undefined &&
      (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error('confidence must be between 0 and 1');
  }
}

function safeSum(values, field) {
  let total = 0;
  values.forEach((value, index) => {
    requireCents(value, `${field}[${index}]`);
    total += value;
    if (!Number.isSafeInteger(total)) throw new Error(`${field} sum exceeds safe integer`);
  });
  return total;
}

function createReconciliation(input = {}) {
  required(input.reconciliationId, 'reconciliationId');
  requireCents(input.expectedCents, 'expectedCents');
  requireCents(input.observedCents, 'observedCents');

  const status = input.status ?? 'UNMATCHED';
  requireStatus(status);

  const matchLevel = input.matchLevel ?? null;
  if (matchLevel !== null) requireMatchLevel(matchLevel);
  const confidence = input.confidence ?? null;
  requireConfidence(confidence);

  const expectedEvidenceIds = requireEvidenceIds(input.expectedEvidenceIds ?? []);
  const observedEvidenceIds = requireEvidenceIds(input.observedEvidenceIds ?? []);
  const deterministicChecks = input.deterministicChecks ?? [];
  requireArray(deterministicChecks);

  return cloneAndFreeze({
    reconciliationId: input.reconciliationId,
    reconciliationType: input.reconciliationType ?? 'GENERIC',
    period: input.period ?? null,
    expectedEvidenceIds,
    observedEvidenceIds,
    expectedCents: input.expectedCents,
    observedCents: input.observedCents,
    varianceCents: input.observedCents - input.expectedCents,
    method: input.method ?? null,
    matchLevel,
    confidence,
    deterministicChecks,
    status,
    explanation: input.explanation ?? null,
    ruleVersion: input.ruleVersion ?? null
  });
}

function classifyMatch({ matchLevel, deterministicPassed, varianceCents, explainedVariance = false }) {
  if (!MATCH_LEVEL_VALUES.includes(matchLevel)) return 'BLOCKED';
  if (matchLevel === MATCH_LEVELS.AI_ASSISTED || matchLevel === MATCH_LEVELS.FUZZY) {
    return 'NEEDS_REVIEW';
  }
  if (deterministicPassed !== true) return 'UNMATCHED';
  if (varianceCents === 0) return 'MATCHED';
  if (explainedVariance === true) return 'EXPLAINED_VARIANCE';
  return 'PARTIAL';
}

function reconcileAmounts(input = {}) {
  requireArray(input.expectedAmountsCents ?? []);
  requireArray(input.observedAmountsCents ?? []);
  const expectedCents = safeSum(input.expectedAmountsCents ?? [], 'expectedAmountsCents');
  const observedCents = safeSum(input.observedAmountsCents ?? [], 'observedAmountsCents');
  const varianceCents = observedCents - expectedCents;
  const status = classifyMatch({
    matchLevel: input.matchLevel,
    deterministicPassed: input.deterministicPassed,
    varianceCents,
    explainedVariance: input.explainedVariance
  });

  return createReconciliation({
    ...input,
    expectedCents,
    observedCents,
    status
  });
}

function createException(input = {}) {
  required(input.exceptionId, 'exceptionId');
  required(input.reconciliationId, 'reconciliationId');
  required(input.reasonCode, 'reasonCode');
  const severity = input.severity ?? 'MEDIUM';
  if (!EXCEPTION_SEVERITIES.includes(severity)) {
    throw new Error('unsupported exception severity');
  }
  const evidenceIds = input.evidenceIds ?? [];
  requireEvidenceIds(evidenceIds);

  return cloneAndFreeze({
    exceptionId: input.exceptionId,
    reconciliationId: input.reconciliationId,
    severity,
    reasonCode: input.reasonCode,
    evidenceIds,
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
  RECONCILIATION_STATUSES,
  MATCH_LEVELS,
  createReconciliation,
  classifyMatch,
  reconcileAmounts,
  createException,
  promoteHeuristicToRule
};
