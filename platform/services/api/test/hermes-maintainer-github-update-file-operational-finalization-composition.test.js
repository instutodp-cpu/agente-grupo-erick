'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createHermesMaintainerGithubUpdateFileFinalizationPostgresPersistenceComposition}=require('../src/core/hermes-maintainer-github-update-file-finalization-postgres-persistence-composition');
const {createHermesMaintainerGithubUpdateFileOperationalFinalizationComposition}=require('../src/runtime/hermes-maintainer-github-update-file-operational-finalization-composition');
test('finalization postgres composition requires durable pool',()=>{assert.throws(()=>createHermesMaintainerGithubUpdateFileFinalizationPostgresPersistenceComposition({}),/postgres_pool_required/);});
test('operational finalization requires durable pool',()=>{assert.throws(()=>createHermesMaintainerGithubUpdateFileOperationalFinalizationComposition({}),/postgres_pool_required/);});
test('finalization postgres composition remains persistence-only',()=>{const pool={connect(){},query(){}};const c=createHermesMaintainerGithubUpdateFileFinalizationPostgresPersistenceComposition({pool});assert.equal(c.persistence_backend,'POSTGRES');assert.equal(c.durable_finalization_enabled,true);assert.equal(c.credential_resolution_enabled,false);assert.equal(c.github_transport_enabled,false);assert.equal(c.execution_enabled,false);});
