'use strict';

const AUDIT_ASSERTIONS=Object.freeze(['EXISTENCE_OCCURRENCE','COMPLETENESS','ACCURACY','CUTOFF_COMPETENCE','CLASSIFICATION','AUTHORIZATION','VALUATION','RECONCILIATION','PRESENTATION']);
const FINDING_SEVERITIES=Object.freeze(['LOW','MEDIUM','HIGH','CRITICAL']);
function req(v,f){if(v===undefined||v===null||v==='')throw new Error(`${f} is required`);}
function createAuditEngagement(i={}){
 for(const f of ['engagementId','tenantId','companyId','period','preparedBy','auditApprovedBy'])req(i[f],f);
 if(i.preparedBy===i.auditApprovedBy)throw new Error('AUDITOR_INDEPENDENCE_VIOLATION');
 return Object.freeze({...i,status:i.status??'OPEN'});
}
function createAuditFinding(i={}){
 for(const f of ['findingId','engagementId','assertion','severity','description'])req(i[f],f);
 if(!AUDIT_ASSERTIONS.includes(i.assertion))throw new Error('unsupported audit assertion');
 if(!FINDING_SEVERITIES.includes(i.severity))throw new Error('unsupported finding severity');
 const evidenceIds=Object.freeze([...(i.evidenceIds??[])]);
 if(evidenceIds.length===0)throw new Error('AUDIT_FINDING_REQUIRES_EVIDENCE');
 return Object.freeze({...i,evidenceIds,status:i.status??'OPEN',auditorMayCorrect:false});
}
function completenessTest({sourceIds=[],ledgerIds=[]}={}){
 const s=new Set(sourceIds),l=new Set(ledgerIds);
 const sourceNotLedger=sourceIds.filter(x=>!l.has(x));
 const ledgerNotSource=ledgerIds.filter(x=>!s.has(x));
 return Object.freeze({sourceToLedgerMissing:Object.freeze(sourceNotLedger),ledgerToSourceMissing:Object.freeze(ledgerNotSource),pass:sourceNotLedger.length===0&&ledgerNotSource.length===0});
}
function cutoffTest({occurredAt,competenceStart,competenceEnd}={}){
 for(const [v,f] of [[occurredAt,'occurredAt'],[competenceStart,'competenceStart'],[competenceEnd,'competenceEnd']])req(v,f);
 const t=Date.parse(occurredAt),a=Date.parse(competenceStart),b=Date.parse(competenceEnd);
 if([t,a,b].some(Number.isNaN))throw new Error('invalid cutoff date');
 return Object.freeze({pass:t>=a&&t<=b,assertion:'CUTOFF_COMPETENCE'});
}
function verifyEvidenceIntegrity({expectedHash,observedHash,closedPeriod=false}={}){
 req(expectedHash,'expectedHash');req(observedHash,'observedHash');
 const pass=expectedHash===observedHash;
 return Object.freeze({pass,tampered:!pass,attestationValid:pass||!closedPeriod});
}
function assertAuditorAction(action){
 if(['JOURNAL_CORRECT','PAYMENT_EXECUTE','FISCAL_SUBMIT','SOURCE_MUTATE'].includes(action)){
  const e=new Error('AUDITOR_ACTION_NOT_PERMITTED');e.code='DENIED';throw e;
 }
 return true;
}
function createInternalAuditPackage(i={}){
 for(const f of ['packageId','engagementId','createdAt','evidenceManifestHash'])req(i[f],f);
 const findings=Object.freeze([...(i.findings??[])]);
 const criticalOpen=findings.filter(f=>f.severity==='CRITICAL'&&f.status!=='RESOLVED').length;
 return Object.freeze({...i,findings,criticalOpen,attestationType:'INTERNAL_VERIFICATION',statutoryAuditOpinion:false,status:criticalOpen?'EXCEPTIONS':'PASS'});
}
module.exports={AUDIT_ASSERTIONS,FINDING_SEVERITIES,createAuditEngagement,createAuditFinding,completenessTest,cutoffTest,verifyEvidenceIntegrity,assertAuditorAction,createInternalAuditPackage};
