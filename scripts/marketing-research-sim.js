const assert = require('node:assert/strict');

const CURRENT_DEPENDENCIES = new Set([
  'trend', 'competitor', 'active_offer', 'platform_behavior', 'market_reference'
]);

function planResearch(input) {
  const dependencies = new Set(input.dependencies || []);
  const requiresCurrentResearch = [...dependencies].some(x => CURRENT_DEPENDENCIES.has(x));
  const currentEvidence = (input.evidence || []).filter(e => e.freshness === 'current');
  const historicalEvidence = (input.evidence || []).filter(e => e.freshness === 'historical');

  return {
    requires_current_research: requiresCurrentResearch,
    historical_context_refs: historicalEvidence.map(e => e.evidence_id),
    status: requiresCurrentResearch && currentEvidence.length === 0
      ? 'insufficient_evidence'
      : 'sufficient',
    may_claim_current_state: !requiresCurrentResearch || currentEvidence.length > 0
  };
}

function canClaimViral(plan) {
  return plan.requires_current_research && plan.status === 'sufficient' && plan.may_claim_current_state;
}

function run() {
  const staleTrend = planResearch({
    dependencies: ['trend'],
    evidence: [{ evidence_id: 'mem-120d', freshness: 'historical' }]
  });
  assert.equal(staleTrend.requires_current_research, true);
  assert.equal(staleTrend.status, 'insufficient_evidence');
  assert.equal(canClaimViral(staleTrend), false);

  const internalFact = planResearch({
    dependencies: ['first_party_internal_fact'],
    evidence: [{ evidence_id: 'linx-supported', freshness: 'current' }]
  });
  assert.equal(internalFact.requires_current_research, false);
  assert.equal(internalFact.status, 'sufficient');

  console.log('Marketing C02 research simulation: PASS');
}

if (require.main === module) run();
module.exports = { planResearch, canClaimViral };
