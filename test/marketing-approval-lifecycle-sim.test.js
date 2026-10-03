const test=require('node:test');
const assert=require('node:assert/strict');
const {validateApproval,createStore,consumeApproval}=require('../scripts/marketing-approval-lifecycle-sim');
const approval=()=>({approval_id:'a1',scope_hash:'s1',artifact_hash:'h1',status:'approved',expires_at:'2030-01-01T12:00:00.000Z',consumption:{single_use:true,consumed_at:null,consumed_by_intent:null}});
const intent=(id='i1')=>({intent_id:id,scope_hash:'s1',artifact_hash:'h1'});

test('valid exact approval is accepted before expiration',()=>assert.equal(validateApproval(approval(),intent(),Date.parse('2030-01-01T11:00:00Z')).ok,true));
test('approval expires fail closed at expiration instant',()=>assert.equal(validateApproval(approval(),intent(),Date.parse('2030-01-01T12:00:00Z')).reason,'expired'));
test('scope mismatch blocks',()=>assert.equal(validateApproval(approval(),{...intent(),scope_hash:'other'},0).reason,'scope_mismatch'));
test('artifact mismatch blocks',()=>assert.equal(validateApproval(approval(),{...intent(),artifact_hash:'other'},0).reason,'artifact_mismatch'));
test('first consumer wins and replay is blocked',()=>{const s=createStore(approval());assert.equal(consumeApproval(s,intent('i1'),'2030-01-01T11:00:00Z',0).ok,true);const replay=consumeApproval(s,intent('i2'),'2030-01-01T11:00:01Z',s.version);assert.equal(replay.ok,false);assert.equal(replay.reason,'not_approved');});
test('competing consumers using same version have exactly one winner',()=>{const s=createStore(approval()),v=s.version;const a=consumeApproval(s,intent('i1'),'2030-01-01T11:00:00Z',v);const b=consumeApproval(s,intent('i2'),'2030-01-01T11:00:00Z',v);assert.equal([a,b].filter(x=>x.ok).length,1);assert.equal(b.reason,'concurrent_conflict');});
test('consumption never executes externally',()=>{const s=createStore(approval()),r=consumeApproval(s,intent(),'2030-01-01T11:00:00Z',0);assert.equal(r.external_execution,false);});
