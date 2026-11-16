'use strict';

const { cloneAndFreeze } = require('./immutability');

const CLOSE_STATES = Object.freeze([
  'OPEN',
  'INGESTING',
  'RECONCILING',
  'EXCEPTIONS_PENDING',
  'READY_FOR_REVIEW',
  'HUMAN_REVIEW',
  'READY_TO_CLOSE',
  'CLOSED',
  'LOCKED'
]);

const TRANSITIONS = Object.freeze({
  OPEN: Object.freeze(['INGESTING']),
  INGESTING: Object.freeze(['RECONCILING']),
  RECONCILING: Object.freeze(['EXCEPTIONS_PENDING', 'READY_FOR_REVIEW']),
  EXCEPTIONS_PENDING: Object.freeze(['RECONCILING', 'READY_FOR_REVIEW']),
  READY_FOR_REVIEW: Object.freeze(['HUMAN_REVIEW', 'RECONCILING']),
  HUMAN_REVIEW: Object.freeze(['READY_TO_CLOSE', 'RECONCILING']),
  READY_TO_CLOSE: Object.freeze(['CLOSED', 'RECONCILING']),
  CLOSED: Object.freeze(['LOCKED']),
  LOCKED: Object.freeze([])
});

function required(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(field + ' is required');
  }
}

function requireSafeInteger(value, field, nonNegative = false) {
  if (!Number.isSafeInteger(value) || (nonNegative && value < 0)) {
    throw new Error(field + ' must be a ' + (nonNegative ? 'non-negative ' : '') + 'safe integer');
  }
}

