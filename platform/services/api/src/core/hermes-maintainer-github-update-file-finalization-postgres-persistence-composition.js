'use strict';
const {createHermesMaintainerGithubUpdateFileFinalizationPersistenceAdapter}=require('./hermes-maintainer-github-update-file-finalization-persistence-adapter');
const {createHermesMaintainerGithubUpdateFileFinalizationPostgresPersistence}=require('./hermes-maintainer-github-update-file-finalization-postgres-persistence');
const COMPOSITION_VERSION='hermes_maintainer_github_update_file_finalization_postgres_persistence_composition_v1';
function createHermesMaintainerGithubUpdateFileFinalizationPostgresPersistenceComposition({pool}={}){
 if(!pool||typeof pool.connect!=='function'||typeof pool.query!=='function')throw new TypeError('postgres_pool_required');
 const backend=createHermesMaintainerGithubUpdateFileFinalizationPostgresPersistence({pool});
 const adapter=createHermesMaintainerGithubUpdateFileFinalizationPersistenceAdapter({createIfAbsent:backend.createIfAbsent});
 return Object.freeze({composition_version:COMPOSITION_VERSION,persistence_backend:'POSTGRES',durable_finalization_enabled:true,credential_resolution_enabled:false,github_transport_enabled:false,execution_enabled:false,backend,adapter});
}
module.exports={COMPOSITION_VERSION,createHermesMaintainerGithubUpdateFileFinalizationPostgresPersistenceComposition};
