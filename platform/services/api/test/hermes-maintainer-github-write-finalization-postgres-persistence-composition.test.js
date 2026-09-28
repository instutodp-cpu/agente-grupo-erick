'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {COMPOSITION_VERSION,createHermesMaintainerGithubWriteFinalizationPostgresPersistenceComposition}=require('../src/core/hermes-maintainer-github-write-finalization-postgres-persistence-composition');

function pool(){return {connect:async()=>{throw new Error('must not connect during composition');},query:async()=>{throw new Error('must not query during composition');}};}

test('composes official Postgres finalization backend into official persistence adapter without side effects',()=>{
 const composed=createHermesMaintainerGithubWriteFinalizationPostgresPersistenceComposition({pool:pool()});
 assert.equal(COMPOSITION_VERSION,'hermes_maintainer_github_write_finalization_postgres_persistence_composition_v1');
 assert.equal(composed.composition_version,COMPOSITION_VERSION);
 assert.equal(composed.persistence_backend,'POSTGRES');
 assert.equal(composed.durable_finalization_enabled,true);
 assert.equal(composed.credential_resolution_enabled,false);
 assert.equal(composed.github_transport_enabled,false);
 assert.equal(composed.execution_enabled,false);
 assert.equal(typeof composed.backend.createIfAbsent,'function');
 assert.equal(typeof composed.adapter.persist,'function');
 assert.equal(Object.isFrozen(composed),true);
});

test('fails closed without a configured Postgres pool',()=>{
 for(const value of [undefined,null,{}, {connect(){}}]) assert.throws(()=>createHermesMaintainerGithubWriteFinalizationPostgresPersistenceComposition({pool:value}),/postgres_pool_required/);
});
