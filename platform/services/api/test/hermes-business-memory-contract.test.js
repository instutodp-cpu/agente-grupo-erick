'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const memory=require('../src/runtime/hermes-business-evidence-memory');
const analyst=require('../src/runtime/hermes-analyst-templates');
test('enterprise evidence memory rejects inconsistent comparison dimensions and product periods',()=>{
 const now=Date.parse('2026-11-12T02:00:00Z');
 const base={kind:memory.KIND,tenant_id:memory.TENANT,scope:'enterprise',
  key:'a'.repeat(24),at:'2026-11-11T02:00:00Z',period:'2026-05',
  other_period:null,template:'period',metric:'records',source:analyst.SOURCE,
  summary:'📊 Hermes — análise histórica Grupo Erick\nFonte: agregados históricos verificados'};
 assert.equal(memory.validEntry(base,now),base);
 for(const changes of [
  {template:'compare'},
  {template:'compare',other_period:'2026-05'},
  {template:'compare',other_period:'2025'},
  {other_period:'2025-05'},
  {template:'products',period:'2025-05',source:analyst.PRODUCT_SOURCE},
  {tenant_id:'personal'},
  {scope:'personal'}
 ])assert.throws(()=>memory.validEntry({...base,...changes},now),/memory_entry_denied/);
});
