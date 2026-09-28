'use strict';

const {createHermesMaintainerGithubWriteExecutionOutcomePersistenceAdapter}=require('./hermes-maintainer-github-write-execution-outcome-persistence-adapter');
const {createHermesMaintainerGithubWriteExecutionOutcomePostgresPersistence}=require('./hermes-maintainer-github-write-execution-outcome-postgres-persistence');

const COMPOSITION_VERSION='hermes_maintainer_github_write_execution_outcome_postgres_persistence_composition_v1';

function createHermesMaintainerGithubWriteExecutionOutcomePostgresPersistenceComposition({pool}={}){
 if(!pool||typeof pool.connect!=='function'||typeof pool.query!=='function')throw new TypeError('postgres_pool_required');
 const backend=createHermesMaintainerGithubWriteExecutionOutcomePostgresPersistence({pool});
 const adapter=createHermesMaintainerGithubWriteExecutionOutcomePersistenceAdapter({createIfAbsent:backend.createIfAbsent});
 return Object.freeze({
  composition_version:COMPOSITION_VERSION,
  persistence_backend:'POSTGRES',
  durable_outcome_enabled:true,
  credential_resolution_enabled:false,
  github_transport_enabled:false,
  execution_enabled:false,
  backend,
  adapter
 });
}

module.exports={COMPOSITION_VERSION,createHermesMaintainerGithubWriteExecutionOutcomePostgresPersistenceComposition};
