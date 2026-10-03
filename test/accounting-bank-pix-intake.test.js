'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BANK_READ_POLICY, TRANSPORT_PRIORITY, assertBankReadOperation,
  createBankTransaction, createPixTransaction, sameBankTransaction,
  samePixTransaction, assertWebhookVerified
} = require('../src/hermes/accounting/bank-pix-intake');

test('bank gateway grants reads but no money movement', () => {
  assert.equal(BANK_READ_POLICY.mode, 'READ_ONLY');
  assert.equal(BANK_READ_POLICY.paymentExecute, false);
  assert.equal(BANK_READ_POLICY.pixSend, false);
  assert.equal(BANK_READ_POLICY.credentialsToLlm, false);
  assert.doesNotThrow(() => assertBankReadOperation('transactions.read'));
  assert.throws(() => assertBankReadOperation('payment.execute'), e => e.code === 'CAPABILITY_NOT_GRANTED');
});

test('bank transaction identity is deterministic', () => {
  const input={transactionId:'b1',tenantId:'t1',companyId:'c1',bankAccountId:'a1',postedAt:'2026-10-02T10:00:00-03:00',direction:'CREDIT',amountCents:10000,sourceReference:'ref1'};
  const a=createBankTransaction(input), b=createBankTransaction({...input,transactionId:'b2'});
  assert.ok(sameBankTransaction(a,b));
});

test('Pix requires a strong identifier and deduplicates by endToEndId', () => {
  const base={pixId:'p1',tenantId:'t1',companyId:'c1',bankAccountId:'a1',occurredAt:'2026-10-02T10:00:00-03:00',amountCents:5000,direction:'CREDIT',status:'SETTLED',endToEndId:'E123'};
  const a=createPixTransaction(base), b=createPixTransaction({...base,pixId:'p2'});
  assert.ok(samePixTransaction(a,b));
  assert.throws(()=>createPixTransaction({...base,endToEndId:null,txid:null}),/endToEndId or txid/);
});

test('money uses integer cents', () => {
  assert.throws(()=>createBankTransaction({transactionId:'b',tenantId:'t',companyId:'c',bankAccountId:'a',postedAt:'2026-10-02',direction:'DEBIT',amountCents:10.5,sourceReference:'r'}),/safe integer/);
});

test('unverified webhook fails closed', () => {
  assert.throws(()=>assertWebhookVerified({signatureVerified:false}), e=>e.code==='UNVERIFIED_SOURCE');
  assert.equal(assertWebhookVerified({signatureVerified:true}),true);
});

test('transport fallback never starts with browser scraping', () => {
  assert.deepEqual(TRANSPORT_PRIORITY,['OFFICIAL_API','AUTHORIZED_OPEN_FINANCE_API','OFX','CNAB_OR_STRUCTURED_FILE','CONTROLLED_MANUAL']);
});
