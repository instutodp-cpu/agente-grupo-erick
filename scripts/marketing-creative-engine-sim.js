const assert = require('node:assert/strict');

const WEIGHTS = {
  commercial_alignment: 0.25,
  evidence_grounding: 0.20,
  hook_clarity: 0.15,
  cta_alignment: 0.15,
  brand_fit: 0.10,
  testability: 0.15
};

function selectFormat(input) {
  if (!input.commercial_goal) throw new Error('commercial_goal_required');
  const goal = input.commercial_goal.toLowerCase();
  const assets = new Set(input.available_assets || []);
  let selected = 'carousel';
  const rationale = [];
  if (goal.includes('whatsapp') && assets.has('product_video')) {
    selected = 'reel';
    rationale.push('product video can demonstrate value before a conversation CTA');
    rationale.push('CTA can explicitly route qualified interest to WhatsApp');
  } else if (goal.includes('whatsapp')) {
    selected = 'story';
    rationale.push('direct-response structure can reduce distance to conversation');
  } else if (goal.includes('explain') || goal.includes('educat')) {
    selected = 'carousel';
    rationale.push('multi-step structure supports explanation');
  } else {
    rationale.push('format remains a test hypothesis because evidence is insufficient for a stronger selection');
  }
  return {
    selected_format: selected,
    rationale,
    alternatives: [{ format: selected === 'reel' ? 'story' : 'reel', reason_not_primary:'retain as controlled alternative for testing' }],
    outcome_prediction: false
  };
}

function scoreCreative(dimensions) {
  for (const key of Object.keys(WEIGHTS)) {
    const v = dimensions[key];
    if (typeof v !== 'number' || v < 0 || v > 1) throw new Error('invalid_dimension:' + key);
  }
  const total = Object.entries(WEIGHTS).reduce((sum,[k,w]) => sum + dimensions[k] * w, 0);
  return {
    total: Number(total.toFixed(4)),
    prediction_mode:'decision_support_not_outcome_prediction',
    predicts_virality:false
  };
}

function validateHookFacts(hook, known) {
  const unsupported = [];
  const text = hook.toLowerCase();
  if ((text.includes('últimas unidades') || text.includes('ultimas unidades')) && known.stock == null) unsupported.push('scarcity');
  if (/%/.test(text) && known.discount == null) unsupported.push('discount');
  if ((text.includes('mais vendido') || text.includes('best seller')) && !known.best_seller_evidence) unsupported.push('best_seller');
  return { valid: unsupported.length === 0, unsupported_claims: unsupported };
}

function run() {
  const d = selectFormat({
    commercial_goal:'increase qualified WhatsApp conversations',
    available_assets:['product_video','product_photos']
  });
  assert.equal(d.selected_format,'reel');
  assert.equal(d.outcome_prediction,false);

  const s = scoreCreative({
    commercial_alignment:1, evidence_grounding:.8, hook_clarity:.8,
    cta_alignment:1, brand_fit:.9, testability:1
  });
  assert.equal(s.predicts_virality,false);
  assert.equal(s.prediction_mode,'decision_support_not_outcome_prediction');

  assert.equal(validateHookFacts('Últimas unidades com 30% OFF', { stock:null, discount:null }).valid,false);
  console.log('Marketing C03 hook/format/scoring simulation: PASS');
}
if (require.main === module) run();
module.exports = { selectFormat, scoreCreative, validateHookFacts };
