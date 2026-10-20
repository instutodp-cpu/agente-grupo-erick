'use strict';

const TAX_STATES=Object.freeze(['FORECAST','EXPECTED','ASSESSED','GUIDE_ISSUED','PAID','RECONCILED']);
const TAX_SOURCES=Object.freeze(['ESOCIAL','EFD_REINF','MIT','PGDAS_D','STATE','MUNICIPAL','OTHER']);
const SCENARIOS=Object.freeze(['CURRENT','EXPECTED','CONSERVATIVE','STRESS']);
function required(v,f){if(v===undefined||v===null||v==='')throw new Error(`${f} is required`);}
function cents(v,f){if(!Number.isSafeInteger(v)||v<0)throw new Error(`${f} must be a non-negative safe integer`);}
function createTaxObligation(i={}){
 for(const f of ['taxObligationId','tenantId','companyId','taxType','competence','source','ruleVersion'])required(i[f],f);
 if(!TAX_SOURCES.includes(i.source))throw new Error('unsupported tax source');
 if(!TAX_STATES.includes(i.state??'FORECAST'))throw new Error('unsupported tax state');
 if(i.amountCents!=null)cents(i.amountCents,'amountCents');
 return Object.freeze({...i,state:i.state??'FORECAST',evidenceIds:Object.freeze([...(i.evidenceIds??[])])});
}
function transitionTaxState(current,next){
 const order=TAX_STATES;
 const a=order.indexOf(current),b=order.indexOf(next);
 if(a<0||b<0)throw new Error('unsupported tax state');
 if(b!==a+1)throw new Error('TAX_STATE_TRANSITION_NOT_ALLOWED');
 return next;
}
function createSimpleTaxForecast(i={}){
 for(const f of ['forecastId','companyId','competence','currentRevenueCents','rbt12Cents','ruleVersion','scenario'])required(i[f],f);
 cents(i.currentRevenueCents,'currentRevenueCents');cents(i.rbt12Cents,'rbt12Cents');
 if(!SCENARIOS.includes(i.scenario))throw new Error('unsupported scenario');
 if(i.estimatedDasCents!=null)cents(i.estimatedDasCents,'estimatedDasCents');
 return Object.freeze({...i,valueState:'FORECAST',officialAssessment:false});
}
function reconcileAssessment({forecastCents,assessedCents,toleranceCents=0}={}){
 cents(forecastCents,'forecastCents');cents(assessedCents,'assessedCents');cents(toleranceCents,'toleranceCents');
 const varianceCents=assessedCents-forecastCents;
 return Object.freeze({forecastCents,assessedCents,varianceCents,status:Math.abs(varianceCents)<=toleranceCents?'MATCHED':'TAX_EXCEPTION'});
}
function cashForecast(obligations=[],asOf){
 const base=Date.parse(asOf+'T00:00:00Z');if(Number.isNaN(base))throw new Error('invalid asOf');
 const horizons=[7,14,30,60,90];
 return Object.freeze(Object.fromEntries(horizons.map(h=>[h,obligations.reduce((s,o)=>{
  if(o.state==='PAID'||o.state==='RECONCILED'||!o.dueDate||o.amountCents==null)return s;
  const due=Date.parse(o.dueDate+'T00:00:00Z');const days=Math.ceil((due-base)/86400000);
  return days>=0&&days<=h?s+o.amountCents:s;
 },0)])));
}
function assertGuideOrPaymentEffect({action,humanApproved=false}={}){
 if(['GUIDE_ISSUE','PAYMENT_EXECUTE'].includes(action)&&humanApproved!==true){
  const e=new Error(`${action}_REQUIRES_HUMAN_APPROVAL`);e.code='APPROVAL_REQUIRED';throw e;
 }
 return true;
}
function assertDaeSemantics({daeAsTaxType=false}={}){
 if(daeAsTaxType)throw new Error('DAE_IS_COLLECTION_DOCUMENT_NOT_TAX_TYPE');return true;
}
module.exports={TAX_STATES,TAX_SOURCES,SCENARIOS,createTaxObligation,transitionTaxState,createSimpleTaxForecast,reconcileAssessment,cashForecast,assertGuideOrPaymentEffect,assertDaeSemantics};
