const test = require('node:test');
const assert = require('node:assert/strict');
const { selectFormat, scoreCreative, validateHookFacts } = require('../scripts/marketing-creative-engine-sim');

test('format selection starts from commercial goal', () => {
  const d = selectFormat({ commercial_goal:'increase qualified WhatsApp conversations', available_assets:['product_video'] });
  assert.equal(d.selected_format,'reel');
  assert.equal(d.outcome_prediction,false);
  assert.ok(d.rationale.some(x => x.includes('WhatsApp')));
});

test('creative score is decision support, never virality prediction', () => {
  const s = scoreCreative({ commercial_alignment:1,evidence_grounding:1,hook_clarity:1,cta_alignment:1,brand_fit:1,testability:1 });
  assert.equal(s.total,1);
  assert.equal(s.predicts_virality,false);
  assert.equal(s.prediction_mode,'decision_support_not_outcome_prediction');
});

test('creative score rejects invalid dimensions', () => {
  assert.throws(() => scoreCreative({ commercial_alignment:2,evidence_grounding:1,hook_clarity:1,cta_alignment:1,brand_fit:1,testability:1 }), /invalid_dimension/);
});

test('hook cannot fabricate scarcity discount or best seller status', () => {
  const r = validateHookFacts('Últimas unidades, 30% OFF, nosso mais vendido!', { stock:null, discount:null, best_seller_evidence:false });
  assert.equal(r.valid,false);
  assert.deepEqual(r.unsupported_claims,['scarcity','discount','best_seller']);
});
