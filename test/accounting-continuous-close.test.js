'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CLOSE_STATES,
  createClosePeriod,
  readiness,
  transitionClose,
  handleLateEvidence,
  createReopenRequest,
  assertSegregation,
  createClosePackage
} = require('../src/hermes/accounting/continuous-close');

const periodBase = {
  closePeriodId: 'close-1',
  tenantId: 'tenant-a',
  companyId: 'company-a',
  competence: '2026-10',
  reconciliationCoverageBps: 10000,
  evidenceCompletenessBps: 10000
};

test('close period validates scope, competence, metrics, and immutability', () => {
  const blockers = ['BANK_NOT_RECONCILED'];
  const period = createClosePeriod({ ...periodBase, blockers });
  blockers.push('MUTATED');
  assert.equal(period.status, 'OPEN');
  assert.deepEqual(period.blockers, ['BANK_NOT_RECONCILED']);
  assert.ok(Object.isFrozen(period));
  assert.ok(Object.isFrozen(period.blockers));
  assert.throws(
    () => createClosePeriod({ ...periodBase, competence: '2026-13' }),
    /YYYY-MM/
  );
  assert.throws(
    () => createClosePeriod({ ...periodBase, reconciliationCoverageBps: 10001 }),
    /0..10000/
  );
});

test('perfect score cannot override an explicit blocker', () => {
  const period = createClosePeriod({
    ...periodBase,
    blockers: ['BANK_NOT_RECONCILED']
  });
  const result = readiness(period);
  assert.equal(result.scoreBps, 10000);
  assert.equal(result.ready, false);
  assert.ok(result.hardBlockers.includes('BANK_NOT_RECONCILED'));
});

test('material exception and unexplained cent block close', () => {
  const period = createClosePeriod({
    ...periodBase,
    unexplainedVarianceCents: 1,
    unresolvedMaterialExceptions: 1
  });
  const result = readiness(period);
  assert.equal(result.ready, false);
  assert.ok(result.hardBlockers.includes('MATERIAL_EXCEPTIONS'));
  assert.ok(result.hardBlockers.includes('UNEXPLAINED_VARIANCE'));
});

test('state machine rejects skips and gates final close', () => {
  assert.throws(
    () => transitionClose('OPEN', 'CLOSED', {}),
    /INVALID_CLOSE_TRANSITION/
  );
  assert.equal(transitionClose('OPEN', 'INGESTING'), 'INGESTING');
  assert.equal(
    transitionClose('RECONCILING', 'READY_FOR_REVIEW', { ready: true }),
    'READY_FOR_REVIEW'
  );
  assert.throws(
    () => transitionClose('HUMAN_REVIEW', 'READY_TO_CLOSE', {}),
    /HUMAN_REVIEW_REQUIRED/
  );
  assert.equal(
    transitionClose('HUMAN_REVIEW', 'READY_TO_CLOSE', { humanReviewed: true }),
    'READY_TO_CLOSE'
  );
  assert.throws(
    () => transitionClose('READY_TO_CLOSE', 'CLOSED', { ready: true }),
    /CLOSE_APPROVAL_REQUIRED/
  );
  assert.equal(
    transitionClose('READY_TO_CLOSE', 'CLOSED', {
      ready: true,
      humanApproved: true
    }),
    'CLOSED'
  );
  assert.throws(
    () => transitionClose('CLOSED', 'OPEN', {}),
    /CLOSED_PERIOD_REQUIRES_CONTROLLED_REOPEN/
  );
  assert.throws(
    () => transitionClose('LOCKED', 'OPEN', {}),
    /LOCKED_PERIOD_REQUIRES_REOPEN_REQUEST/
  );
  assert.ok(CLOSE_STATES.includes('LOCKED'));
});

test('late evidence never silently mutates closed or locked periods', () => {
  const closed = handleLateEvidence({
    periodStatus: 'CLOSED',
    evidenceId: 'ev-1'
  });
  assert.equal(closed.action, 'CREATE_REOPEN_REQUEST');
  assert.equal(closed.mutateClosedPeriod, false);
  assert.equal(closed.requiresHumanApproval, true);

  const open = handleLateEvidence({
    periodStatus: 'RECONCILING',
    evidenceId: 'ev-2'
  });
  assert.equal(open.action, 'RECONCILE_CURRENT_PERIOD');
  assert.equal(open.mutateClosedPeriod, true);
});

test('reopen request is explicitly human pending', () => {
  const request = createReopenRequest({
    requestId: 'reopen-1',
    closePeriodId: 'close-1',
    periodStatus: 'CLOSED',
    reason: 'late evidence',
    requestedBy: 'operator-1',
    evidenceId: 'ev-1'
  });
  assert.equal(request.status, 'PENDING_HUMAN_APPROVAL');
  assert.equal(request.authority, 'PREPARE');
  assert.equal(request.mutateClosedPeriod, false);
  assert.ok(Object.isFrozen(request));
});

test('segregation requires three distinct identities', () => {
  assert.equal(
    assertSegregation({
      preparerId: 'operator-a',
      reviewerId: 'operator-b',
      approverId: 'operator-c'
    }),
    true
  );
  assert.throws(
    () => assertSegregation({
      preparerId: 'operator-a',
      reviewerId: 'operator-a',
      approverId: 'operator-c'
    }),
    /SEGREGATION_OF_DUTIES_VIOLATION/
  );
});

test('close package is immutable and cannot post effects', () => {
  const evidenceIds = ['ev-1'];
  const packageRecord = createClosePackage({
    packageId: 'package-1',
    closePeriodId: 'close-1',
    createdAt: '2026-10-02T10:00:00Z',
    evidenceManifestHash: 'sha256:abc',
    evidenceIds
  });
  evidenceIds.push('ev-2');
  assert.equal(packageRecord.immutable, true);
  assert.equal(packageRecord.journalPosted, false);
  assert.equal(packageRecord.fiscalSubmitted, false);
  assert.deepEqual(packageRecord.evidenceIds, ['ev-1']);
  assert.ok(Object.isFrozen(packageRecord.evidenceIds));
  assert.throws(
    () => createClosePackage({
      packageId: 'package-2',
      closePeriodId: 'close-1',
      createdAt: 'invalid',
      evidenceManifestHash: 'sha256:def'
    }),
    /ISO date or timestamp/
  );
});
