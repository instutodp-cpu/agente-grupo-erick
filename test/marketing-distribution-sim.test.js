const test=require('node:test');
const assert=require('node:assert/strict');
const {hash,riskFor,scopeFor,prepareIntent,simulateReceipt}=require('../scripts/marketing-distribution-sim');
const plan=()=>({plan_id:'p1',artifact_hash:'a'.repeat(64)});
const target=(action='publish')=>({target_id:'t1',channel:'instagram',action,account_ref:'ig-erick',audience_ref:null});

test('publish and send are L2 while campaign/budget mutation are L3',()=>{assert.equal(riskFor('publish'),'L2');assert.equal(riskFor('send'),'L2');assert.equal(riskFor('mutate_campaign'),'L3');assert.equal(riskFor('mutate_budget'),'L3');});
test('L2 publish without approval is blocked',()=>{assert.equal(prepareIntent(plan(),target(),null).status,'blocked_approval');});
test('approved exact scope prepares simulation intent only',()=>{const p=plan(),t=target(),s=hash(scopeFor(p,t)),a={approval_id:'ap1',status:'approved',scope_hash:s,artifact_hash:p.artifact_hash};const r=prepareIntent(p,t,a);assert.equal(r.status,'prepared');assert.equal(r.mode,'simulation');assert.equal(r.external_execution,false);});
test('changed account invalidates previous approval',()=>{const p=plan(),t=target(),s=hash(scopeFor(p,t)),a={approval_id:'ap1',status:'approved',scope_hash:s,artifact_hash:p.artifact_hash};assert.equal(prepareIntent(p,{...t,account_ref:'other'},a).status,'blocked_scope');});
test('changed artifact invalidates previous approval',()=>{const p=plan(),t=target(),s=hash(scopeFor(p,t)),a={approval_id:'ap1',status:'approved',scope_hash:s,artifact_hash:p.artifact_hash};const changed={...p,artifact_hash:'b'.repeat(64)};assert.equal(prepareIntent(changed,t,a).status,'blocked_scope');});
test('same idempotency key becomes duplicate noop',()=>{const p=plan(),t=target(),s=hash(scopeFor(p,t)),a={approval_id:'ap1',status:'approved',scope_hash:s,artifact_hash:p.artifact_hash},seen=new Set();const first=prepareIntent(p,t,a,seen);simulateReceipt(first,seen);const second=prepareIntent(p,t,a,seen);assert.equal(second.status,'duplicate');assert.equal(simulateReceipt(second,seen).result,'duplicate_noop');});
