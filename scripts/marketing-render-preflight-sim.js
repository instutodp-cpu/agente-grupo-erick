const assert=require('node:assert/strict');
const crypto=require('node:crypto');

const REQUIRED=['content_qa','evidence_qa','brand_qa','text_fit_qa','layout_qa','timing_qa','frame_qa'];

function stable(value){
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
 return value;
}
function manifestHash(manifest){
 const clean={...manifest};delete clean.manifest_hash;delete clean.status;
 return crypto.createHash('sha256').update(JSON.stringify(stable(clean))).digest('hex');
}
function preflight(manifest){
 const failed=[],missing=[];
 for(const k of REQUIRED){if(!(k in (manifest.preflight||{})))missing.push(k);else if(manifest.preflight[k]!==true)failed.push(k)}
 const pass=!failed.length&&!missing.length;
 return {pass,failed,missing,status:pass?'ready_for_render_job':'blocked_preflight'};
}
function prepareRenderJob(manifest,adapter){
 const pf=preflight(manifest); if(!pf.pass)return {status:'blocked',reason:'preflight_failed',failed:pf.failed,missing:pf.missing,external_execution:false,publish:false};
 const hash=manifestHash(manifest);
 return {job_id:'simulation-'+hash.slice(0,12),manifest_id:manifest.manifest_id,manifest_hash:hash,adapter,mode:'simulation',external_execution:false,publish:false,credential_refs:[],status:'prepared'};
}
function verifyJobIntegrity(manifest,job){return manifestHash(manifest)===job.manifest_hash}
function run(){
 const m={manifest_id:'m1',content_id:'c1',render_spec_ref:'r1',canvas_profile_ref:'cv1',brand_profile_ref:'b1',preflight:Object.fromEntries(REQUIRED.map(k=>[k,true]))};
 const job=prepareRenderJob(m,'remotion');assert.equal(job.status,'prepared');assert.equal(job.external_execution,false);assert.equal(job.publish,false);assert.deepEqual(job.credential_refs,[]);assert.equal(verifyJobIntegrity(m,job),true);
 const changed={...m,content_id:'c2'};assert.equal(verifyJobIntegrity(changed,job),false);
 const bad={...m,preflight:{...m.preflight,frame_qa:false}};assert.equal(prepareRenderJob(bad,'canva').status,'blocked');
 console.log('Marketing C05 render manifest/preflight simulation: PASS');
}
if(require.main===module)run();
module.exports={REQUIRED,stable,manifestHash,preflight,prepareRenderJob,verifyJobIntegrity};
