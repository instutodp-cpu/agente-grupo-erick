const assert=require('node:assert/strict');

function estimateLines(text,boxWidth,fontPx){
  const avgCharWidth=fontPx*0.55;
  const charsPerLine=Math.max(1,Math.floor(boxWidth/avgCharWidth));
  return Math.max(1,Math.ceil(String(text||'').length/charsPerLine));
}

function fitText({text,boxWidth,maxLines,fontSizePx,minFontPx,step=2}){
  let size=fontSizePx;
  while(size>=minFontPx){
    const lines=estimateLines(text,boxWidth,size);
    if(lines<=maxLines)return {fit_status:'fits',font_size_px:size,estimated_lines:lines,resolution:size===fontSizePx?'none':'reduce_font_within_limits'};
    size-=step;
  }
  const lines=estimateLines(text,boxWidth,minFontPx);
  return {fit_status:'blocked_min_font',font_size_px:minFontPx,estimated_lines:lines,resolution:'rewrite_copy'};
}

function validateBrandElement(el,brand){
  const issues=[];
  if(el.kind==='logo'&&!brand.logos.some(l=>l.asset_ref===el.asset_ref))issues.push('unapproved_logo');
  if(el.font_family&&!brand.typography.families.includes(el.font_family))issues.push('unapproved_font');
  if(el.color&&!brand.colors.includes(el.color))issues.push('unapproved_color');
  return {valid:issues.length===0,issues};
}

function adapterHandoff({adapter,renderId,canvasProfileId,elements,brandProfileRef,layoutPass,brandPass,textFits}){
  const ready=layoutPass&&brandPass&&textFits;
  return {adapter,render_id:renderId,canvas_profile_id:canvasProfileId,geometry_locked:true,brand_locked:true,publish:false,elements:ready?elements:[],brand_profile_ref:brandProfileRef,status:ready?'ready_for_external_render':'blocked'};
}

function run(){
 const short=fitText({text:'Oferta para você',boxWidth:700,maxLines:2,fontSizePx:64,minFontPx:32});
 assert.equal(short.fit_status,'fits');
 const long=fitText({text:'X'.repeat(400),boxWidth:700,maxLines:2,fontSizePx:64,minFontPx:32});
 assert.equal(long.fit_status,'blocked_min_font'); assert.equal(long.font_size_px,32); assert.equal(long.resolution,'rewrite_copy');
 const brand={logos:[{asset_ref:'logo-approved'}],typography:{families:['Brand Sans']},colors:['#112233']};
 assert.equal(validateBrandElement({kind:'logo',asset_ref:'fake-logo'},brand).valid,false);
 const base={renderId:'r1',canvasProfileId:'reel-1080x1920',elements:[],brandProfileRef:'brand-1',layoutPass:true,brandPass:true,textFits:true};
 const c=adapterHandoff({...base,adapter:'canva'}),r=adapterHandoff({...base,adapter:'remotion'});
 assert.equal(c.geometry_locked,true);assert.equal(r.brand_locked,true);assert.equal(c.publish,false);assert.equal(r.publish,false);
 console.log('Marketing C05 brand/text-fit/adapter simulation: PASS');
}
if(require.main===module)run();
module.exports={estimateLines,fitText,validateBrandElement,adapterHandoff};
