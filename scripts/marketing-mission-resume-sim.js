const crypto=require('node:crypto');const assert=require('node:assert/strict');const stages=['objective','research','creative','production','qa','approval','distribution','measurement','learning','replanning'];
function payload(c){return JSON.stringify({run_id:c.run_id,mission_id:c.mission_id,scope_hash:c.scope_hash,completed_stages:c.completed_stages,next_stage:c.next_stage,stage_evidence:c.stage_evidence})}
function hash(c){return crypto.createHash('sha256').update(payload(c)).digest('hex')}
function makeCheckpoint(base){const c={...base,simulation:true,external_execution:false};return{...c,checkpoint_hash:hash(c)}}
function resume(c,expectedScope){
 if(hash(c)!==c.checkpoint_hash)return decision(c,'blocked_integrity',null,'checkpoint_hash_mismatch');
 if(c.scope_hash!==expectedScope)return decision(c,'blocked_scope',null,'scope_mismatch');
 const completed=c.completed_stages||[];for(let x=0;x<completed.length;x++){if(completed[x]!==stages[x])return decision(c,'blocked_sequence',null,'non_contiguous_stages');if(!c.stage_evidence?.[completed[x]])return decision(c,'blocked_sequence',null,'missing_stage_evidence')}
 if(completed.length===stages.length)return decision(c,'completed',null,null);
 const expected=stages[completed.length];if(c.next_stage!==expected)return decision(c,'blocked_sequence',null,'next_stage_mismatch');
 return decision(c,'resume',expected,null);
}
function decision(c,d,s,reason){return{run_id:c.run_id,decision:d,resume_stage:s,checkpoint_ref:c.checkpoint_id,reason,simulation:true,external_execution:false}}
function sample(){return makeCheckpoint({checkpoint_id:'cp1',run_id:'r1',mission_id:'m1',scope_hash:'scope1',completed_stages:['objective','research','creative','production','qa'],next_stage:'approval',stage_evidence:{objective:'e1',research:'e2',creative:'e3',production:'e4',qa:'e5'}})}
function main(){assert.equal(resume(sample(),'scope1').resume_stage,'approval');console.log('Marketing C09 mission resume simulation: PASS')}if(require.main===module)main();module.exports={makeCheckpoint,resume,sample};
