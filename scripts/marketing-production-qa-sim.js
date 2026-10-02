const assert=require('node:assert/strict');

function unsupportedClaims(text,known={}){
  const t=(text||'').toLowerCase(), issues=[];
  if((t.includes('últimas unidades')||t.includes('ultimas unidades'))&&known.stock==null) issues.push('unsupported_scarcity');
  if(/\d+\s*%/.test(t)&&known.discount==null) issues.push('unsupported_discount');
  if((t.includes('mais vendido')||t.includes('best seller'))&&!known.best_seller_evidence) issues.push('unsupported_best_seller');
  return issues;
}

function productionQA(pkg,known={}){
  const text=[pkg.primary_text,pkg.headline,pkg.message,...(pkg.blocks||[]).map(b=>b.content)].filter(Boolean).join(' ');
  const claims=unsupportedClaims(text,known);
  const blockers=[...claims];
  if(!pkg.cta) blockers.push('missing_cta');
  if(!pkg.commercial_objective&&!pkg.objective&&!pkg.job) blockers.push('missing_commercial_job');
  return {
    blocking_reasons:blockers,
    decision:blockers.length?'block':'pass',
    may_render:blockers.length===0
  };
}

function buildWhatsAppAsset(input){
  return {
    job:input.job,
    product_context:input.product||null,
    message:input.message||'DRAFT_CONVERSATION_MESSAGE',
    cta:input.cta||'Continue a conversa com nosso atendimento',
    status:'draft',
    sends_automatically:false,
    treats_lead_as_customer:false
  };
}

function buildAdCreative(input){
  return {
    objective:input.objective,
    primary_text:input.primary_text||'DRAFT_PRIMARY_TEXT',
    headline:input.headline||'DRAFT_HEADLINE',
    cta:input.cta||'Saiba mais',
    status:'draft',
    mutates_ads:false
  };
}

function run(){
  const qa=productionQA({commercial_objective:'qualified conversations',cta:'Fale no WhatsApp',primary_text:'Últimas unidades com 30% OFF'},{stock:null,discount:null});
  assert.equal(qa.decision,'block');
  assert.equal(qa.may_render,false);
  assert.deepEqual(qa.blocking_reasons,['unsupported_scarcity','unsupported_discount']);

  const wa=buildWhatsAppAsset({job:'product_followup',product:'shoe'});
  assert.equal(wa.status,'draft');
  assert.equal(wa.sends_automatically,false);
  assert.equal(wa.treats_lead_as_customer,false);

  const ad=buildAdCreative({objective:'qualified conversations'});
  assert.equal(ad.mutates_ads,false);
  console.log('Marketing C04 ad/WhatsApp/QA simulation: PASS');
}
if(require.main===module)run();
module.exports={unsupportedClaims,productionQA,buildWhatsAppAsset,buildAdCreative};
