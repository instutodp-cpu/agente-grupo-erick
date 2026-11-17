'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createExecutionPolicy,
  authorizeExecution,
  reserveIdempotency,
  createProviderSubmission,
  recordProviderConfirmation,
  reconcileExecution
} = require('../src/hermes/accounting/controlled-financial-execution');

const envelope = {
  instructionId: 'payment-1',
  amountCents: 10000,
  destinationAccountRef: 'dest-1',
  idempotencyKey: 'key-1',
  expiresAt: '2026-11-04T12:00:00.000Z'
};
const approval = { status: 'APPROVED', approvedBy: 'approver-1', instructionId: 'payment-1' };

test('C22 execution is disabled by default', () => {
  const policy = createExecutionPolicy({
    policyId: 'policy-1',
    version: '1',
    maxAmountCents: 50000,
    allowedDestinationRefs: ['dest-1']
  });
  const result = authorizeExecution({
    envelope,
    policy,
    now: '2026-11-04T10:00:00.000Z',
    approval,
    preparedBy: 'preparer-1'
  });
  assert.equal(result.state, 'DISABLED');
  assert.ok(result.blockers.includes('FEATURE_DISABLED'));
  assert.ok(result.blockers.includes('REAL_PROVIDER_DISABLED'));
  assert.equal(result.externalEffectAllowed, false);
});

test('allowlist, amount, expiry and segregation are hard gates', () => {
  const policy = createExecutionPolicy({
    policyId: 'policy-1',
    version: '1',
    maxAmountCents: 5000,
    allowedDestinationRefs: ['other-destination'],
    featureEnabled: true,
    realProviderEnabled: true
  });
  const result = authorizeExecution({
    envelope: { ...envelope, expiresAt: '2026-11-04T09:00:00.000Z' },
    policy,
    now: '2026-11-04T10:00:00.000Z',
    approval: { ...approval, approvedBy: 'preparer-1' },
    preparedBy: 'preparer-1'
  });
  assert.equal(result.state, 'DISABLED');
  for (const blocker of ['SEGREGATION_VIOLATION', 'ENVELOPE_EXPIRED', 'DESTINATION_NOT_ALLOWLISTED', 'AMOUNT_OUT_OF_POLICY']) {
    assert.ok(result.blockers.includes(blocker));
  }
});

test('synthetic policy can reach AUTHORIZED without granting external effect', () => {
  const policy = createExecutionPolicy({
    policyId: 'policy-1',
    version: '1',
    maxAmountCents: 50000,
    allowedDestinationRefs: ['dest-1'],
    featureEnabled: true,
    realProviderEnabled: true
  });
  const result = authorizeExecution({
    envelope,
    policy,
    now: '2026-11-04T10:00:00.000Z',
    approval,
    preparedBy: 'preparer-1'
  });
  assert.equal(result.state, 'AUTHORIZED');
  assert.equal(result.simulationOnly, true);
  assert.equal(result.externalEffectAllowed, false);
});

test('persistent idempotency reuse is denied by the contract', () => {
  assert.throws(
    () => reserveIdempotency({ idempotencyKey: 'key-1', existingKeys: ['key-1'] }),
    error => error.code === 'IDEMPOTENCY_CONFLICT'
  );
  assert.equal(reserveIdempotency({ idempotencyKey: 'key-2', existingKeys: [] }).reserved, true);
});

test('real providers are rejected and synthetic submission is not confirmation', () => {
  assert.throws(
    () => createProviderSubmission({
      executionId: 'execution-1',
      instructionId: 'payment-1',
      provider: 'bank',
      idempotencyKey: 'key-1',
      submittedAt: '2026-11-04T10:00:00.000Z'
    }),
    /REAL_PROVIDER_NOT_ALLOWED/
  );
  const submission = createProviderSubmission({
    executionId: 'execution-1',
    instructionId: 'payment-1',
    provider: 'synthetic',
    idempotencyKey: 'key-1',
    submittedAt: '2026-11-04T10:00:00.000Z'
  });
  assert.equal(submission.state, 'SUBMITTED');
  assert.equal(submission.providerConfirmed, false);
  assert.equal(submission.externalEffectAllowed, false);
});

test('confirmation and reconciliation remain separate synthetic gates', () => {
  const submission = createProviderSubmission({
    executionId: 'execution-1',
    instructionId: 'payment-1',
    provider: 'synthetic',
    idempotencyKey: 'key-1',
    submittedAt: '2026-11-04T10:00:00.000Z'
  });
  assert.throws(
    () => reconcileExecution({
      submission,
      bankTransactionId: 'synthetic-bank-ref',
      amountMatched: true,
      destinationMatched: true
    }),
    /PROVIDER_CONFIRMATION_REQUIRED/
  );
  const confirmed = recordProviderConfirmation(submission, {
    confirmed: true,
    providerReference: 'synthetic-provider-ref',
    confirmedAt: '2026-11-04T10:01:00.000Z'
  });
  assert.equal(confirmed.state, 'CONFIRMED');
  assert.equal(
    reconcileExecution({
      submission: confirmed,
      bankTransactionId: 'synthetic-bank-ref',
      amountMatched: true,
      destinationMatched: true
    }).state,
    'RECONCILED'
  );
});

test('unconfirmed synthetic response fails closed', () => {
  const submission = createProviderSubmission({
    executionId: 'execution-2',
    instructionId: 'payment-1',
    provider: 'synthetic',
    idempotencyKey: 'key-2',
    submittedAt: '2026-11-04T10:00:00.000Z'
  });
  const failed = recordProviderConfirmation(submission, {
    confirmed: false,
    providerReference: 'synthetic-provider-ref',
    failureCode: 'NO_CONFIRMATION'
  });
  assert.equal(failed.state, 'FAILED');
  assert.equal(failed.providerConfirmed, false);
});
