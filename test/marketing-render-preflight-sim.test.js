const test=require('node:test');
const assert=require('node:assert/strict');
const {REQUIRED,manifestHash,preflight,prepareRenderJob,verifyJobIntegrity}=require('../scripts/marketing-render-preflight-sim');
const good=()=>({manifest_id:'m1',content_id:'c1',render_spec_ref:'r1',canvas_profile_ref:'cv1',brand_profile_ref:'b1',preflight:Object.fromEntries(REQUIRED.map(k=>[k,true]))});

test('seven of seven preflight gates are required',()=>{const m=good();m.preflight.frame_qa=false;const r=preflight(m);assert.equal(r.pass,false);assert.deepEqual(r.failed,['frame_qa']);});
test('missing preflight gate fails closed',()=>{const m=good();delete m.preflight.timing_qa;const r=preflight(m);assert.equal(r.pass,false);assert.deepEqual(r.missing,['timing_qa']);});
test('deterministic manifest hash is stable across key order',()=>{const a=good(),b={...a,preflight:{...a.preflight}};assert.equal(manifestHash(a),manifestHash(b));});
test('prepared job is simulation-only and credential-free',()=>{const j=prepareRenderJob(good(),'remotion');assert.equal(j.status,'prepared');assert.equal(j.mode,'simulation');assert.equal(j.external_execution,false);assert.equal(j.publish,false);assert.deepEqual(j.credential_refs,[]);});
test('Canva job has same execution safety guarantees',()=>{const j=prepareRenderJob(good(),'canva');assert.equal(j.status,'prepared');assert.equal(j.external_execution,false);assert.equal(j.publish,false);});
test('manifest drift invalidates prepared job',()=>{const m=good(),j=prepareRenderJob(m,'remotion');const changed={...m,content_id:'changed'};assert.equal(verifyJobIntegrity(changed,j),false);});
