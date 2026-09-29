'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {COMPOSITION_VERSION,createHermesMaintainerScmWritePostgresPersistenceComposition}=require('../src/core/hermes-maintainer-scm-write-postgres-persistence-composition');

const digest='sha256:'+'1'.repeat(64);
const key=digest+'::auth-1';
function request(){return {contract_version:'hermes_maintainer_scm_write_persistence_contract_v1',status:'SCM_WRITE_PERSISTENCE_REQUEST_PREPARED',request_valid:true,persistence_operation:'CREATE_IF_ABSENT',atomic_create_if_absent_required:true,durable_confirmation_required:true,persistence_key:key,intent_digest:digest,authorization_reference:'auth-1',consumption_reference:'consume-1',execution_authorized:false,network_call_performed:false,write_performed:false,production_used:false};}
function poolWith(insertRows){
 const client={query:async(sql)=>sql.includes('INSERT INTO')?{rows:insertRows}:sql.startsWith('SELECT ')?{rows:insertRows.length?[{persistence_key:key,intent_digest:digest,authorization_reference:'auth-1',consumption_reference:'consume-1'}]:[]}:{rows:[]},release(){}};
 return {connect:async()=>client,query:async()=>({rows:[{persistence_key:key,intent_digest:digest,authorization_reference:'auth-1',consumption_reference:'consume-1'}]})};
}

test('composes Postgres durable consumption backend into the official adapter',async()=>{
 const composition=createHermesMaintainerScmWritePostgresPersistenceComposition({pool:poolWith([{persistence_key:key}])});
 assert.equal(composition.composition_version,COMPOSITION_VERSION);
 assert.equal(composition.persistence_backend,'POSTGRES');
 assert.equal(composition.durable_consumption_enabled,true);
 assert.equal(composition.credential_resolution_enabled,false);
 assert.equal(composition.github_transport_enabled,false);
 assert.equal(composition.execution_enabled,false);
 const out=await composition.adapter.persist(request());
 assert.equal(out.status,'SCM_WRITE_PERSISTENCE_CREATED');
 assert.equal(out.durable,true);
 assert.equal(out.created,true);
 assert.equal(out.execution_authorized,false);
 assert.equal(out.network_call_performed,false);
 assert.equal(out.write_performed,false);
});

test('fails closed when consumption already exists',async()=>{
 const out=await createHermesMaintainerScmWritePostgresPersistenceComposition({pool:poolWith([])}).adapter.persist(request());
 assert.equal(out.status,'SCM_WRITE_PERSISTENCE_EXISTS');
 assert.equal(out.durable,false);
 assert.equal(out.created,false);
});

test('requires an injected Postgres pool',()=>{
 assert.throws(()=>createHermesMaintainerScmWritePostgresPersistenceComposition(),/postgres_pool_required/);
});
