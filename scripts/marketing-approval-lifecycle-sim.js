const assert=require('node:assert/strict');

function validateApproval(a,intent,nowMs){
 if(!a||a.status!=='approved')return {ok:false,reason:'not_approved'};
 if(!a.expires_at||Date.parse(a.expires_at)<=nowMs)return {ok:false,reason:'expired'};
 if(a.scope_hash!==intent.scope_hash)return {ok:false,reason:'scope_mismatch'};
 if(a.artifact_hash!==intent.artifact_hash)return {ok:false,reason:'artifact_mismatch'};
 if(a.consumption?.consumed_at||a.status==='consumed')return {ok:false,reason:'consumed'};
 return {ok:true,reason:null};
}
function createStore(approval){return {approval:{...approval,consumption:{...approval.consumption}},version:0}}
function consumeApproval(store,intent,nowIso,expectedVersion){
 if(store.version!==expectedVersion)return {ok:false,reason:'concurrent_conflict',external_execution:false};
 const v=validateApproval(store.approval,intent,Date.parse(nowIso));
 if(!v.ok)return {...v,external_execution:false};
 store.approval={...store.approval,status:'consumed',consumption:{single_use:true,consumed_at:nowIso,consumed_by_intent:intent.intent_id}};
 store.version++;
 return {ok:true,reason:null,version:store.version,approval_id:store.approval.approval_id,consumed_by_intent:intent.intent_id,external_execution:false};
}
function run(){
 const base={approval_id:'a1',scope_hash:'s1',artifact_hash:'h1',status:'approved',expires_at:'2030-01-01T12:00:00.000Z',consumption:{single_use:true,consumed_at:null,consumed_by_intent:null}};
 const i1={intent_id:'i1',scope_hash:'s1',artifact_hash:'h1'},i2={intent_id:'i2',scope_hash:'s1',artifact_hash:'h1'},store=createStore(base);
 const r1=consumeApproval(store,i1,'2030-01-01T11:00:00.000Z',0);assert.equal(r1.ok,true);
 const r2=consumeApproval(store,i2,'2030-01-01T11:00:00.000Z',0);assert.equal(r2.ok,false);assert.equal(r2.reason,'concurrent_conflict');
 assert.equal(validateApproval(store.approval,i2,Date.parse('2030-01-01T11:00:00.000Z')).reason,'not_approved');
 const expired=createStore(base);assert.equal(consumeApproval(expired,i1,'2030-01-01T12:00:00.000Z',0).reason,'expired');
 console.log('Marketing C06 approval lifecycle simulation: PASS');
}
if(require.main===module)run();
module.exports={validateApproval,createStore,consumeApproval};
