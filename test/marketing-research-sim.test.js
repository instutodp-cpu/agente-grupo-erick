const test = require('node:test');
const assert = require('node:assert/strict');
const { planResearch, canClaimViral } = require('../scripts/marketing-research-sim');

test('current trend cannot be claimed from historical memory only', () => {
  const plan = planResearch({
    dependencies: ['trend'],
    evidence: [{ evidence_id: 'old', freshness: 'historical' }]
  });
  assert.equal(plan.status, 'insufficient_evidence');
  assert.equal(canClaimViral(plan), false);
});

test('current competitor claim requires current research', () => {
  const plan = planResearch({ dependencies: ['competitor'], evidence: [] });
  assert.equal(plan.requires_current_research, true);
  assert.equal(plan.may_claim_current_state, false);
});

test('supported internal fact does not force external research', () => {
  const plan = planResearch({
    dependencies: ['first_party_internal_fact'],
    evidence: [{ evidence_id: 'internal', freshness: 'current' }]
  });
  assert.equal(plan.requires_current_research, false);
  assert.equal(plan.status, 'sufficient');
});
