const assert = require('node:assert/strict');

function missingCommercialFacts(input) {
  return ['price','discount','stock'].filter(k => input[k] == null);
}

function buildContentPackage(input) {
  if (!input.format || !input.commercial_objective) throw new Error('format_and_objective_required');
  const missing = missingCommercialFacts(input);
  const common = {
    format: input.format,
    commercial_objective: input.commercial_objective,
    required_facts_missing: missing,
    may_invent_missing_facts: false,
    cta: input.cta || 'Converse com nosso atendimento no WhatsApp'
  };
  if (input.format === 'reel') return {...common, blocks:[
    {role:'hook',content:'HOOK_FROM_APPROVED_CONCEPT'},
    {role:'visual_direction',content:'Show product in use and relevant details'},
    {role:'spoken_line',content:'SCRIPT_FROM_VERIFIED_BENEFITS'},
    {role:'on_screen_text',content:'SHORT_VERIFIED_MESSAGE'},
    {role:'cta',content:common.cta}
  ]};
  if (input.format === 'story') return {...common, blocks:[
    {role:'story_frame',content:'Frame 1: attention/problem'},
    {role:'story_frame',content:'Frame 2: product/proof'},
    {role:'story_frame',content:'Frame 3: conversation CTA'}
  ]};
  if (input.format === 'carousel') return {...common, blocks:[
    {role:'carousel_slide',content:'Slide 1: hook'},
    {role:'carousel_slide',content:'Slide 2: verified value'},
    {role:'carousel_slide',content:'Slide 3: proof/detail'},
    {role:'carousel_slide',content:'Slide 4: CTA'}
  ]};
  return {...common, blocks:[{role:'body_copy',content:'FORMAT_SPECIFIC_DRAFT'},{role:'cta',content:common.cta}]};
}

function run() {
  const reel=buildContentPackage({format:'reel',commercial_objective:'qualified WhatsApp conversations',price:null,discount:null,stock:null});
  assert.deepEqual(reel.required_facts_missing,['price','discount','stock']);
  assert.equal(reel.may_invent_missing_facts,false);
  assert.ok(reel.blocks.some(b=>b.role==='spoken_line'));
  assert.ok(reel.blocks.some(b=>b.role==='on_screen_text'));
  assert.ok(reel.blocks.some(b=>b.role==='visual_direction'));

  const story=buildContentPackage({format:'story',commercial_objective:'qualified WhatsApp conversations'});
  assert.equal(story.blocks.filter(b=>b.role==='story_frame').length,3);

  const carousel=buildContentPackage({format:'carousel',commercial_objective:'explain product value'});
  assert.equal(carousel.blocks.filter(b=>b.role==='carousel_slide').length,4);

  console.log('Marketing C04 content production simulation: PASS');
}
if(require.main===module) run();
module.exports={missingCommercialFacts,buildContentPackage};
