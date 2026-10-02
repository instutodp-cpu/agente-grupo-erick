const test=require('node:test');
const assert=require('node:assert/strict');
const {ambiguous,reconcile,auditEvent,appendAudit,authorizeRetry}=require('../scripts/marketing-distribution-reconcile-sim');
const intent=()=>({intent_id:'i1',idempotency_key:'k'.repeat(64)});

test('ambiguous result never auto retries',()=>{const r=ambiguous(intent());assert.equal(r.status,'reconciliation_required');assert.equal(r.auto_retry,false);assert.equal(r.external_execution,false);});
test('confirmed provider effect reconciles as success',()=>{assert.equal(reconcile(intent(),'confirmed_effect',['provider:123']).decision,'confirm_success');});
test('not found requires traceable evidence before same-key retry',()=>{const i=intent();assert.equal(reconcile(i,'not_found',[]).decision,'remain_ambiguous');const r=reconcile(i,'not_found',['lookup:idempotency']);const a=authorizeRetry(r);assert.equal(a.authorized,true);assert.equal(a.idempotency_key,i.idempotency_key);assert.equal(a.new_intent,false);});
test('conflicting provider effect blocks',()=>{assert.equal(reconcile(intent(),'conflicting_effect',['provider:other']).decision,'block_conflict');});
test('unknown remains ambiguous',()=>{assert.equal(reconcile(intent(),'unknown',[]).decision,'remain_ambiguous');});
test('audit events are simulation-only and append-only',()=>{const i=intent(),e1=auditEvent(i,'attempt_ambiguous'),e2=auditEvent(i,'reconciliation_started',{},2);let log=[];const first=appendAudit(log,e1);const second=appendAudit(first,e2);assert.equal(first.length,1);assert.equal(second.length,2);assert.equal(second[0].external_mutation,false);assert.equal(Object.isFrozen(second),true);});
test('reconciliation never changes original idempotency key',()=>{const i=intent();for(const o of ['confirmed_effect','not_found','conflicting_effect','unknown'])assert.equal(reconcile(i,o,['e']).idempotency_key,i.idempotency_key);});
