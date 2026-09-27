'use strict';

const {createHermesMaintainerScmWriteAttemptOwnershipPersistenceAdapter}=require('./hermes-maintainer-scm-write-attempt-ownership-persistence-adapter');
const {createHermesMaintainerScmWritePostgresAttemptOwnershipPersistence}=require('./hermes-maintainer-scm-write-postgres-attempt-ownership-persistence');

const COMPOSITION_VERSION='hermes_maintainer_scm_write_postgres_attempt_ownership_composition_v1';

function createHermesMaintainerScmWritePostgresAttemptOwnershipComposition({pool}={}){
 if(!pool||typeof pool.connect!=='function'||typeof pool.query!=='function')throw new TypeError('postgres_pool_required');
 const backend=createHermesMaintainerScmWritePostgresAttemptOwnershipPersistence({pool});
 const adapter=createHermesMaintainerScmWriteAttemptOwnershipPersistenceAdapter({createIfAbsent:backend.createIfAbsent});
 return Object.freeze({
  composition_version:COMPOSITION_VERSION,
  persistence_backend:'POSTGRES',
  durable_ownership_enabled:true,
  credential_resolution_enabled:false,
  github_transport_enabled:false,
  execution_enabled:false,
  backend,
  adapter
 });
}

module.exports={COMPOSITION_VERSION,createHermesMaintainerScmWritePostgresAttemptOwnershipComposition};
