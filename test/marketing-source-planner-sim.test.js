const test = require('node:test');
const assert = require('node:assert/strict');
const { assessSource, independentAcceptedEvidence, planViralPatternResearch } = require('../scripts/marketing-source-planner-sim');

test('unverifiable current source is rejected', () => {
  assert.equal(assessSource({ freshness:'current', traceability:'unverifiable' }).decision, 'reject');
});

test('historical source is context only for current claim', () => {
  assert.equal(assessSource({ freshness:'historical', traceability:'direct' }, true).decision, 'context_only');
});

test('duplicate reporting counts as one independent evidence group', () => {
  const n = independentAcceptedEvidence([
    { source_ref:'a', independence_group:'x', freshness:'current', traceability:'direct' },
    { source_ref:'b', independence_group:'x', freshness:'current', traceability:'direct' }
  ]);
  assert.equal(n, 1);
});

test('viral research planner requires commercial goal and never promises virality', () => {
  assert.throws(() => planViralPatternResearch({ category:'footwear' }), /commercial_goal_required/);
  const p = planViralPatternResearch({ category:'footwear', commercial_goal:'qualified leads' });
  assert.equal(p.promise_virality, false);
  assert.equal(p.optimization_target, 'qualified leads');
});
