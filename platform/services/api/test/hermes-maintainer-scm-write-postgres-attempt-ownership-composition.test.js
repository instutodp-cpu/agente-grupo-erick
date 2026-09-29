'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {COMPOSITION_VERSION,createHermesMaintainerScmWritePostgresAttemptOwnershipComposition}=require('../src/core/hermes-maintainer-scm-write-postgres-attempt-ownership-composition');

const digest='sha256:'+'1'.repeat(64);
function request(){return {contract_version:'hermes_maintainer_scm_write_attempt_ownership_persistence_contract_v1',status:'SCM_WRITE_ATTEMPT_OWNERSHIP_PERSISTENCE_REQUEST_PREPARED',request_valid:true,persistence_operation:'CREATE_IF_ABSENT',atomic_create_if_absent_required:true,durable_confirmation_required:true,ownership_key:'p1::attempt-ownership',persistence_key:'p1',intent_digest:digest,attempt_reference:'a1',ownership_exclusive:false,execution_authorized:false,network_call_performed:false,write_performed:false,production_used:false};}
function poolWith(insertRows){
 const client={query:async(sql)=>sql.includes('INSERT INTO')?{rows:insertRows}:sql.startsWith('SELECT ')?{rows:insertRows.length?[{ownership_key:'p1::attempt-ownership',persistence_key:'p1',intent_digest:digest,attempt_reference:'a1'}]:[]}:{rows:[]},release(){}};
 return {connect:async()=>client,query:async()=>({rows:[{ownership_key:'p1::attempt-ownership',persistence_key:'p1',intent_digest:digest,attempt_reference:'a1'}]})};
}

test('composes Postgres ownership backend into the official adapter',async()=>{
 const composition=createHermesMaintainerScmWritePostgresAttemptOwnershipComposition({pool:poolWith([{ownership_key:'p1::attempt-ownership'}])});
 assert.equal(composition.composition_version,COMPOSITION_VERSION);
 assert.equal(composition.persistence_backend,'POSTGRES');
 assert.equal(composition.durable_ownership_enabled,true);
 assert.equal(composition.credential_resolution_enabled,false);
 assert.equal(composition.github_transport_enabled,false);
 assert.equal(composition.execution_enabled,false);
 const out=await composition.adapter.persist(request());
 assert.equal(out.status,'SCM_WRITE_ATTEMPT_OWNERSHIP_PERSISTENCE_CREATED');
 assert.equal(out.durable,true);
 assert.equal(out.ownership_exclusive,true);
 assert.equal(out.execution_authorized,false);
 assert.equal(out.network_call_performed,false);
 assert.equal(out.write_performed,false);
});

test('fails closed when ownership already exists',async()=>{
 const out=await createHermesMaintainerScmWritePostgresAttemptOwnershipComposition({pool:poolWith([])}).adapter.persist(request());
 assert.equal(out.status,'SCM_WRITE_ATTEMPT_OWNERSHIP_PERSISTENCE_EXISTS');
 assert.equal(out.durable,false);
 assert.equal(out.ownership_exclusive,false);
});

test('requires an injected Postgres pool',()=>{
 assert.throws(()=>createHermesMaintainerScmWritePostgresAttemptOwnershipComposition(),/postgres_pool_required/);
});
