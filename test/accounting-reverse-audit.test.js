'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createReverseAuditRun,bidirectionalTrace,traceExpectedChain,amountTieOut,createReverseAuditException,assessReverseAudit}=require('../src/hermes/accounting/reverse-audit');

test('reverse audit supports critical accounting domains',()=>{
 const r=createReverseAuditRun({runId:'r',tenantId:'t',companyId:'c',period:'2026-10',domain:'BANK',startedAt:'now'});assert.equal(r.status,'RUNNING');
});
test('bidirectional trace finds omitted source and unsupported ledger record',()=>{
 const r=bidirectionalTrace({sourceIds:['a','b'],ledgerIds:['a','c']});
 assert.deepEqual(r.missingFromLedger,['b']);assert.deepEqual(r.unsupportedInLedger,['c']);assert.equal(r.pass,false);
});
test('expected chain detects missing stage',()=>{
 const r=traceExpectedChain({nodes:[{id:'sale',type:'SALE'},{id:'bank',type:'BANK',parentId:'sale'}],requiredTypes:['SALE','FISCAL','BANK']});
 assert.deepEqual(r.missingTypes,['FISCAL']);assert.equal(r.pass,false);
});
test('orphan downstream node is detected',()=>{
 const r=traceExpectedChain({nodes:[{id:'bank',type:'BANK',parentId:'missing'}],requiredTypes:['BANK']});assert.deepEqual(r.orphanNodeIds,['bank']);
});
test('one cent reverse tie-out difference is exception',()=>{const r=amountTieOut({upstreamCents:10000,downstreamCents:9999});assert.equal(r.status,'EXCEPTION');assert.equal(r.varianceCents,-1);});
test('reverse audit exception cannot auto-correct',()=>{
 const e=createReverseAuditException({exceptionId:'e',runId:'r',domain:'FISCAL',kind:'MISSING_SOURCE',description:'ledger without fiscal evidence',evidenceIds:['x']});
 assert.equal(e.autoCorrection,false);assert.equal(e.requiresHumanReview,true);
});
test('any failed reverse trace blocks PASS',()=>{assert.equal(assessReverseAudit({traces:[{pass:false}],tieOuts:[{status:'MATCHED'}],exceptions:[]}).status,'EXCEPTIONS');});
