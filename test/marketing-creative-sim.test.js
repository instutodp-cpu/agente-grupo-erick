const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCreativeConcept, validateVariant } = require('../scripts/marketing-creative-sim');

test('creative concept preserves unknown commercial facts', () => {
  const c = buildCreativeConcept({ commercial_objective:'sales conversations', price:null, stock:null, margin:null, evidence_refs:['e1'] });
  assert.deepEqual(c.unknowns, ['price','stock','margin']);
  assert.equal(c.may_invent_offer_fact, false);
});

test('creative concept never promises virality', () => {
  const c = buildCreativeConcept({ commercial_objective:'qualified leads', evidence_refs:[] });
  assert.equal(c.promise_virality, false);
  assert.equal(c.status, 'hypothesis');
});

test('variant requires meaningful test dimension', () => {
  assert.equal(validateVariant({ dimension_changed:'synonym', hypothesis:'x', expected_signal:'y' }).valid, false);
  assert.equal(validateVariant({ dimension_changed:'cta', hypothesis:'x', expected_signal:'qualified_whatsapp_rate' }).valid, true);
});

test('variant requires hypothesis and expected signal', () => {
  assert.equal(validateVariant({ dimension_changed:'hook', expected_signal:'x' }).valid, false);
  assert.equal(validateVariant({ dimension_changed:'hook', hypothesis:'x' }).valid, false);
});
