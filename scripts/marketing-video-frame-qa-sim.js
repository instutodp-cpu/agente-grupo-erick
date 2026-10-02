const assert=require('node:assert/strict');

function msToFrame(ms,fps){return Math.floor((ms/1000)*fps)}
function validateCaptionTiming(caption,fps,durationFrames){
 const start=msToFrame(caption.start_ms,fps),end=Math.ceil((caption.end_ms/1000)*fps),issues=[];
 if(caption.end_ms<=caption.start_ms)issues.push('invalid_caption_interval');
 if(start<0)issues.push('caption_before_start');
 if(end>durationFrames)issues.push('caption_after_composition_end');
 return {valid:issues.length===0,start_frame:start,end_frame:end,issues};
}
function right(r){return r.x+r.width} function bottom(r){return r.y+r.height}
function overlaps(a,b){return a.x<right(b)&&right(a)>b.x&&a.y<bottom(b)&&bottom(a)>b.y}
function geometryAtFrame(el,frame){
 if(!el.motion)return {x:el.x,y:el.y,width:el.width,height:el.height};
 const {from,to,start_frame,end_frame}=el.motion;
 const span=Math.max(1,end_frame-start_frame),t=Math.max(0,Math.min(1,(frame-start_frame)/span));
 return {x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t,width:el.width,height:el.height};
}
function inspectFrame(canvas,elements,frame){
 const active=elements.filter(e=>frame>=e.start_frame&&frame<e.end_frame),blocking=[];
 for(const el of active){
   if(!['text','caption','logo','cta'].includes(el.kind))continue;
   const g=geometryAtFrame(el,frame),s=canvas.safe_zone;
   const safe={x:s.left,y:s.top,width:canvas.width-s.left-s.right,height:canvas.height-s.top-s.bottom};
   if(g.x<safe.x||g.y<safe.y||right(g)>right(safe)||bottom(g)>bottom(safe))blocking.push(el.id+':outside_safe_zone');
   if((canvas.reserved_regions||[]).some(r=>overlaps(g,r)))blocking.push(el.id+':reserved_region');
 }
 return {frame,active_elements:active.map(e=>e.id),blocking_reasons:blocking};
}
function frameQA(canvas,elements,durationFrames){
 const frames=[];
 for(let f=0;f<durationFrames;f++)frames.push(inspectFrame(canvas,elements,f));
 const bad=frames.filter(x=>x.blocking_reasons.length);
 return {decision:bad.length?'block':'pass',sampled_frames:frames,blocking_reasons:bad.flatMap(x=>x.blocking_reasons)};
}
function run(){
 const c=validateCaptionTiming({start_ms:9500,end_ms:11000},30,300);assert.equal(c.valid,false);assert.ok(c.issues.includes('caption_after_composition_end'));
 const canvas={width:1080,height:1920,safe_zone:{top:180,right:120,bottom:300,left:120},reserved_regions:[]};
 const moving={id:'cta',kind:'cta',x:200,y:1200,width:500,height:100,start_frame:0,end_frame:10,motion:{from:{x:200,y:1200},to:{x:20,y:1200},start_frame:0,end_frame:9}};
 const qa=frameQA(canvas,[moving],10);assert.equal(qa.decision,'block');assert.ok(qa.sampled_frames.some(f=>f.blocking_reasons.length));
 console.log('Marketing C05 temporal/frame QA simulation: PASS');
}
if(require.main===module)run();
module.exports={msToFrame,validateCaptionTiming,geometryAtFrame,inspectFrame,frameQA};
