'use strict';

const {createHermesMaintainerGithubWriteFinalizationPersistenceAdapter}=require('./hermes-maintainer-github-write-finalization-persistence-adapter');
const {createHermesMaintainerGithubWriteFinalizationPostgresPersistence}=require('./hermes-maintainer-github-write-finalization-postgres-persistence');

const COMPOSITION_VERSION='hermes_maintainer_github_write_finalization_postgres_persistence_composition_v1';

function createHermesMaintainerGithubWriteFinalizationPostgresPersistenceComposition({pool}={}){
 if(!pool||typeof pool.connect!=='function'||typeof pool.query!=='function')throw new TypeError('postgres_pool_required');
 const backend=createHermesMaintainerGithubWriteFinalizationPostgresPersistence({pool});
 const adapter=createHermesMaintainerGithubWriteFinalizationPersistenceAdapter({createIfAbsent:backend.createIfAbsent});
 return Object.freeze({
  composition_version:COMPOSITION_VERSION,
  persistence_backend:'POSTGRES',
  durable_finalization_enabled:true,
  credential_resolution_enabled:false,
  github_transport_enabled:false,
  execution_enabled:false,
  backend,
  adapter
 });
}

module.exports={COMPOSITION_VERSION,createHermesMaintainerGithubWriteFinalizationPostgresPersistenceComposition};
