'use strict';

const AUDIT_ASSERTIONS=Object.freeze([
  'EXISTENCE_OCCURRENCE','COMPLETENESS','ACCURACY','CUTOFF_COMPETENCE',
  'CLASSIFICATION','AUTHORIZATION','VALUATION','RECONCILIATION','PRESENTATION'
]);
const FINDING_SEVERITIES=Object.freeze(['LOW','MEDIUM','HIGH','CRITICAL']);
const ALLOWED_AUDITOR_ACTIONS=Object.freeze(['READ','TEST','ATTEST','BLOCK']);
const DENIED_AUDITOR_ACTIONS=Object.freeze([
  'JOURNAL_CORRECT','PAYMENT_EXECUTE','FISCAL_SUBMIT','SOURCE_MUTATE'
]);
const COMPETENCE_RE=/^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const INSTANT_RE=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function deepFreeze(value,seen=new Set()){
  if(value===null||typeof value!=='object'||seen.has(value))return value;
  seen.add(value);
  for(const key of Reflect.ownKeys(value))deepFreeze(value[key],seen);
  return Object.freeze(value);
}
function failure(code,message){
  const error=new Error(message||code);
  error.code=code;
  return error;
}
function requiredString(value,field){
  if(typeof value!=='string'||value.trim()==='')throw failure('REQUIRED_FIELD',field+' is required');
  return value;
}
function strictCompetence(value){
  if(typeof value!=='string'||!COMPETENCE_RE.test(value))
    throw failure('INVALID_COMPETENCE','period must be YYYY-MM');
  return value;
}
function strictDate(value,field){
  if(typeof value!=='string'||!DATE_RE.test(value))throw failure('INVALID_DATE',field+' must be YYYY-MM-DD');
  const date=new Date(value+'T00:00:00.000Z');
  if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==value)
    throw failure('INVALID_DATE',field+' is not a calendar date');
  return value;
}
function strictInstant(value,field){
  if(typeof value!=='string'||!INSTANT_RE.test(value))
    throw failure('INVALID_INSTANT',field+' must be an ISO UTC instant');
  if(Number.isNaN(new Date(value).getTime()))throw failure('INVALID_INSTANT',field+' is invalid');
  return value;
}
function uniqueStrings(values,field){
  if(values===undefined)return [];
  if(!Array.isArray(values))throw failure('INVALID_LIST',field+' must be an array');
  const result=[];
  const seen=new Set();
  for(const value of values){
    requiredString(value,field+' item');
    if(seen.has(value))throw failure('DUPLICATE_ID',field+' contains duplicates');
    seen.add(value);
    result.push(value);
  }
  return result;
}
function createAuditEngagement(input={}){
  const engagementId=requiredString(input.engagementId,'engagementId');
  const tenantId=requiredString(input.tenantId,'tenantId');
  const companyId=requiredString(input.companyId,'companyId');
  const period=strictCompetence(input.period);
  const preparedBy=requiredString(input.preparedBy,'preparedBy');
  const auditorId=requiredString(input.auditorId,'auditorId');
  const auditApprovedBy=requiredString(input.auditApprovedBy,'auditApprovedBy');
  if(preparedBy===auditorId||preparedBy===auditApprovedBy)
    throw failure('AUDITOR_INDEPENDENCE_VIOLATION','producer cannot audit or approve own engagement');
  if(!['OPEN','CLOSED'].includes(input.status??'OPEN'))
    throw failure('UNSUPPORTED_ENGAGEMENT_STATUS','unsupported engagement status');
  return deepFreeze({
    ...input,engagementId,tenantId,companyId,period,preparedBy,
    auditorId,auditApprovedBy,status:input.status??'OPEN'
  });
}
function createAuditFinding(input={}){
  const findingId=requiredString(input.findingId,'findingId');
  const engagementId=requiredString(input.engagementId,'engagementId');
  const assertion=requiredString(input.assertion,'assertion');
  const severity=requiredString(input.severity,'severity');
  const description=requiredString(input.description,'description');
  if(!AUDIT_ASSERTIONS.includes(assertion))throw failure('UNSUPPORTED_ASSERTION','unsupported audit assertion');
  if(!FINDING_SEVERITIES.includes(severity))throw failure('UNSUPPORTED_SEVERITY','unsupported finding severity');
  const evidenceIds=uniqueStrings(input.evidenceIds,'evidenceIds');
  if(evidenceIds.length===0)throw failure('AUDIT_FINDING_REQUIRES_EVIDENCE','audit finding requires evidence');
  const status=input.status??'OPEN';
  if(!['OPEN','RESOLVED'].includes(status))throw failure('UNSUPPORTED_FINDING_STATUS','unsupported finding status');
  return deepFreeze({
    ...input,findingId,engagementId,assertion,severity,description,
    evidenceIds,status,auditorMayCorrect:false
  });
}
function completenessTest(input={}){
  const sourceIds=uniqueStrings(input.sourceIds,'sourceIds');
  const ledgerIds=uniqueStrings(input.ledgerIds,'ledgerIds');
  const sourceSet=new Set(sourceIds);
  const ledgerSet=new Set(ledgerIds);
  const sourceToLedgerMissing=sourceIds.filter(id=>!ledgerSet.has(id));
  const ledgerToSourceMissing=ledgerIds.filter(id=>!sourceSet.has(id));
  return deepFreeze({
    sourceToLedgerMissing,ledgerToSourceMissing,
    pass:sourceToLedgerMissing.length===0&&ledgerToSourceMissing.length===0
  });
}
function cutoffTest(input={}){
  const occurredAt=strictDate(input.occurredAt,'occurredAt');
  const competenceStart=strictDate(input.competenceStart,'competenceStart');
  const competenceEnd=strictDate(input.competenceEnd,'competenceEnd');
  if(competenceEnd<competenceStart)throw failure('INVALID_CUTOFF_RANGE','competenceEnd precedes competenceStart');
  return deepFreeze({
    pass:occurredAt>=competenceStart&&occurredAt<=competenceEnd,
    assertion:'CUTOFF_COMPETENCE'
  });
}
function verifyEvidenceIntegrity(input={}){
  const expectedHash=requiredString(input.expectedHash,'expectedHash');
  const observedHash=requiredString(input.observedHash,'observedHash');
  const closedPeriod=input.closedPeriod===true;
  const pass=expectedHash===observedHash;
  return deepFreeze({
    pass,tampered:!pass,attestationValid:pass||!closedPeriod
  });
}
function assertAuditorAction(action){
  requiredString(action,'action');
  if(DENIED_AUDITOR_ACTIONS.includes(action))throw failure('DENIED','auditor action not permitted');
  if(!ALLOWED_AUDITOR_ACTIONS.includes(action))throw failure('DENIED','unknown auditor action');
  return true;
}
function createInternalAuditPackage(input={}){
  const packageId=requiredString(input.packageId,'packageId');
  const engagementId=requiredString(input.engagementId,'engagementId');
  const createdAt=strictInstant(input.createdAt,'createdAt');
  const evidenceManifestHash=requiredString(input.evidenceManifestHash,'evidenceManifestHash');
  if(!Array.isArray(input.findings))throw failure('INVALID_LIST','findings must be an array');
  const findingIds=new Set();
  const findings=input.findings.map(finding=>{
    if(findingIds.has(finding.findingId))throw failure('DUPLICATE_ID','audit finding IDs must be unique');
    findingIds.add(finding.findingId);
    return deepFreeze({...finding});
  });
  const criticalOpen=findings.filter(finding=>finding.severity==='CRITICAL'&&finding.status!=='RESOLVED').length;
  return deepFreeze({
    ...input,packageId,engagementId,createdAt,evidenceManifestHash,findings,
    criticalOpen,attestationType:'INTERNAL_VERIFICATION',
    statutoryAuditOpinion:false,status:criticalOpen?'EXCEPTIONS':'PASS'
  });
}
module.exports={
  AUDIT_ASSERTIONS,FINDING_SEVERITIES,createAuditEngagement,
  createAuditFinding,completenessTest,cutoffTest,verifyEvidenceIntegrity,
  assertAuditorAction,createInternalAuditPackage
};
