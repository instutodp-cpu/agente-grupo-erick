const assert = require('node:assert/strict');

function changedDimensions(a, b) {
  const keys = ['hook','format','proof','offer_framing','cta','pacing','visual_structure','audience_angle'];
  return keys.filter(k => a[k] !== b[k] && (a[k] !== undefined || b[k] !== undefined));
}

function assessExperimentDesign(a, b) {
  const changed = changedDimensions(a,b);
  return {
    changed_dimensions: changed,
    confounded: changed.length !== 1,
    causal_dimension: changed.length === 1 ? changed[0] : null
  };
}

function classifyLearning({ repetitions, independent_confirmations = 0, confounded = false }) {
  if (confounded) return { conclusion_level:'inconclusive', learning_eligible:false };
  if (repetitions < 2) return { conclusion_level:'observation', learning_eligible:false };
  if (independent_confirmations < 2) return { conclusion_level:'hypothesis_supported', learning_eligible:false };
  return { conclusion_level:'tested_insight_candidate', learning_eligible:true };
}

function validatePrimaryMetric(metric, commercialObjective) {
  const vanityOnly = new Set(['views','impressions','likes']);
  if (!commercialObjective) return { valid:false, reason:'commercial_objective_required' };
  if (vanityOnly.has(metric)) return { valid:false, reason:'vanity_metric_cannot_be_sole_primary_metric' };
  return { valid:true };
}

function run() {
  const design = assessExperimentDesign(
    { hook:'A', format:'reel', cta:'WhatsApp' },
    { hook:'B', format:'carousel', cta:'store visit' }
  );
  assert.equal(design.confounded,true);
  assert.equal(design.causal_dimension,null);

  assert.deepEqual(classifyLearning({ repetitions:1, independent_confirmations:1 }), {
    conclusion_level:'observation', learning_eligible:false
  });
  assert.equal(classifyLearning({ repetitions:3, independent_confirmations:2 }).learning_eligible,true);
  assert.equal(validatePrimaryMetric('views','qualified WhatsApp conversations').valid,false);
  assert.equal(validatePrimaryMetric('qualified_whatsapp_rate','qualified WhatsApp conversations').valid,true);

  console.log('Marketing C03 experiment simulation: PASS');
}

if (require.main === module) run();
module.exports = { changedDimensions, assessExperimentDesign, classifyLearning, validatePrimaryMetric };
