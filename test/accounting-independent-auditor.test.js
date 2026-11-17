'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  createAuditEngagement,createAuditFinding,completenessTest,cutoffTest,
  verifyEvidenceIntegrity,assertAuditorAction,createInternalAuditPackage
}=require('../src/hermes/accounting/independent-auditor');

const scope={tenantId:'tenant-a',companyId:'company-a'};

test('producer cannot approve or audit own independent engagement',()=>{
  assert.throws(
    ()=>createAuditEngagement({
      engagementId:'engagement-1',...scope,period:'2026-10',
      preparedBy:'producer',auditorId:'producer',auditApprovedBy:'approver'
    }),
    error=>error.code==='AUDITOR_INDEPENDENCE_VIOLATION'
  );
  const engagement=createAuditEngagement({
    engagementId:'engagement-2',...scope,period:'2026-10',
    preparedBy:'producer',auditorId:'auditor',auditApprovedBy:'approver'
  });
  assert.equal(engagement.status,'OPEN');
  assert.equal(Object.isFrozen(engagement),true);
});

test('audit finding requires supported assertion and evidence',()=>{
  assert.throws(
    ()=>createAuditFinding({
      findingId:'finding-1',engagementId:'engagement-1',
      assertion:'ACCURACY',severity:'HIGH',description:'variance'
    }),
    error=>error.code==='AUDIT_FINDING_REQUIRES_EVIDENCE'
  );
  const finding=createAuditFinding({
    findingId:'finding-2',engagementId:'engagement-1',
    assertion:'ACCURACY',severity:'HIGH',description:'variance',evidenceIds:['evidence-1']
  });
  assert.equal(finding.auditorMayCorrect,false);
});

test('completeness tests both directions and rejects duplicate IDs',()=>{
  const result=completenessTest({sourceIds:['a','b'],ledgerIds:['a','c']});
  assert.equal(result.pass,false);
  assert.deepEqual(result.sourceToLedgerMissing,['b']);
  assert.deepEqual(result.ledgerToSourceMissing,['c']);
  assert.throws(
    ()=>completenessTest({sourceIds:['a','a'],ledgerIds:['a']}),
    error=>error.code==='DUPLICATE_ID'
  );
});

test('cutoff detects event outside competence with strict dates',()=>{
  assert.equal(cutoffTest({
    occurredAt:'2026-11-01',competenceStart:'2026-10-01',competenceEnd:'2026-10-31'
  }).pass,false);
  assert.throws(
    ()=>cutoffTest({
      occurredAt:'2026-10-02',competenceStart:'2026-02-30',competenceEnd:'2026-10-31'
    }),
    error=>error.code==='INVALID_DATE'
  );
});

test('tamper after close invalidates attestation',()=>{
  const result=verifyEvidenceIntegrity({
    expectedHash:'hash-a',observedHash:'hash-b',closedPeriod:true
  });
  assert.equal(result.tampered,true);
  assert.equal(result.attestationValid,false);
  assert.equal(verifyEvidenceIntegrity({
    expectedHash:'hash-a',observedHash:'hash-b',closedPeriod:false
  }).attestationValid,true);
});

test('auditor cannot correct, pay, submit or mutate source',()=>{
  for(const action of ['JOURNAL_CORRECT','PAYMENT_EXECUTE','FISCAL_SUBMIT','SOURCE_MUTATE'])
    assert.throws(()=>assertAuditorAction(action),error=>error.code==='DENIED');
  assert.equal(assertAuditorAction('TEST'),true);
  assert.throws(()=>assertAuditorAction('UNKNOWN'),error=>error.code==='DENIED');
});

test('critical open finding prevents PASS and package is not statutory opinion',()=>{
  const finding=createAuditFinding({
    findingId:'finding-critical',engagementId:'engagement-1',
    assertion:'COMPLETENESS',severity:'CRITICAL',description:'missing invoice',
    evidenceIds:['evidence-1']
  });
  const packageResult=createInternalAuditPackage({
    packageId:'package-1',engagementId:'engagement-1',
    createdAt:'2026-10-02T12:00:00Z',evidenceManifestHash:'hash',
    findings:[finding]
  });
  assert.equal(packageResult.status,'EXCEPTIONS');
  assert.equal(packageResult.statutoryAuditOpinion,false);
  assert.equal(packageResult.criticalOpen,1);
});
