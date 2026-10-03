const assert=require('node:assert/strict');

function rectRight(r){return r.x+r.width}
function rectBottom(r){return r.y+r.height}
function overlaps(a,b){return a.x<rectRight(b)&&rectRight(a)>b.x&&a.y<rectBottom(b)&&rectBottom(a)>b.y}

function inspectElement(canvas,el){
  const insideCanvas=el.x>=0&&el.y>=0&&rectRight(el)<=canvas.width&&rectBottom(el)<=canvas.height;
  const s=canvas.safe_zone;
  const safe={x:s.left,y:s.top,width:canvas.width-s.left-s.right,height:canvas.height-s.top-s.bottom};
  const critical=['text','caption','logo','cta'].includes(el.kind);
  const insideSafe=!critical||(el.x>=safe.x&&el.y>=safe.y&&rectRight(el)<=rectRight(safe)&&rectBottom(el)<=rectBottom(safe));
  const reserved=(canvas.reserved_regions||[]).filter(r=>overlaps(el,r)).map(r=>r.id);
  const reasons=[];
  if(!insideCanvas)reasons.push('outside_canvas');
  if(!insideSafe)reasons.push('outside_safe_zone');
  if(critical&&reserved.length)reasons.push('overlaps_reserved_region');
  return {element_id:el.id,inside_canvas:insideCanvas,inside_safe_zone:insideSafe,overlaps_reserved_region:reserved.length>0,reserved_regions:reserved,blocking_reasons:reasons};
}

function layoutQA(canvas,elements){
  const element_results=elements.map(e=>inspectElement(canvas,e));
  const blocking_reasons=[...new Set(element_results.flatMap(r=>r.blocking_reasons))];
  return {element_results,decision:blocking_reasons.length?'block':'pass',blocking_reasons};
}

function buildAdapterHandoff(spec,qa,target){
  if(qa.decision!=='pass')return {target,status:'blocked_layout',publish:false,geometry:null};
  if((spec.missing_brand_requirements||[]).length)return {target,status:'blocked_brand',publish:false,geometry:null};
  return {target,status:'ready_for_render',publish:false,geometry:spec.elements.map(({id,kind,x,y,width,height})=>({id,kind,x,y,width,height}))};
}

function run(){
 const canvas={width:1080,height:1920,safe_zone:{top:180,right:120,bottom:300,left:120},reserved_regions:[]};
 const bad={id:'hook',kind:'text',x:40,y:200,width:800,height:160};
 assert.equal(layoutQA(canvas,[bad]).decision,'block');
 const good={id:'hook',kind:'text',x:140,y:220,width:700,height:160};
 const qa=layoutQA(canvas,[good]); assert.equal(qa.decision,'pass');
 const spec={elements:[good],missing_brand_requirements:[]};
 assert.deepEqual(buildAdapterHandoff(spec,qa,'canva').geometry,buildAdapterHandoff(spec,qa,'remotion').geometry);
 assert.equal(buildAdapterHandoff(spec,qa,'canva').publish,false);
 console.log('Marketing C05 rendering/brand-safety simulation: PASS');
}
if(require.main===module)run();
module.exports={inspectElement,layoutQA,buildAdapterHandoff};
