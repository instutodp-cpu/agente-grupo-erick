'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {INSERT_SQL,SELECT_SQL,createHermesMaintainerScmWritePostgresPersistence}=require('../src/core/hermes-maintainer-scm-write-postgres-persistence');
function input(){return {key:'sha256:'+'1'.repeat(64)+'::auth-1',intent_digest:'sha256:'+'1'.repeat(64),authorization_reference:'auth-1',consumption_reference:'consume-1'};}

test('uses atomic insert and confirms committed consumption on the acquired client',async()=>{
 assert.match(INSERT_SQL,/ON CONFLICT \(persistence_key\) DO NOTHING/);
 let released=0;
 const client={query:async(sql)=>sql==='BEGIN'||sql==='COMMIT'?{rows:[]}:sql===INSERT_SQL?{rows:[{persistence_key:input().key}]}:sql===SELECT_SQL?{rows:[{persistence_key:input().key,intent_digest:input().intent_digest,authorization_reference:'auth-1',consumption_reference:'consume-1'}]}:{rows:[]},release:()=>released++};
 const pool={connect:async()=>client,query:async()=>{throw new Error('max_one_pool_reentry_forbidden')}};
 const out=await createHermesMaintainerScmWritePostgresPersistence({pool}).createIfAbsent(input());
 assert.deepEqual(out,{status:'CREATED',durable:true});assert.equal(released,1);
});

test('fails closed when consumption already exists',async()=>{
 const client={query:async(sql)=>sql===INSERT_SQL?{rows:[]}:{rows:[]},release:()=>{}};
 const pool={connect:async()=>client,query:async()=>{throw new Error('must not confirm')}};
 assert.deepEqual(await createHermesMaintainerScmWritePostgresPersistence({pool}).createIfAbsent(input()),{status:'EXISTS',durable:false});
});

test('does not claim durability when post-commit confirmation mismatches',async()=>{
 const client={query:async(sql)=>sql===INSERT_SQL?{rows:[{persistence_key:input().key}]}:sql===SELECT_SQL?{rows:[{...input(),consumption_reference:'other'}]}:{rows:[]},release:()=>{}};
 const pool={connect:async()=>client,query:async()=>{throw new Error('max_one_pool_reentry_forbidden')}};
 assert.deepEqual(await createHermesMaintainerScmWritePostgresPersistence({pool}).createIfAbsent(input()),{status:'UNCONFIRMED',durable:false});
});

test('sanitizes backend failures and rejects invalid input',async()=>{
 const pool={connect:async()=>{throw new Error('secret-db-value')},query:async()=>{}};
 const persistence=createHermesMaintainerScmWritePostgresPersistence({pool});
 assert.deepEqual(await persistence.createIfAbsent(input()),{status:'FAILED',durable:false});
 assert.deepEqual(await persistence.createIfAbsent({...input(),intent_digest:'sha256:bad'}),{status:'INVALID',durable:false});
});
