const assert=require('node:assert/strict');

function directLinks(sale,touchpoints){
 return touchpoints.filter(t=>
   (sale.coupon_id&&t.coupon_id===sale.coupon_id) ||
   (sale.customer_id&&t.customer_id===sale.customer_id&&['whatsapp_contact','product_interest','coupon_presented'].includes(t.event_type)) ||
   (sale.journey_id&&t.journey_id===sale.journey_id&&['whatsapp_contact','product_interest','coupon_presented'].includes(t.event_type))
 );
}
function classifyAttribution(sale,touchpoints){
 const direct=directLinks(sale,touchpoints);
 if(direct.length)return result(sale,'direct_attributed',true,direct,[]);
 const assisted=touchpoints.filter(t=>sale.customer_id&&t.customer_id===sale.customer_id);
 if(assisted.length)return result(sale,'assisted',false,assisted,['customer-linked marketing touchpoint exists but no qualifying direct conversion linkage']);
 const temporal=touchpoints.filter(t=>Date.parse(t.occurred_at)<=Date.parse(sale.occurred_at));
 if(temporal.length)return result(sale,'correlated',false,temporal,['temporal proximity is not causal attribution']);
 return result(sale,'unattributed',false,[],['no verifiable marketing linkage']);
}
function result(sale,classification,direct,links,limitations){return {sale_id:sale.sale_id,classification,direct_linkage:direct,linked_touchpoint_ids:links.map(x=>x.touchpoint_id),evidence_refs:[sale.evidence_ref,...links.map(x=>x.evidence_ref)].filter(Boolean),limitations}}
function commercialMetrics(sale){
 const gross_margin=sale.gross_margin!=null?sale.gross_margin:(sale.cogs!=null?sale.net_revenue-sale.cogs:null);
 return {gross_revenue:sale.gross_revenue,discount:sale.discount,net_revenue:sale.net_revenue,cogs:sale.cogs??null,gross_margin,margin_known:gross_margin!=null};
}
function run(){
 const sale={sale_id:'s1',customer_id:null,journey_id:null,coupon_id:'INF-CAROL',occurred_at:'2030-01-02T10:00:00Z',gross_revenue:200,discount:20,net_revenue:180,cogs:null,gross_margin:null,evidence_ref:'linx:s1'};
 const tp={touchpoint_id:'t1',journey_id:'j1',customer_id:null,channel:'influencer',event_type:'coupon_presented',coupon_id:'INF-CAROL',occurred_at:'2030-01-02T09:00:00Z',evidence_ref:'coupon:t1'};
 assert.equal(classifyAttribution(sale,[tp]).classification,'direct_attributed');
 assert.equal(commercialMetrics(sale).gross_margin,null);
 const noLink={...tp,touchpoint_id:'t2',coupon_id:null};assert.equal(classifyAttribution({...sale,coupon_id:null},[noLink]).classification,'correlated');
 console.log('Marketing C07 commercial attribution simulation: PASS');
}
if(require.main===module)run();
module.exports={directLinks,classifyAttribution,commercialMetrics};
