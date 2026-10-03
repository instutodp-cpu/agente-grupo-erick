const assert=require('node:assert/strict');
const crypto=require('node:crypto');
function economics({direct_net_revenue,direct_sales,spend=null,direct_gross_margin=null}){
 const spendKnown=spend!=null,marginKnown=direct_gross_margin!=null,limitations=[];
 if(!spendKnown)limitations.push('spend unavailable: ROAS and CAC cannot be computed');
 if(!marginKnown)limitations.push('direct gross margin unavailable: margin return cannot be computed');
 return {direct_net_revenue,direct_sales,spend,spend_known:spendKnown,direct_gross_margin,margin_known:marginKnown,
  roas:spendKnown&&spend>0?direct_net_revenue/spend:null,
  cac:spendKnown&&direct_sales>0?spend/direct_sales:null,
  gross_margin_return:spendKnown&&spend>0&&marginKnown?direct_gross_margin/spend:null,limitations};
}
const TH={reach_to_profile:.03,profile_to_dm:.08,dm_to_whatsapp:.40,whatsapp_to_sale:.05};
function safe(n,d){return d>0?n/d:null}
function diagnose(c){
 const rates={reach_to_profile:safe(c.profile_visits,c.views),profile_to_dm:safe(c.dms,c.profile_visits),dm_to_whatsapp:safe(c.whatsapp_contacts,c.dms),whatsapp_to_sale:safe(c.direct_sales,c.whatsapp_contacts)};
 const missing=Object.entries(rates).filter(([,v])=>v===null).map(([k])=>k);
 if(missing.length)return diagnosis('insufficient_data',[...missing.map(x=>'missing denominator for '+x)],'measurement','complete funnel instrumentation');
 const deficits=Object.entries(rates).map(([k,v])=>[k,v/TH[k]]).sort((a,b)=>a[1]-b[1]);
 const [bottleneck,ratio]=deficits[0]; if(ratio>=1)return diagnosis('no_clear_bottleneck',['all observed stage rates meet configured diagnostic thresholds'],'measurement','run controlled experiment on commercial objective');
 const map={reach_to_profile:['hook','profile visits per view'],profile_to_dm:['profile_cta','DMs per profile visit'],dm_to_whatsapp:['dm_cta','WhatsApp contacts per DM'],whatsapp_to_sale:['whatsapp_qualification','direct sales per WhatsApp contact']};
 const [dim,metric]=map[bottleneck];return diagnosis(bottleneck,[bottleneck+' rate='+rates[bottleneck].toFixed(4),'threshold='+TH[bottleneck]],dim,metric);
}
function diagnosis(primary,evidence,dim,metric){const hypothesis='Improving '+dim+' may improve '+metric+'; test required.';return {diagnosis_id:'diag-'+crypto.createHash('sha256').update(JSON.stringify({primary,evidence})).digest('hex').slice(0,12),primary_bottleneck:primary,evidence,next_test:{hypothesis,controlled_dimension:dim,primary_metric:metric},prediction_mode:'decision_support_not_outcome_prediction'}}
function run(){
 const e=economics({direct_net_revenue:1800,direct_sales:10});assert.equal(e.roas,null);assert.equal(e.cac,null);
 const known=economics({direct_net_revenue:1800,direct_sales:10,spend:600,direct_gross_margin:900});assert.equal(known.roas,3);assert.equal(known.cac,60);assert.equal(known.gross_margin_return,1.5);
 const d=diagnose({views:40000,profile_visits:1900,dms:220,whatsapp_contacts:130,direct_sales:3});assert.equal(d.primary_bottleneck,'whatsapp_to_sale');assert.equal(d.prediction_mode,'decision_support_not_outcome_prediction');
 console.log('Marketing C07 economics/diagnosis simulation: PASS');
}
if(require.main===module)run();
module.exports={economics,diagnose};
