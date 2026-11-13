'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEvidence, sameEvidenceIdentity, stableHash } = require('../src/hermes/accounting/evidence-ledger');
const { createRuleVersion, selectEffectiveRule } = require('../src/hermes/accounting/rule-registry');

test('evidence preserves provenance and hashes original payload', () => {
  const e = createEvidence({
    evidenceId:'e1', tenantId:'t1', companyId:'c1', sourceSystem:'sefaz',
    sourceType:'official_api', sourceReference:'nfe-key', documentType:'NFE',
    originalPayload:{b:2,a:1}, occurredAt:'2026-10-01T10:00:00-03:00',
    receivedAt:'2026-10-01T10:01:00-03:00', schemaVersion:'4.00'
  });
  assert.equal(e.documentHash.length, 64);
  assert.equal(e.integrityStatus, 'UNVERIFIED');
  assert.ok(sameEvidenceIdentity(e, {...e}));
  assert.equal(e.originalPayload.a, 1);
});

test('evidence hashes equivalent object key order identically and detaches input', () => {
  const first = {a:1,b:{c:2}};
  const second = {b:{c:2},a:1};
  const e1 = createEvidence({...baseEvidence(), originalPayload:first});
  const e2 = createEvidence({...baseEvidence(), originalPayload:second});
  first.b.c = 9;
  assert.equal(e1.documentHash, e2.documentHash);
  assert.equal(e1.originalPayload.b.c, 2);
  assert.equal(Object.isFrozen(e1.originalPayload.b), true);
});

test('evidence rejects missing provenance', () => {
  assert.throws(() => createEvidence({ evidenceId:'e1' }), /tenantId is required/);
  assert.throws(() => createEvidence({...baseEvidence(), occurredAt:'bad'}), /occurredAt must be an ISO timestamp/);
});

test('rule registry selects exactly one temporally effective official rule', () => {
  const oldRule = createRuleVersion({
    ruleId:'r1', authority:'authority', obligation:'tax', version:'2025',
    effectiveFrom:'2025-01-01', effectiveUntil:'2025-12-31',
    officialSource:'official-source', schemaHash:'abc', validatedAt:'2025-01-01'
  });
  const currentRule = createRuleVersion({
    ruleId:'r2', authority:'authority', obligation:'tax', version:'2026',
    effectiveFrom:'2026-01-01', officialSource:'official-source',
    schemaHash:'def', validatedAt:'2026-01-01', supersedes:'r1'
  });
  assert.equal(selectEffectiveRule([oldRule,currentRule], {
    authority:'authority', obligation:'tax', instant:'2026-10-02'
  }).ruleId, 'r2');
});

test('rule registry rejects invalid dates and fails closed on no or multiple rules', () => {
  assert.throws(() => createRuleVersion({
    ruleId:'bad', authority:'a', obligation:'o', version:'1',
    effectiveFrom:'not-a-date', officialSource:'s', schemaHash:'h', validatedAt:'2026-01-01'
  }), /effectiveFrom must be a valid date/);

  const rule = createRuleVersion({
    ruleId:'r', authority:'a', obligation:'o', version:'1',
    effectiveFrom:'2026-01-01', officialSource:'s', schemaHash:'h', validatedAt:'2026-01-01'
  });
  assert.throws(() => selectEffectiveRule([], {authority:'a',obligation:'o',instant:'2026-10-02'}), /no effective rule/);
  assert.throws(() => selectEffectiveRule([rule,rule], {authority:'a',obligation:'o',instant:'2026-10-02'}), /ambiguous effective rule/);
});

function baseEvidence() {
  return {
    evidenceId:'base', tenantId:'t1', companyId:'c1', sourceSystem:'sefaz',
    sourceType:'official_api', sourceReference:'nfe-key', documentType:'NFE',
    occurredAt:'2026-10-01T10:00:00-03:00',
    receivedAt:'2026-10-01T10:01:00-03:00', schemaVersion:'4.00'
  };
}
