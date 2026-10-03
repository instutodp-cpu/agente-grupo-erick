const test=require('node:test');
const assert=require('node:assert/strict');
const {buildContentPackage}=require('../scripts/marketing-content-production-sim');

test('missing commercial facts are preserved and never invented',()=>{
  const p=buildContentPackage({format:'reel',commercial_objective:'qualified WhatsApp conversations',price:null,discount:null,stock:null});
  assert.deepEqual(p.required_facts_missing,['price','discount','stock']);
  assert.equal(p.may_invent_missing_facts,false);
});

test('reel has separate production layers',()=>{
  const p=buildContentPackage({format:'reel',commercial_objective:'sales conversations'});
  const roles=p.blocks.map(x=>x.role);
  assert.ok(roles.includes('spoken_line'));
  assert.ok(roles.includes('on_screen_text'));
  assert.ok(roles.includes('visual_direction'));
});

test('story is sequenced by frames',()=>{
  const p=buildContentPackage({format:'story',commercial_objective:'sales conversations'});
  assert.equal(p.blocks.filter(x=>x.role==='story_frame').length,3);
});

test('carousel is sequenced by slides',()=>{
  const p=buildContentPackage({format:'carousel',commercial_objective:'product education'});
  assert.equal(p.blocks.filter(x=>x.role==='carousel_slide').length,4);
});
