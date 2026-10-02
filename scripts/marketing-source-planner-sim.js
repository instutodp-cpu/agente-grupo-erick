const assert = require('node:assert/strict');

function assessSource(source, needsCurrent = true) {
  if (source.traceability === 'unverifiable') return { decision: 'reject', reason: 'unverifiable' };
  if (needsCurrent && source.freshness !== 'current') return { decision: 'context_only', reason: 'not_current' };
  if ((source.relevance ?? 1) < 0.5) return { decision: 'context_only', reason: 'low_relevance' };
  return { decision: 'accept', reason: 'usable' };
}

function independentAcceptedEvidence(sources, needsCurrent = true) {
  const groups = new Set();
  for (const source of sources) {
    if (assessSource(source, needsCurrent).decision !== 'accept') continue;
    const group = source.independence_group || source.source_ref;
    groups.add(group);
  }
  return groups.size;
}

function planViralPatternResearch(input) {
  if (!input.commercial_goal) throw new Error('commercial_goal_required');
  return {
    mode: 'read_only',
    output: 'viral_pattern_scan',
    questions: [
      'Which current examples show repeated patterns in the target category or adaptable adjacent niches?',
      'Which hooks, structures, proof elements and CTAs repeat across independent examples?',
      'Which patterns plausibly support the commercial goal beyond views?',
      'What evidence contradicts the proposed pattern?'
    ],
    minimum_independent_evidence: 3,
    promise_virality: false,
    optimization_target: input.commercial_goal
  };
}

function run() {
  const sources = [
    { source_ref:'a', independence_group:'same-story', freshness:'current', traceability:'direct' },
    { source_ref:'b', independence_group:'same-story', freshness:'current', traceability:'direct' },
    { source_ref:'c', independence_group:'other', freshness:'historical', traceability:'direct' },
    { source_ref:'d', independence_group:'third', freshness:'current', traceability:'unverifiable' }
  ];
  assert.equal(independentAcceptedEvidence(sources, true), 1);

  const plan = planViralPatternResearch({
    category:'footwear',
    commercial_goal:'increase qualified WhatsApp conversations'
  });
  assert.equal(plan.promise_virality, false);
  assert.equal(plan.minimum_independent_evidence, 3);
  assert.notEqual(plan.optimization_target, 'views');

  console.log('Marketing C02 source/planner simulation: PASS');
}

if (require.main === module) run();
module.exports = { assessSource, independentAcceptedEvidence, planViralPatternResearch };
