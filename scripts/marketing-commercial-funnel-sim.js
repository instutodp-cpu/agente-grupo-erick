const assert=require('node:assert/strict');
const EVENT_KEYS={view:'views',engagement:'engagements',profile_visit:'profile_visits',dm:'dms',whatsapp_contact:'whatsapp_contacts',product_interest:'product_interests',store_visit:'store_visits'};
function rate(n,d){return d>0?n/d:null}
function funnelReport(touchpoints,attributions){
 const c={views:0,engagements:0,profile_visits:0,dms:0,whatsapp_contacts:0,product_interests:0,store_visits:0,direct_sales:attributions.filter(a=>a.classification==='direct_attributed').length};
 for(const t of touchpoints){const k=EVENT_KEYS[t.event_type];if(k)c[k]++}
 const r={profile_visit_per_view:rate(c.profile_visits,c.views),dm_per_profile_visit:rate(c.dms,c.profile_visits),whatsapp_per_dm:rate(c.whatsapp_contacts,c.dms),direct_sale_per_whatsapp:rate(c.direct_sales,c.whatsapp_contacts)};
 const limitations=[];for(const [k,v] of Object.entries(r))if(v===null)limitations.push('rate unavailable: '+k+' denominator is zero');
 return {scope:{type:'provided_dataset'},counts:c,rates:r,limitations};
}
function dimensionId(t,dimension){return dimension==='content'?t.content_id:dimension==='campaign'?t.campaign_id:t.influencer_id}
function aggregatePerformance(dimension,id,touchpoints,sales,attributions){
 const tpIds=new Set(touchpoints.filter(t=>dimensionId(t,dimension)===id).map(t=>t.touchpoint_id));
 const relevant=attributions.filter(a=>a.linked_touchpoint_ids.some(x=>tpIds.has(x)));
 const bySale=new Map(sales.map(s=>[s.sale_id,s]));
 const direct=relevant.filter(a=>a.classification==='direct_attributed'),assisted=relevant.filter(a=>a.classification==='assisted'),correlated=relevant.filter(a=>a.classification==='correlated');
 let revenue=0,margin=0,marginKnown=true;
 for(const a of direct){const s=bySale.get(a.sale_id);if(!s)continue;revenue+=s.net_revenue;if(s.gross_margin==null&&s.cogs==null)marginKnown=false;else margin+=s.gross_margin??(s.net_revenue-s.cogs)}
 return {dimension,dimension_id:id,direct_sales:direct.length,direct_net_revenue:revenue,assisted_sales:assisted.length,correlated_sales:correlated.length,gross_margin_known:marginKnown,direct_gross_margin:marginKnown?margin:null,limitations:marginKnown?[]:['one or more direct sales lack observed margin/COGS']};
}
function run(){
 const t=[];for(let i=0;i<40000;i++)t.push({touchpoint_id:'v'+i,event_type:'view'});for(let i=0;i<1900;i++)t.push({touchpoint_id:'p'+i,event_type:'profile_visit'});for(let i=0;i<220;i++)t.push({touchpoint_id:'d'+i,event_type:'dm'});for(let i=0;i<130;i++)t.push({touchpoint_id:'w'+i,event_type:'whatsapp_contact'});
 const attrs=[1,2,3].map(i=>({sale_id:'s'+i,classification:'direct_attributed',linked_touchpoint_ids:['w'+i]}));const f=funnelReport(t,attrs);assert.equal(f.counts.direct_sales,3);assert.ok(f.rates.direct_sale_per_whatsapp<0.03);
 const tp=[{touchpoint_id:'x1',influencer_id:'inf1'}],sales=[{sale_id:'s1',net_revenue:180,cogs:null,gross_margin:null}],a=[{sale_id:'s1',classification:'direct_attributed',linked_touchpoint_ids:['x1']}];const p=aggregatePerformance('influencer','inf1',tp,sales,a);assert.equal(p.direct_net_revenue,180);assert.equal(p.direct_gross_margin,null);
 console.log('Marketing C07 funnel/performance simulation: PASS');
}
if(require.main===module)run();
module.exports={rate,funnelReport,aggregatePerformance};