function requireCompetence(value) {
  required(value, 'competence');
  if (!/^\\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error('competence must be YYYY-MM');
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

function requireStringList(value, field) {
  if (!Array.isArray(value)) throw new Error(field + ' must be an array');
  for (const item of value) required(item, field + ' item');
  return [...new Set(value)];
}

function createClosePeriod(input = {}) {
  for (const field of ['closePeriodId', 'tenantId', 'companyId']) {
    required(input[field], field);
  }
  requireCompetence(input.competence);

  const status = input.status ?? 'OPEN';
  if (!CLOSE_STATES.includes(status)) {
    throw new Error('unsupported close state');
  }

  const reconciliationCoverageBps = input.reconciliationCoverageBps ?? 0;
  const evidenceCompletenessBps = input.evidenceCompletenessBps ?? 0;
  requireSafeInteger(reconciliationCoverageBps, 'reconciliationCoverageBps', true);
  requireSafeInteger(evidenceCompletenessBps, 'evidenceCompletenessBps', true);
  if (reconciliationCoverageBps > 10000 || evidenceCompletenessBps > 10000) {
    throw new Error('readiness metric must be 0..10000 bps');
  }

  const unexplainedVarianceCents = input.unexplainedVarianceCents ?? 0;
  const unresolvedMaterialExceptions = input.unresolvedMaterialExceptions ?? 0;
  requireSafeInteger(unexplainedVarianceCents, 'unexplainedVarianceCents');
  requireSafeInteger(
    unresolvedMaterialExceptions,
    'unresolvedMaterialExceptions',
    true
  );

  return cloneAndFreeze({
    closePeriodId: input.closePeriodId,
    tenantId: input.tenantId,
    companyId: input.companyId,
    establishmentId: input.establishmentId ?? null,
    competence: input.competence,
    status,
    tasks: requireStringList(input.tasks ?? [], 'tasks'),
    blockers: requireStringList(input.blockers ?? [], 'blockers'),
    warnings: requireStringList(input.warnings ?? [], 'warnings'),
    reconciliationCoverageBps,
    evidenceCompletenessBps,
    unexplainedVarianceCents,
    unresolvedMaterialExceptions,
    evidenceManifestHash: input.evidenceManifestHash ?? null
  });
}

function readiness(close) {
  if (!close || typeof close !== 'object') {
    throw new Error('close period is required');
  }
  const metrics = [
    close.reconciliationCoverageBps,
    close.evidenceCompletenessBps
  ];
  metrics.forEach((value) => {
    requireSafeInteger(value, 'readiness metric', true);
    if (value > 10000) throw new Error('readiness metric must be 0..10000 bps');
  });
  requireSafeInteger(close.unexplainedVarianceCents, 'unexplainedVarianceCents');
  requireSafeInteger(
    close.unresolvedMaterialExceptions,
    'unresolvedMaterialExceptions',
    true
  );

  const hardBlockers = [
    ...(close.blockers ?? []),
    ...(close.unresolvedMaterialExceptions > 0 ? ['MATERIAL_EXCEPTIONS'] : []),
    ...(close.unexplainedVarianceCents !== 0 ? ['UNEXPLAINED_VARIANCE'] : [])
  ];
  const scoreBps = Math.floor(
    (close.reconciliationCoverageBps + close.evidenceCompletenessBps) / 2
  );

  return cloneAndFreeze({
    scoreBps,
    ready: hardBlockers.length === 0 && scoreBps === 10000,
    hardBlockers,
    warnings: [...(close.warnings ?? [])],
    authority: 'ANALYZE'
  });
}

function transitionClose(current, next, context = {}) {
  if (!CLOSE_STATES.includes(current) || !CLOSE_STATES.includes(next)) {
    throw new Error('unsupported close state');
  }
  if (!TRANSITIONS[current].includes(next)) {
    if (current === 'LOCKED') {
      throw new Error('LOCKED_PERIOD_REQUIRES_REOPEN_REQUEST');
    }
    if (current === 'CLOSED') {
      throw new Error('CLOSED_PERIOD_REQUIRES_CONTROLLED_REOPEN');
    }
    throw new Error('INVALID_CLOSE_TRANSITION');
  }

  if (next === 'READY_FOR_REVIEW' && context.ready !== true) {
    throw new Error('READINESS_REQUIRED');
  }
  if (next === 'READY_TO_CLOSE' && context.humanReviewed !== true) {
    throw new Error('HUMAN_REVIEW_REQUIRED');
  }
  if (
    next === 'CLOSED' &&
    (context.ready !== true || context.humanApproved !== true)
  ) {
    throw new Error('CLOSE_APPROVAL_REQUIRED');
  }
  return next;
}

function handleLateEvidence(input = {}) {
  required(input.periodStatus, 'periodStatus');
  required(input.evidenceId, 'evidenceId');
  if (!CLOSE_STATES.includes(input.periodStatus)) {
    throw new Error('unsupported close state');
  }

  if (['CLOSED', 'LOCKED'].includes(input.periodStatus)) {
    return cloneAndFreeze({
      action: 'CREATE_REOPEN_REQUEST',
      evidenceId: input.evidenceId,
      mutateClosedPeriod: false,
      requiresHumanApproval: true
    });
  }

  return cloneAndFreeze({
    action: 'RECONCILE_CURRENT_PERIOD',
    evidenceId: input.evidenceId,
    mutateClosedPeriod: true,
    requiresHumanApproval: false
  });
}

function createReopenRequest(input = {}) {
  for (const field of ['requestId', 'closePeriodId', 'reason', 'requestedBy']) {
    required(input[field], field);
  }
  if (
    input.periodStatus !== undefined &&
    !['CLOSED', 'LOCKED'].includes(input.periodStatus)
  ) {
    throw new Error('reopen request requires CLOSED or LOCKED period');
  }
  return cloneAndFreeze({
    requestId: input.requestId,
    closePeriodId: input.closePeriodId,
    reason: input.reason,
    requestedBy: input.requestedBy,
    evidenceId: input.evidenceId ?? null,
    status: 'PENDING_HUMAN_APPROVAL',
    authority: 'PREPARE',
    mutateClosedPeriod: false
  });
}

function assertSegregation(input = {}) {
  const fields = ['preparerId', 'reviewerId', 'approverId'];
  fields.forEach((field) => required(input[field], field));
  if (new Set(fields.map((field) => input[field])).size !== fields.length) {
    throw new Error('SEGREGATION_OF_DUTIES_VIOLATION');
  }
  return true;
}

function createClosePackage(input = {}) {
  for (const field of [
    'packageId',
    'closePeriodId',
    'createdAt',
    'evidenceManifestHash'
  ]) {
    required(input[field], field);
  }
  requireIsoDateOrTimestamp(input.createdAt, 'createdAt');
  const evidenceIds = requireStringList(input.evidenceIds ?? [], 'evidenceIds');
  return cloneAndFreeze({
    packageId: input.packageId,
    closePeriodId: input.closePeriodId,
    createdAt: input.createdAt,
    evidenceManifestHash: input.evidenceManifestHash,
    evidenceIds,
    immutable: true,
    authority: 'PREPARE',
    journalPosted: false,
    fiscalSubmitted: false
  });
}

module.exports = {
  CLOSE_STATES,
  TRANSITIONS,
  createClosePeriod,
  readiness,
  transitionClose,
  handleLateEvidence,
  createReopenRequest,
  assertSegregation,
  createClosePackage
};
