'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPaymentInstruction,
  validatePaymentInstruction,
  detectDuplicatePayment,
  createPaymentApproval,
  assertPaymentExecution,
  createExecutionEnvelope
} = require('../src/hermes/accounting/payment-preparation');

const base = {
  instructionId: 'payment-1',
  tenantId: 'tenant-1',
  companyId: 'company-1',
  obligationId: 'obligation-1',
  beneficiaryId: 'beneficiary-1',
  amountCents: 10000,
  dueDate: '2026-10-10',
  destinationAccountRef: 'pix:key-hash',
  createdBy: 'preparer-1',
  createdAt: '2026-11-04T00:00:00.000Z',
  evidenceIds: ['evidence-1']
};

test('C21 payment instruction is PREPARE-only and immutable', () => {
  const instruction = createPaymentInstruction(base);
  assert.equal(instruction.authority, 'PREPARE');
  assert.equal(instruction.state, 'DRAFT');
  assert.equal(instruction.simulationOnly, true);
  assert.equal(instruction.executionAuthorityGranted, false);
  assert.throws(() => createPaymentInstruction({ ...base, amountCents: 0 }), /INVALID_AMOUNT/);
  assert.throws(() => createPaymentInstruction({ ...base, dueDate: '2026-02-30' }), /INVALID_DATE/);
  assert.throws(() => createPaymentInstruction({ ...base, createdAt: 'now' }), /INVALID_INSTANT/);
});

test('payment hard gates block review until every requirement is true', () => {
  const result = validatePaymentInstruction({
    obligationMatched: true,
    amountMatched: true,
    beneficiaryVerified: true,
    destinationVerified: false,
    duplicateCheckPassed: true,
    evidenceComplete: true,
    dueDateValid: true
  });
  assert.equal(result.state, 'VALIDATING');
  assert.deepEqual(result.blockers, ['DESTINATION_NOT_VERIFIED']);
  const ready = validatePaymentInstruction({
    obligationMatched: true,
    amountMatched: true,
    beneficiaryVerified: true,
    destinationVerified: true,
    duplicateCheckPassed: true,
    evidenceComplete: true,
    dueDateValid: true
  });
  assert.equal(ready.state, 'READY_FOR_REVIEW');
});

test('payment identity is tenant-safe and duplicate detection is deterministic', () => {
  assert.equal(detectDuplicatePayment(base, [{ ...base }]).duplicate, true);
  assert.equal(detectDuplicatePayment(base, [{ ...base, tenantId: 'other-tenant' }]).duplicate, false);
  assert.throws(() => detectDuplicatePayment(base, [{ ...base, amountCents: -1 }]), /INVALID_AMOUNT/);
});

test('preparer cannot approve own payment and approval remains powerless', () => {
  assert.throws(() => createPaymentApproval({
    approvalId: 'approval-1',
    instructionId: base.instructionId,
    preparedBy: 'same-user',
    approvedBy: 'same-user',
    approvedAt: '2026-11-04T01:00:00.000Z'
  }), /SEGREGATION_OF_DUTIES_VIOLATION/);
  const approval = createPaymentApproval({
    approvalId: 'approval-1',
    instructionId: base.instructionId,
    preparedBy: 'preparer-1',
    approvedBy: 'approver-1',
    approvedAt: '2026-11-04T01:00:00.000Z'
  });
  assert.equal(approval.status, 'APPROVED');
  assert.equal(approval.executionAuthorityGranted, false);
});

test('C21 cannot execute money movement', () => {
  assert.throws(() => assertPaymentExecution(), error => error.code === 'CAPABILITY_NOT_GRANTED');
});

test('execution envelope remains simulation-only and powerless', () => {
  const envelope = createExecutionEnvelope({
    instructionId: base.instructionId,
    approvalId: 'approval-1',
    idempotencyKey: 'payment-idem-1',
    expiresAt: '2026-11-04T02:00:00.000Z'
  });
  assert.equal(envelope.state, 'READY_TO_EXECUTE');
  assert.equal(envelope.executionAuthorityGranted, false);
  assert.equal(envelope.externalEffectAllowed, false);
  assert.equal(envelope.simulationOnly, true);
});
