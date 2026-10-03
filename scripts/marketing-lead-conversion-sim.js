const assert=require('node:assert/strict');const crypto=require('node:crypto');
function planLeadConversion({mission_id,lead,offer={},attribution={},capabilities=[],approval=null}){
 if(!mission_id||!lead?.lead_id)return {status:'blocked',reason:'mission_and_lead_required',external_execution:false};
 if(!lead.consent_state)return {status:'blocked',reason:'consent_state_required',external_execution:false};
 const facts=['price','stock','discount'].filter(k=>offer[k]!==undefined);const missing=['price','stock'].filter(k=>offer[k]===undefined);
 const source=attribution.source||lead.source||null;
 const qualified=Boolean(lead.intent&&lead.contact_channel);
 const next=qualified?'handoff_to_sales':'request_qualification';
 const requested=lead.contact_channel==='whatsapp'?'send_whatsapp_message':'record_qualification';
 const cap=capabilities.find(c=>c.capability===requested&&c.status==='registered');
 const mayExecute=Boolean(cap&&approval?.status==='approved'&&approval?.capability===requested&&lead.consent_state==='granted');
 const seed=JSON.stringify({mission_id,lead_id:lead.lead_id,next,source,requested});
 return {plan_id:'lc-'+crypto.createHash('sha256').update(seed).digest('hex').slice(0,12),status:'planned',qualified,next_best_action:next,handoff_destination:qualified?lead.contact_channel:null,attribution_source:source,known_offer_facts:facts,missing_offer_facts:missing,requested_capability:requested,external_execution:false,execution_eligible:mayExecute,approval_required:requested!=='record_qualification',limitations:missing.map(x=>'offer fact unavailable: '+x)};
}
function run(){const base={mission_id:'m1',lead:{lead_id:'l1',intent:'shoe',contact_channel:'whatsapp',consent_state:'granted',source:'instagram'},offer:{price:199}};const p=planLeadConversion(base);assert.equal(p.qualified,true);assert.equal(p.execution_eligible,false);assert.deepEqual(p.missing_offer_facts,['stock']);const a=planLeadConversion({...base,capabilities:[{capability:'send_whatsapp_message',status:'registered'}],approval:{status:'approved',capability:'send_whatsapp_message'}});assert.equal(a.execution_eligible,true);assert.equal(a.external_execution,false);console.log('Marketing lead conversion simulation: PASS')}
if(require.main===module)run();module.exports={planLeadConversion};
