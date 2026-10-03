const test=require('node:test');
const assert=require('node:assert/strict');
const {fitText,validateBrandElement,adapterHandoff}=require('../scripts/marketing-brand-render-sim');

const brand={logos:[{asset_ref:'approved-logo'}],typography:{families:['Brand Sans']},colors:['#112233']};

test('text may shrink only within declared minimum',()=>{
 const r=fitText({text:'A'.repeat(90),boxWidth:700,maxLines:2,fontSizePx:64,minFontPx:32});
 assert.ok(r.font_size_px>=32);
});

test('overflow beyond minimum font requires rewrite instead of clipping',()=>{
 const r=fitText({text:'A'.repeat(400),boxWidth:700,maxLines:2,fontSizePx:64,minFontPx:32});
 assert.equal(r.fit_status,'blocked_min_font'); assert.equal(r.font_size_px,32); assert.equal(r.resolution,'rewrite_copy');
});

test('unapproved brand assets are rejected',()=>{
 assert.equal(validateBrandElement({kind:'logo',asset_ref:'invented-logo'},brand).valid,false);
 assert.equal(validateBrandElement({kind:'text',font_family:'Random Font'},brand).valid,false);
 assert.equal(validateBrandElement({kind:'text',color:'#FFFFFF'},brand).valid,false);
});

test('approved brand references pass',()=>{
 assert.equal(validateBrandElement({kind:'logo',asset_ref:'approved-logo'},brand).valid,true);
 assert.equal(validateBrandElement({kind:'text',font_family:'Brand Sans',color:'#112233'},brand).valid,true);
});

test('Canva and Remotion handoffs lock geometry/brand and never publish',()=>{
 const base={renderId:'r1',canvasProfileId:'reel',elements:[{id:'t1'}],brandProfileRef:'b1',layoutPass:true,brandPass:true,textFits:true};
 for(const adapter of ['canva','remotion']){const r=adapterHandoff({...base,adapter});assert.equal(r.status,'ready_for_external_render');assert.equal(r.geometry_locked,true);assert.equal(r.brand_locked,true);assert.equal(r.publish,false);}
});

test('failed text fit blocks adapter handoff',()=>{
 const r=adapterHandoff({adapter:'remotion',renderId:'r1',canvasProfileId:'reel',elements:[{id:'t1'}],brandProfileRef:'b1',layoutPass:true,brandPass:true,textFits:false});
 assert.equal(r.status,'blocked'); assert.deepEqual(r.elements,[]);
});
