const test=require('node:test');
const assert=require('node:assert/strict');
const {validateCaptionTiming,geometryAtFrame,frameQA}=require('../scripts/marketing-video-frame-qa-sim');

const canvas={width:1080,height:1920,safe_zone:{top:180,right:120,bottom:300,left:120},reserved_regions:[{id:'bottom-ui',x:0,y:1650,width:1080,height:270}]};

test('caption inside composition duration passes',()=>{
 const r=validateCaptionTiming({start_ms:1000,end_ms:2500},30,300);assert.equal(r.valid,true);
});

test('caption extending beyond composition is rejected, not truncated',()=>{
 const r=validateCaptionTiming({start_ms:9500,end_ms:11000},30,300);assert.equal(r.valid,false);assert.ok(r.issues.includes('caption_after_composition_end'));
});

test('invalid caption interval is rejected',()=>{
 const r=validateCaptionTiming({start_ms:2000,end_ms:1000},30,300);assert.equal(r.valid,false);assert.ok(r.issues.includes('invalid_caption_interval'));
});

test('motion interpolation changes geometry over frames',()=>{
 const el={width:100,height:50,motion:{from:{x:200,y:300},to:{x:400,y:300},start_frame:0,end_frame:10}};
 assert.equal(geometryAtFrame(el,0).x,200);assert.equal(geometryAtFrame(el,10).x,400);
});

test('moving CTA that exits safe zone is blocked on offending frame',()=>{
 const el={id:'cta',kind:'cta',x:200,y:1200,width:500,height:100,start_frame:0,end_frame:10,motion:{from:{x:200,y:1200},to:{x:20,y:1200},start_frame:0,end_frame:9}};
 const r=frameQA(canvas,[el],10);assert.equal(r.decision,'block');assert.ok(r.sampled_frames.some(f=>f.blocking_reasons.includes('cta:outside_safe_zone')));
});

test('static safe caption passes every active frame',()=>{
 const el={id:'cap',kind:'caption',x:180,y:1200,width:650,height:150,start_frame:0,end_frame:10};
 assert.equal(frameQA(canvas,[el],10).decision,'pass');
});
