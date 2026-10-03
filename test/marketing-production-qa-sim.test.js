const test=require('node:test');
const assert=require('node:assert/strict');
const {productionQA,buildWhatsAppAsset,buildAdCreative}=require('../scripts/marketing-production-qa-sim');

test('QA blocks unsupported scarcity and discount before rendering',()=>{
 const r=productionQA({commercial_objective:'sales conversations',cta:'WhatsApp',primary_text:'Últimas unidades, 30% OFF'},{stock:null,discount:null});
 assert.equal(r.decision,'block'); assert.equal(r.may_render,false);
 assert.deepEqual(r.blocking_reasons,['unsupported_scarcity','unsupported_discount']);
});

test('QA passes supported basic package',()=>{
 const r=productionQA({commercial_objective:'sales conversations',cta:'WhatsApp',primary_text:'Veja os detalhes do produto'},{});
 assert.equal(r.decision,'pass'); assert.equal(r.may_render,true);
});

test('WhatsApp asset remains draft and never sends automatically',()=>{
 const a=buildWhatsAppAsset({job:'product_followup',product:'shoe'});
 assert.equal(a.status,'draft'); assert.equal(a.sends_automatically,false); assert.equal(a.treats_lead_as_customer,false);
});

test('ad creative package cannot mutate ads',()=>{
 const a=buildAdCreative({objective:'qualified conversations'});
 assert.equal(a.status,'draft'); assert.equal(a.mutates_ads,false);
});
