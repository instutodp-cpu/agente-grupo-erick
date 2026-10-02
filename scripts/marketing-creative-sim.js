const assert = require('node:assert/strict');

const TESTABLE_DIMENSIONS = new Set([
  'hook','format','proof','offer_framing','cta','pacing','visual_structure','audience_angle'
]);

function buildCreativeConcept(input) {
  if (!input.commercial_objective) throw new Error('commercial_objective_required');
  const unknowns = ['price','stock','margin'].filter(k => input[k] == null);
  return {
    commercial_objective: input.commercial_objective,
    evidence_refs: input.evidence_refs || [],
    unknowns,
    may_invent_offer_fact: false,
    promise_virality: false,
    status: (input.evidence_refs || []).length ? 'evidence_backed' : 'hypothesis'
  };
}

function validateVariant(variant) {
  if (!TESTABLE_DIMENSIONS.has(variant.dimension_changed)) return { valid:false, reason:'non_testable_dimension' };
  if (!variant.hypothesis) return { valid:false, reason:'hypothesis_required' };
  if (!variant.expected_signal) return { valid:false, reason:'expected_signal_required' };
  return { valid:true };
}

function run() {
  const concept = buildCreativeConcept({
    commercial_objective:'increase qualified WhatsApp conversations',
    price:null, stock:null, margin:null,
    evidence_refs:['pattern-01','pattern-02','pattern-03']
  });
  assert.deepEqual(concept.unknowns, ['price','stock','margin']);
  assert.equal(concept.may_invent_offer_fact, false);
  assert.equal(concept.promise_virality, false);
  assert.equal(concept.status, 'evidence_backed');

  assert.equal(validateVariant({
    dimension_changed:'hook',
    hypothesis:'A proof-first hook will increase qualified replies',
    expected_signal:'qualified_whatsapp_rate'
  }).valid, true);

  assert.equal(validateVariant({
    dimension_changed:'synonym',
    hypothesis:'same idea with different words',
    expected_signal:'views'
  }).valid, false);

  console.log('Marketing C03 creative simulation: PASS');
}

if (require.main === module) run();
module.exports = { buildCreativeConcept, validateVariant };
