const assert=require('node:assert/strict');const reg=require('../marketing/registry/read-adapters.json');
const MUTATION_WORDS=['publish','send','create','update','delete','budget','pause'];
function read(req){
 const a=reg.adapters.find(x=>x.adapter_id===req.adapter_id);if(!a)return {status:'denied',reason:'unknown_adapter',network_execution:false};
 if(!a.operations.includes(req.operation))return {status:'denied',reason:MUTATION_WORDS.some(w=>req.operation.includes(w))?'mutation_denied':'operation_not_allowed',network_execution:false};
 if(req.account_scope==null&&a.family==='analytics')return {status:'denied',reason:'account_scope_required',network_execution:false};
 const data=req.mock_data??null;return {status:'simulated_read',adapter_id:a.adapter_id,account_scope:req.account_scope??null,source_ref:req.source_ref,retrieved_at:req.retrieved_at,data,network_execution:false};
}
function metric(receipt,key){if(!receipt.data||receipt.data[key]==null)return null;return receipt.data[key]}
function run(){const r=read({adapter_id:'research.firecrawl',operation:'search',source_ref:'src1',retrieved_at:'2026-10-02T00:00:00Z',mock_data:{items:3}});assert.equal(r.status,'simulated_read');assert.equal(r.network_execution,false);assert.equal(read({adapter_id:'research.firecrawl',operation:'publish',source_ref:'x',retrieved_at:'x'}).reason,'mutation_denied');const a=read({adapter_id:'analytics.meta',operation:'read_metrics',account_scope:'acct1',source_ref:'m1',retrieved_at:'2026-10-02T00:00:00Z',mock_data:{views:100}});assert.equal(metric(a,'sales'),null);console.log('Marketing C08 read adapters simulation: PASS')}
if(require.main===module)run();module.exports={read,metric};
