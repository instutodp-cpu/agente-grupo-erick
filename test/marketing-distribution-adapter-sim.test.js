const test=require('node:test');
const assert=require('node:assert/strict');
const {adapterFor,prepareAdapterJob,runAttempt,retryJob,markDue}=require('../scripts/marketing-distribution-adapter-sim');
const intent=()=>({intent_id:'i1',idempotency_key:'a'.repeat(64)});

test('channels map to controlled adapters',()=>{assert.equal(adapterFor('instagram'),'instagram');assert.equal(adapterFor('whatsapp'),'whatsapp');assert.equal(adapterFor('meta_ads'),'meta_ads');assert.equal(adapterFor('unknown'),'generic');});
test('future job stays scheduled until due',()=>{const due='2030-01-01T12:00:00.000Z';let j=prepareAdapterJob(intent(),{channel:'instagram',scheduled_for:due},Date.parse('2030-01-01T11:00:00.000Z'));assert.equal(j.status,'scheduled');j=markDue(j,Date.parse(due));assert.equal(j.status,'ready');});
test('transient retry preserves idempotency key',()=>{const j=prepareAdapterJob(intent(),{channel:'whatsapp'},0),r=runAttempt(j,'transient_failure');assert.equal(r.outcome,'retryable_failure');const j2=retryJob(j);assert.equal(j2.idempotency_key,j.idempotency_key);assert.equal(j2.attempt,2);});
test('retry limit fails terminally',()=>{const j={...prepareAdapterJob(intent(),{channel:'instagram'},0),attempt:3,max_attempts:3};const r=runAttempt(j,'transient_failure');assert.equal(r.outcome,'terminal_failure');assert.equal(r.retry_same_idempotency_key,false);});
test('terminal provider failure is never auto-retried',()=>{const j=prepareAdapterJob(intent(),{channel:'meta_ads'},0),r=runAttempt(j,'terminal_failure');assert.equal(r.outcome,'terminal_failure');assert.equal(r.retry_same_idempotency_key,false);});
test('success followed by repeated attempt becomes duplicate noop',()=>{const j=prepareAdapterJob(intent(),{channel:'instagram'},0),ledger=new Map();assert.equal(runAttempt(j,'success',ledger).outcome,'would_execute');assert.equal(runAttempt(retryJob(j),'success',ledger).outcome,'duplicate_noop');});
test('all adapter receipts remain simulation-only',()=>{const j=prepareAdapterJob(intent(),{channel:'google_ads'},0),r=runAttempt(j,'success');assert.equal(r.simulated,true);assert.equal(r.external_mutation,false);});
