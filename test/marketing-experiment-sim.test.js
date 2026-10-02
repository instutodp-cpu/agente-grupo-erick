const test = require('node:test');
const assert = require('node:assert/strict');
const { assessExperimentDesign, classifyLearning, validatePrimaryMetric } = require('../scripts/marketing-experiment-sim');

test('multiple changed dimensions are confounded', () => {
  const r = assessExperimentDesign(
    { hook:'A', format:'reel', cta:'WhatsApp' },
    { hook:'B', format:'carousel', cta:'store visit' }
  );
  assert.equal(r.confounded,true);
  assert.equal(r.causal_dimension,null);
});

test('single changed dimension remains attributable within experiment', () => {
  const r = assessExperimentDesign(
    { hook:'A', format:'reel', cta:'WhatsApp' },
    { hook:'B', format:'reel', cta:'WhatsApp' }
  );
  assert.equal(r.confounded,false);
  assert.equal(r.causal_dimension,'hook');
});

test('one result cannot become learned rule', () => {
  const r = classifyLearning({ repetitions:1, independent_confirmations:1 });
  assert.equal(r.learning_eligible,false);
  assert.equal(r.conclusion_level,'observation');
});

test('repeated independent evidence may become tested insight candidate', () => {
  const r = classifyLearning({ repetitions:3, independent_confirmations:2 });
  assert.equal(r.learning_eligible,true);
  assert.equal(r.conclusion_level,'tested_insight_candidate');
});

test('views cannot be sole primary metric for commercial experiment', () => {
  assert.equal(validatePrimaryMetric('views','qualified WhatsApp conversations').valid,false);
  assert.equal(validatePrimaryMetric('qualified_whatsapp_rate','qualified WhatsApp conversations').valid,true);
});
