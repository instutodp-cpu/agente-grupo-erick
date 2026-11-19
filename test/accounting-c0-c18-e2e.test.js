'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createCanonicalRecord } = require('../src/hermes/accounting/canonical-model');
const { createEvidence } = require('../src/hermes/accounting/evidence-ledger');
const { MATCH_LEVELS, reconcileAmounts } = require('../src/hermes/accounting/reconciliation-engine');
const { createJournalEntry, assertPostable, assertNoBalancingPlug } = require('../src/hermes/accounting/journal-subledger');
const { createClosePeriod, readiness, transitionClose, createClosePackage } = require('../src/hermes/accounting/continuous-close');
const { createAuditEngagement, completenessTest, createInternalAuditPackage } = require('../src/hermes/accounting/independent-auditor');
const { createAccountantHandoff, assessHandoffReadiness, createAccountantChangeRequest, applyAccountantChange, transitionHandoff } = require('../src/hermes/accounting/accountant-handoff');
const { assertFiscalSubmit } = require('../src/hermes/accounting/government-obligations');
const { adversarialAction } = require('../src/hermes/accounting/ground-truth-evaluation');

test('C0-C18 happy path composes reconciliation, close, audit and accountant handoff', () => {
  const sale = createCanonicalRecord({
    entityType: 'Sale', id: 'sale-e2e-1', tenantId: 'tenant-e2e', companyId: 'company-e2e',
    establishmentId: 'store-e2e', sourceSystem: 'seta', sourceReference: 'sale-e2e-1',
    occurredAt: '2026-10-01', evidenceIds: ['ev-sale-e2e']
  });
  const evidence = createEvidence({
    evidenceId: 'ev-sale-e2e', tenantId: 'tenant-e2e', companyId: 'company-e2e',
    sourceSystem: 'seta', sourceType: 'SALE', sourceReference: 'sale-e2e-1',
    documentType: 'SALE', occurredAt: '2026-10-01', receivedAt: '2026-10-01', schemaVersion: '1'
  });
  assert.equal(sale.evidenceIds[0], evidence.evidenceId);

  const reconciliation = reconcileAmounts({
    expectedAmountsCents: [10000], observedAmountsCents: [10000], method: 'SALE_BANK',
    matchLevel: MATCH_LEVELS.STRONG_IDENTITY, deterministicPassed: true,
    expectedEvidenceIds: [evidence.evidenceId], observedEvidenceIds: [evidence.evidenceId]
  });
  assert.equal(reconciliation.status, 'MATCHED');

  const journal = createJournalEntry({
    journalEntryId: 'journal-e2e-1', tenantId: 'tenant-e2e', companyId: 'company-e2e',
    occurredAt: '2026-10-01', competence: '2026-10',
    accountingRuleId: 'sale', accountingRuleVersion: '1', chartOfAccountsVersion: '1',
    sourceFactIds: [sale.id], evidenceIds: [evidence.evidenceId],
    lines: [
      { lineId: 'line-e2e-debit', accountCode: 'cash', side: 'DEBIT', amountCents: 10000, evidenceIds: [evidence.evidenceId] },
      { lineId: 'line-e2e-credit', accountCode: 'revenue', side: 'CREDIT', amountCents: 10000, evidenceIds: [evidence.evidenceId] }
    ]
  });
  assert.equal(journal.balance.balanced, true);
  assert.equal(assertPostable(journal, { humanApproved: true }), true);

  const close = createClosePeriod({
    closePeriodId: 'close-e2e-1', tenantId: 'tenant-e2e', companyId: 'company-e2e',
    competence: '2026-10', reconciliationCoverageBps: 10000, evidenceCompletenessBps: 10000,
    unexplainedVarianceCents: 0, unresolvedMaterialExceptions: 0, evidenceManifestHash: 'manifest-e2e-1'
  });
  assert.equal(readiness(close).ready, true);
  assert.equal(transitionClose(close.status, 'INGESTING'), 'INGESTING');
  assert.equal(transitionClose('INGESTING', 'RECONCILING'), 'RECONCILING');
  assert.equal(transitionClose('RECONCILING', 'READY_FOR_REVIEW', { ready: true }), 'READY_FOR_REVIEW');
  assert.equal(transitionClose('READY_FOR_REVIEW', 'HUMAN_REVIEW'), 'HUMAN_REVIEW');
  assert.equal(transitionClose('HUMAN_REVIEW', 'READY_TO_CLOSE', { humanReviewed: true }), 'READY_TO_CLOSE');
  assert.equal(transitionClose('READY_TO_CLOSE', 'CLOSED', { ready: true, humanApproved: true }), 'CLOSED');

  const closePackage = createClosePackage({
    packageId: 'close-package-e2e-1', closePeriodId: close.closePeriodId,
    createdAt: '2026-11-01T00:00:00.000Z', evidenceManifestHash: 'manifest-e2e-1',
    evidenceIds: [evidence.evidenceId]
  });
  const engagement = createAuditEngagement({
    engagementId: 'audit-e2e-1', tenantId: 'tenant-e2e', companyId: 'company-e2e',
    period: '2026-10', preparedBy: 'preparer-e2e', auditorId: 'auditor-e2e', auditApprovedBy: 'approver-e2e'
  });
  assert.equal(completenessTest({ sourceIds: [sale.id], ledgerIds: [sale.id] }).pass, true);
  const auditPackage = createInternalAuditPackage({
    packageId: 'audit-package-e2e-1', engagementId: engagement.engagementId,
    createdAt: '2026-11-01T00:00:00.000Z', evidenceManifestHash: closePackage.evidenceManifestHash,
    findings: []
  });
  assert.equal(auditPackage.status, 'PASS');

  const gate = assessHandoffReadiness({
    closeStatus: 'CLOSED', auditStatus: auditPackage.status, evidenceComplete: true,
    unresolvedCriticalExceptions: 0
  });
  assert.equal(gate.state, 'READY_FOR_ACCOUNTANT');

  const handoff = createAccountantHandoff({
    handoffId: 'handoff-e2e-1', tenantId: 'tenant-e2e', companyId: 'company-e2e',
    period: '2026-10', closePackageId: closePackage.packageId, auditPackageId: auditPackage.packageId,
    evidenceManifestHash: closePackage.evidenceManifestHash, version: '1',
    createdAt: '2026-11-01T00:00:00.000Z', journalEntryIds: [journal.journalEntryId],
    evidenceIds: [evidence.evidenceId]
  });
  assert.equal(handoff.state, 'DRAFT');
  assert.equal(transitionHandoff(handoff.state, gate.state), 'READY_FOR_ACCOUNTANT');

  const changeRequest = createAccountantChangeRequest({
    changeRequestId: 'change-e2e-1', handoffId: handoff.handoffId, requestedBy: 'auditor-e2e',
    requestedAt: '2026-11-02T00:00:00.000Z', reason: 'Add supporting evidence to the reviewed line',
    targetType: 'JOURNAL_ENTRY', targetId: journal.journalEntryId
  });
  const applied = applyAccountantChange({
    request: changeRequest, newVersionId: 'journal-e2e-1-v2', humanApproved: true,
    evidenceIds: ['ev-sale-e2e']
  });
  assert.equal(applied.state, 'APPLIED');
  assert.equal(applied.overwritesPrevious, false);
});

test('C0-C18 adversarial path denies unsafe effects and unsupported balancing', () => {
  assert.throws(() => assertFiscalSubmit(), error => error.code === 'APPROVAL_REQUIRED');
  assert.equal(adversarialAction({ action: 'PAYMENT_EXECUTE' }).decision, 'DENIED');
  assert.equal(adversarialAction({ action: 'IGNORE_DOCUMENT' }).decision, 'NEEDS_EVIDENCE');
  assert.throws(() => assertNoBalancingPlug({ purpose: 'MAKE_IT_BALANCE' }), error => error.code === 'DENIED');
});

test('C0-C18 blocks accountant handoff when audit exceptions remain', () => {
  const gate = assessHandoffReadiness({
    closeStatus: 'CLOSED', auditStatus: 'EXCEPTIONS', evidenceComplete: true,
    unresolvedCriticalExceptions: 1
  });
  assert.equal(gate.state, 'DRAFT');
  assert.ok(gate.blockers.includes('AUDIT_NOT_PASS'));
  assert.ok(gate.blockers.includes('CRITICAL_EXCEPTIONS_OPEN'));
});
