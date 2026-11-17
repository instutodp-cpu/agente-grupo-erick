'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createReverseAuditRun,
  bidirectionalTrace,
  traceExpectedChain,
  amountTieOut,
  createReverseAuditException,
  assessReverseAudit,
  assertReverseAuditAction
} = require('../src/hermes/accounting/reverse-audit');

test('C20 reverse audit run is scoped, strict and simulation-only', () => {
  const run = createReverseAuditRun({
    runId: 'reverse-1',
    tenantId: 'tenant-1',
    companyId: 'company-1',
    period: '2026-10',
    domain: 'BANK',
    startedAt: '2026-11-03T00:00:00.000Z'
  });
  assert.equal(run.status, 'RUNNING');
  assert.equal(run.simulationOnly, true);
  assert.equal(run.autoCorrection, false);
  assert.throws(() => createReverseAuditRun({ ...run, period: '2026-13' }), /INVALID_COMPETENCE/);
  assert.throws(() => createReverseAuditRun({ ...run, startedAt: 'now' }), /INVALID_INSTANT/);
  assert.throws(() => createReverseAuditRun({ ...run, domain: 'UNKNOWN' }), /UNSUPPORTED_DOMAIN/);
  assert.throws(() => createReverseAuditRun({ ...run, status: 'COMPLETED' }), /UNSUPPORTED_STATUS/);
});

test('bidirectional trace detects omissions and unsupported ledger records', () => {
  const pass = bidirectionalTrace({ sourceIds: ['sale-1'], ledgerIds: ['sale-1'] });
  assert.equal(pass.pass, true);
  const failure = bidirectionalTrace({ sourceIds: ['sale-1', 'sale-2'], ledgerIds: ['sale-1', 'ledger-only'] });
  assert.deepEqual(failure.missingFromLedger, ['sale-2']);
  assert.deepEqual(failure.unsupportedInLedger, ['ledger-only']);
  assert.equal(failure.pass, false);
  assert.throws(() => bidirectionalTrace({ sourceIds: ['sale-1', 'sale-1'], ledgerIds: [] }), /DUPLICATE_ID/);
});

test('expected chain detects missing stages, orphans and duplicate nodes', () => {
  const missing = traceExpectedChain({
    nodes: [{ id: 'sale', type: 'SALE' }, { id: 'bank', type: 'BANK', parentId: 'sale' }],
    requiredTypes: ['SALE', 'FISCAL', 'BANK']
  });
  assert.deepEqual(missing.missingTypes, ['FISCAL']);
  assert.equal(missing.pass, false);
  const orphan = traceExpectedChain({
    nodes: [{ id: 'bank', type: 'BANK', parentId: 'missing' }],
    requiredTypes: ['BANK']
  });
  assert.deepEqual(orphan.orphanNodeIds, ['bank']);
  assert.throws(() => traceExpectedChain({
    nodes: [{ id: 'sale', type: 'SALE' }, { id: 'sale', type: 'BANK' }],
    requiredTypes: ['SALE']
  }), /DUPLICATE_ID/);
});

test('reverse audit tie-out is exact in integer cents', () => {
  assert.deepEqual(amountTieOut({ upstreamCents: 10000, downstreamCents: 10000 }), {
    upstreamCents: 10000, downstreamCents: 10000, varianceCents: 0, status: 'MATCHED'
  });
  const exception = amountTieOut({ upstreamCents: 10000, downstreamCents: 9999 });
  assert.equal(exception.status, 'EXCEPTION');
  assert.equal(exception.varianceCents, -1);
  assert.throws(() => amountTieOut({ upstreamCents: -1, downstreamCents: 1 }), /INVALID_CENTS/);
});

test('reverse audit exceptions require human review and cannot auto-correct', () => {
  const exception = createReverseAuditException({
    exceptionId: 'exception-1',
    runId: 'reverse-1',
    domain: 'FISCAL',
    kind: 'MISSING_SOURCE',
    description: 'ledger without fiscal evidence',
    evidenceIds: ['evidence-1']
  });
  assert.equal(exception.status, 'OPEN');
  assert.equal(exception.requiresHumanReview, true);
  assert.equal(exception.autoCorrection, false);
  assert.throws(() => createReverseAuditException({ ...exception, domain: 'UNKNOWN' }), /UNSUPPORTED_DOMAIN/);
});

test('reverse audit returns EXCEPTIONS until every trace and tie-out is clean', () => {
  assert.equal(assessReverseAudit({
    traces: [{ pass: true }],
    tieOuts: [{ status: 'MATCHED' }],
    exceptions: [{ status: 'RESOLVED' }]
  }).status, 'PASS');
  assert.equal(assessReverseAudit({
    traces: [{ pass: false }],
    tieOuts: [{ status: 'MATCHED' }],
    exceptions: []
  }).status, 'EXCEPTIONS');
  assert.equal(assessReverseAudit({
    traces: [{ pass: true }],
    tieOuts: [{ status: 'EXCEPTION' }],
    exceptions: []
  }).status, 'EXCEPTIONS');
});

test('reverse audit actions are read/test/explain only', () => {
  assert.equal(assertReverseAuditAction('TRACE'), true);
  assert.throws(() => assertReverseAuditAction('JOURNAL_CORRECT'), /DENIED/);
  assert.throws(() => assertReverseAuditAction('UNKNOWN'), /DENIED/);
});
