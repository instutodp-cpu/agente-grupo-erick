'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createAuditEngagement,createAuditFinding,completenessTest,cutoffTest,verifyEvidenceIntegrity,assertAuditorAction,createInternalAuditPackage}=require('../src/hermes/accounting/independent-auditor');

test('producer cannot approve own independent audit',()=>{assert.throws(()=>createAuditEngagement({engagementId:'a',tenantId:'t',companyId:'c',period:'2026-10',preparedBy:'u',auditApprovedBy:'u'}),/INDEPENDENCE/);});
test('audit finding requires evidence',()=>{assert.throws(()=>createAuditFinding({findingId:'f',engagementId:'a',assertion:'ACCURACY',severity:'HIGH',description:'variance'}),/REQUIRES_EVIDENCE/);});
test('completeness is tested source to ledger and ledger to source',()=>{
 const r=completenessTest({sourceIds:['a','b'],ledgerIds:['a','c']});assert.equal(r.pass,false);assert.deepEqual(r.sourceToLedgerMissing,['b']);assert.deepEqual(r.ledgerToSourceMissing,['c']);
});
test('cutoff detects event outside competence',()=>{assert.equal(cutoffTest({occurredAt:'2026-11-01',competenceStart:'2026-10-01',competenceEnd:'2026-10-31'}).pass,false);});
test('tamper after close invalidates attestation',()=>{
 const r=verifyEvidenceIntegrity({expectedHash:'a',observedHash:'b',closedPeriod:true});assert.equal(r.tampered,true);assert.equal(r.attestationValid,false);
});
test('auditor cannot correct pay submit or mutate source',()=>{
 for(const a of ['JOURNAL_CORRECT','PAYMENT_EXECUTE','FISCAL_SUBMIT','SOURCE_MUTATE'])assert.throws(()=>assertAuditorAction(a),e=>e.code==='DENIED');
});
test('critical open finding prevents PASS and package is not statutory opinion',()=>{
 const finding=createAuditFinding({findingId:'f',engagementId:'a',assertion:'COMPLETENESS',severity:'CRITICAL',description:'missing invoice',evidenceIds:['e']});
 const p=createInternalAuditPackage({packageId:'p',engagementId:'a',createdAt:'now',evidenceManifestHash:'h',findings:[finding]});
 assert.equal(p.status,'EXCEPTIONS');assert.equal(p.statutoryAuditOpinion,false);
});
