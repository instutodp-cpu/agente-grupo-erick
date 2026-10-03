const test=require('node:test');
const assert=require('node:assert/strict');
const {inspectElement,layoutQA,buildAdapterHandoff}=require('../scripts/marketing-render-safety-sim');

const canvas={width:1080,height:1920,safe_zone:{top:180,right:120,bottom:300,left:120},reserved_regions:[{id:'platform-bottom-ui',x:0,y:1650,width:1080,height:270}]};

test('critical text crossing safe-zone is blocked',()=>{
 const r=inspectElement(canvas,{id:'hook',kind:'text',x:40,y:200,width:800,height:160});
 assert.equal(r.inside_canvas,true); assert.equal(r.inside_safe_zone,false); assert.ok(r.blocking_reasons.includes('outside_safe_zone'));
});

test('critical CTA overlapping reserved platform UI is blocked',()=>{
 const r=inspectElement(canvas,{id:'cta',kind:'cta',x:200,y:1660,width:500,height:100});
 assert.equal(r.overlaps_reserved_region,true); assert.ok(r.blocking_reasons.includes('overlaps_reserved_region'));
});

test('safe critical element passes geometry QA',()=>{
 const r=layoutQA(canvas,[{id:'caption',kind:'caption',x:160,y:1200,width:700,height:180}]);
 assert.equal(r.decision,'pass');
});

test('Canva and Remotion handoffs preserve identical geometry',()=>{
 const el={id:'logo',kind:'logo',x:140,y:220,width:180,height:90};
 const qa=layoutQA(canvas,[el]); const spec={elements:[el],missing_brand_requirements:[]};
 assert.deepEqual(buildAdapterHandoff(spec,qa,'canva').geometry,buildAdapterHandoff(spec,qa,'remotion').geometry);
});

test('missing brand requirement blocks renderer handoff',()=>{
 const el={id:'logo',kind:'logo',x:140,y:220,width:180,height:90};
 const qa=layoutQA(canvas,[el]); const r=buildAdapterHandoff({elements:[el],missing_brand_requirements:['approved_logo_asset']},qa,'remotion');
 assert.equal(r.status,'blocked_brand'); assert.equal(r.publish,false);
});
