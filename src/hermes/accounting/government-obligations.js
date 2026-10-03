'use strict';

const GOVERNMENT_SYSTEMS=Object.freeze(['ESOCIAL','EFD_REINF','DCTFWEB','FGTS_DIGITAL']);
const EVENT_STATES=Object.freeze(['DRAFT','VALIDATED','READY_FOR_REVIEW','APPROVED','READY_TO_SUBMIT','SUBMITTED','PROCESSING','ACCEPTED','REJECTED']);
function req(v,f){if(v===undefined||v===null||v==='')throw new Error(`${f} is required`);}
function createGovernmentEvent(i={}){
 for(const f of ['eventId','tenantId','companyId','system','eventType','competence','schemaVersion','ruleVersion'])req(i[f],f);
 if(!GOVERNMENT_SYSTEMS.includes(i.system))throw new Error('unsupported government system');
 return Object.freeze({...i,state:i.state??'DRAFT',evidenceIds:Object.freeze([...(i.evidenceIds??[])])});
}
function validateGovernmentEvent(i={}){
 const blockers=[];
 for(const k of ['schemaValid','businessRulesValid','dependenciesResolved','crossSourceMatched','evidenceComplete'])if(i[k]!==true)blockers.push(k);
 return Object.freeze({state:blockers.length?'DRAFT':'VALIDATED',blockers:Object.freeze(blockers)});
}
function assertFiscalSubmit({humanApproved=false}={}){
 if(humanApproved!==true){const e=new Error('FISCAL_SUBMIT_REQUIRES_HUMAN_APPROVAL');e.code='APPROVAL_REQUIRED';throw e;}return true;
}
function recordGovernmentResponse(i={}){
 req(i.submitted,'submitted');
 if(i.submitted!==true)return Object.freeze({state:'READY_TO_SUBMIT'});
 if(i.accepted===true)return Object.freeze({state:'ACCEPTED',protocol:i.protocol??null,rejection:null});
 if(i.accepted===false)return Object.freeze({state:'REJECTED',protocol:i.protocol??null,rejection:Object.freeze({code:i.rejectionCode??null,message:i.rejectionMessage??null})});
 return Object.freeze({state:i.processing===true?'PROCESSING':'SUBMITTED',protocol:i.protocol??null,rejection:null});
}
function createRectification(i={}){
 for(const f of ['rectificationId','originalEventId','replacementEventId','reason','requestedBy'])req(i[f],f);
 if(i.originalEventId===i.replacementEventId)throw new Error('rectification must create a new event version');
 return Object.freeze({...i,status:'PENDING_REVIEW',overwritesOriginal:false});
}
function createTaxPaymentDocument(i={}){
 for(const f of ['documentId','documentType','companyId','competence','amountCents','sourceSystem'])req(i[f],f);
 if(!Number.isSafeInteger(i.amountCents)||i.amountCents<0)throw new Error('amountCents must be non-negative safe integer');
 return Object.freeze({...i,state:i.state??'GUIDE_ISSUED',evidenceIds:Object.freeze([...(i.evidenceIds??[])])});
}
function reconcileOfficialObligation(i={}){
 const checks=['expectedMatched','reportedMatched','assessedMatched','guideMatched','bankConfirmed','accounted'];
 const failed=checks.filter(k=>i[k]!==true);
 return Object.freeze({state:failed.length?'NOT_RECONCILED':'RECONCILED',failedChecks:Object.freeze(failed)});
}
module.exports={GOVERNMENT_SYSTEMS,EVENT_STATES,createGovernmentEvent,validateGovernmentEvent,assertFiscalSubmit,recordGovernmentResponse,createRectification,createTaxPaymentDocument,reconcileOfficialObligation};
