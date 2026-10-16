'use strict';

const FISCAL_OBLIGATION_STATES=Object.freeze([
 'FORECAST','PREPARING','VALIDATING','READY_FOR_REVIEW','APPROVED',
 'SUBMITTED','ACCEPTED','REJECTED','PAID','RECONCILED'
]);
const TAX_CLASSIFICATION_FIELDS=Object.freeze([
 'cfop','ncm','cest','cst','csosn','origin','icms','ipi','pis','cofins','ibs','cbs'
]);

function required(v,f){if(v===undefined||v===null||v==='')throw new Error(`${f} is required`);}
function createFiscalRule(i={}){
 for(const f of ['ruleId','version','authority','officialSource','effectiveFrom','schemaHash'])required(i[f],f);
 return Object.freeze({...i,effectiveUntil:i.effectiveUntil??null});
}
function validateRuleEffective(rule,instant){
 const t=Date.parse(instant),from=Date.parse(rule.effectiveFrom),to=rule.effectiveUntil?Date.parse(rule.effectiveUntil):Infinity;
 if([t,from,to].some(Number.isNaN))throw new Error('invalid fiscal rule date');
 if(t<from||t>to){const e=new Error('FISCAL_RULE_NOT_EFFECTIVE');e.code='RULE_NOT_EFFECTIVE';throw e;}
 return true;
}
function validateFiscalClassification(i={}){
 const issues=[];
 if(i.documentValidity!=='VALID')issues.push('DOCUMENT_NOT_VALID');
 if(!i.rule)issues.push('MISSING_OFFICIAL_RULE');
 else validateRuleEffective(i.rule,i.occurredAt);
 for(const f of i.requiredFields??[]) if(!TAX_CLASSIFICATION_FIELDS.includes(f)||i.classification?.[f]==null)issues.push(`MISSING_${String(f).toUpperCase()}`);
 return Object.freeze({status:issues.length?'BLOCKED':'VALIDATED',issues:Object.freeze(issues)});
}
function crossCheckFiscal(i={}){
 const checks=['fiscalToPurchase','fiscalToInventory','fiscalToPayable','fiscalToJournal'];
 const failed=checks.filter(k=>i[k]!==true);
 return Object.freeze({status:failed.length?'NEEDS_REVIEW':'MATCHED',failedChecks:Object.freeze(failed)});
}
function createFiscalObligation(i={}){
 for(const f of ['obligationId','tenantId','companyId','obligationType','competence','ruleVersion'])required(i[f],f);
 return Object.freeze({...i,state:i.state??'PREPARING',evidenceIds:Object.freeze([...(i.evidenceIds??[])])});
}
function assessFiscalReadiness(i={}){
 const blockers=[];
 if(i.schemaValidated!==true)blockers.push('SCHEMA_NOT_VALIDATED');
 if(i.businessValidated!==true)blockers.push('BUSINESS_RULES_NOT_VALIDATED');
 if(i.crossChecksMatched!==true)blockers.push('CROSS_CHECKS_NOT_MATCHED');
 if(i.evidenceComplete!==true)blockers.push('EVIDENCE_INCOMPLETE');
 return Object.freeze({state:blockers.length?'VALIDATING':'READY_FOR_REVIEW',blockers:Object.freeze(blockers)});
}
function assertFiscalSubmit({humanApproved=false}={}){
 if(humanApproved!==true){const e=new Error('FISCAL_SUBMIT_REQUIRES_HUMAN_APPROVAL');e.code='APPROVAL_REQUIRED';throw e;}
 return true;
}
function recordSubmissionResult({submitted,accepted,rejectionCode=null}={}){
 if(submitted!==true)return Object.freeze({state:'APPROVED'});
 if(accepted===true)return Object.freeze({state:'ACCEPTED',rejectionCode:null});
 if(accepted===false)return Object.freeze({state:'REJECTED',rejectionCode});
 return Object.freeze({state:'SUBMITTED',rejectionCode:null});
}
module.exports={FISCAL_OBLIGATION_STATES,TAX_CLASSIFICATION_FIELDS,createFiscalRule,validateRuleEffective,validateFiscalClassification,crossCheckFiscal,createFiscalObligation,assessFiscalReadiness,assertFiscalSubmit,recordSubmissionResult};
