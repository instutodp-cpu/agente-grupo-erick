'use strict';

const {createHermesMaintainerScmWritePersistenceAdapter}=require('./hermes-maintainer-scm-write-persistence-adapter');
const {createHermesMaintainerScmWritePostgresPersistence}=require('./hermes-maintainer-scm-write-postgres-persistence');

const COMPOSITION_VERSION='hermes_maintainer_scm_write_postgres_persistence_composition_v1';

function createHermesMaintainerScmWritePostgresPersistenceComposition({pool}={}){
 if(!pool||typeof pool.connect!=='function'||typeof pool.query!=='function')throw new TypeError('postgres_pool_required');
 const backend=createHermesMaintainerScmWritePostgresPersistence({pool});
 const adapter=createHermesMaintainerScmWritePersistenceAdapter({createIfAbsent:backend.createIfAbsent});
 return Object.freeze({
  composition_version:COMPOSITION_VERSION,
  persistence_backend:'POSTGRES',
  durable_consumption_enabled:true,
  credential_resolution_enabled:false,
  github_transport_enabled:false,
  execution_enabled:false,
  backend,
  adapter
 });
}

module.exports={COMPOSITION_VERSION,createHermesMaintainerScmWritePostgresPersistenceComposition};
