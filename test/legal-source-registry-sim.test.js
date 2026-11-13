const test=require('node:test');
const assert=require('node:assert/strict');
const {assessSourceUse,rankAuthority}=require('../src/hermes/legal/source-registry');
const {createSourceSnapshot}=require('../src/hermes/legal/provenance');

test('unregistered source fails closed',()=>assert.equal(assessSourceUse('random_blog','discovery').allowed,false));
test('open web cannot certify legal authority',()=>assert.deepEqual(assessSourceUse('open_web','legal_authority'),{allowed:false,reason:'source_not_authoritative_for_purpose'}));
test('DataJud metadata cannot certify substantive legal authority',()=>assert.equal(assessSourceUse('cnj_datajud','legal_authority').allowed,false));
test('official legislation source can support authority workflow',()=>assert.equal(assessSourceUse('planalto','legal_authority').allowed,true));
test('official authority ranks above discovery web',()=>assert.ok(rankAuthority('planalto')>rankAuthority('open_web')));
test('source snapshot is deterministic and immutable by contract',()=>{
 const input={sourceId:'planalto',content:'lei versionada',retrievedAt:'2026-10-06T21:00:00Z',retrievalRunId:'run-1',traceId:'trace-1'};
 const a=createSourceSnapshot(input), b=createSourceSnapshot(input);
 assert.equal(a.snapshot_id,b.snapshot_id);
 assert.equal(a.immutable,true);
 assert.equal(a.raw_evidence_preserved,true);
 assert.equal(Object.isFrozen(a),true);
});
test('different raw evidence produces different provenance hash',()=>{
 const base={sourceId:'planalto',retrievedAt:'2026-10-06T21:00:00Z',retrievalRunId:'run-1',traceId:'trace-1'};
 assert.notEqual(createSourceSnapshot({...base,content:'v1'}).content_hash,createSourceSnapshot({...base,content:'v2'}).content_hash);
});
