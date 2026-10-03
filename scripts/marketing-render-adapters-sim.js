const assert=require('node:assert/strict');const reg=require('../marketing/registry/render-adapters.json');
function route(job){
 const a=reg.adapters.find(x=>x.adapter_id===job.adapter_id);if(!a)return deny('unknown_adapter');
 if(!a.operations.includes(job.operation))return deny('operation_not_allowed');
 if(job.simulation!==true)return deny('simulation_required');
 if(!job.brand_profile_ref)return deny('brand_profile_missing');
 if(!job.render_manifest_ref)return deny('manifest_missing');
 if(!job.artifact_hash)return deny('artifact_hash_missing');
 if(job.preflight_passed!==true)return deny('c05_preflight_failed');
 return {status:'simulated_render_ready',adapter_id:a.adapter_id,provider_kind:a.provider_kind,operation:job.operation,artifact_hash:job.artifact_hash,external_render:false,approvable:true};
}
function deny(reason){return {status:'denied',reason,external_render:false,approvable:false}}
function run(){const b={simulation:true,brand_profile_ref:'bp1',render_manifest_ref:'rm1',artifact_hash:'sha256:x',preflight_passed:true};assert.equal(route({...b,adapter_id:'render.canva',operation:'render_static'}).approvable,true);assert.equal(route({...b,adapter_id:'render.remotion',operation:'render_video',preflight_passed:false}).reason,'c05_preflight_failed');assert.equal(route({...b,adapter_id:'render.ffmpeg',operation:'burn_captions'}).external_render,false);console.log('Marketing C08 render adapters simulation: PASS')}
if(require.main===module)run();module.exports={route};
