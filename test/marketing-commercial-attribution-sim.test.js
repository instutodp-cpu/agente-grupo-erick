const test=require('node:test');
const assert=require('node:assert/strict');
const {classifyAttribution,commercialMetrics}=require('../scripts/marketing-commercial-attribution-sim');
const sale=(o={})=>({sale_id:'s1',customer_id:null,journey_id:null,coupon_id:null,occurred_at:'2030-01-02T10:00:00Z',gross_revenue:200,discount:20,net_revenue:180,cogs:null,gross_margin:null,evidence_ref:'linx:s1',...o});
const tp=(o={})=>({touchpoint_id:'t1',journey_id:'j1',customer_id:null,channel:'instagram',event_type:'view',coupon_id:null,occurred_at:'2030-01-02T09:00:00Z',evidence_ref:'ig:t1',...o});

test('matching unique coupon produces direct attribution',()=>assert.equal(classifyAttribution(sale({coupon_id:'C1'}),[tp({coupon_id:'C1',event_type:'coupon_presented'})]).classification,'direct_attributed'));
test('identified WhatsApp journey can produce direct attribution',()=>assert.equal(classifyAttribution(sale({journey_id:'j1'}),[tp({event_type:'whatsapp_contact',channel:'whatsapp'})]).classification,'direct_attributed'));
test('same customer weak touch is assisted not direct',()=>assert.equal(classifyAttribution(sale({customer_id:'c1'}),[tp({customer_id:'c1',event_type:'view'})]).classification,'assisted'));
test('temporal proximity without identity is correlated only',()=>{const r=classifyAttribution(sale(),[tp()]);assert.equal(r.classification,'correlated');assert.equal(r.direct_linkage,false);});
test('no touchpoint is unattributed',()=>assert.equal(classifyAttribution(sale(),[]).classification,'unattributed'));
test('missing COGS and margin stay unknown',()=>{const m=commercialMetrics(sale());assert.equal(m.gross_margin,null);assert.equal(m.margin_known,false);});
test('margin may be deterministically derived when COGS is observed',()=>{const m=commercialMetrics(sale({cogs:100}));assert.equal(m.gross_margin,80);assert.equal(m.margin_known,true);});
test('observed gross margin is preserved',()=>assert.equal(commercialMetrics(sale({gross_margin:75})).gross_margin,75));
