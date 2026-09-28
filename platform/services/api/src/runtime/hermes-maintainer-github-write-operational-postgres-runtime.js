'use strict';

const {Pool}=require('pg');
const {createHermesMaintainerGithubWriteOperationalCanaryComposition}=require('./hermes-maintainer-github-write-operational-canary-composition');

const RUNTIME_VERSION='hermes_maintainer_github_write_operational_postgres_runtime_v1';

function required(env,key){
 const value=env?.[key];
 if(typeof value!=='string'||value.trim()==='')throw new TypeError('postgres_environment_invalid');
 return value;
}

function createHermesMaintainerGithubWriteOperationalPostgresRuntime({environment=process.env,PoolClass=Pool,fetchImpl=globalThis.fetch,createTimeoutSignal=AbortSignal.timeout}={}){
 if(typeof PoolClass!=='function')throw new TypeError('postgres_pool_class_required');
 const port=Number(required(environment,'POSTGRES_PORT'));
 if(!Number.isInteger(port)||port<1||port>65535)throw new TypeError('postgres_environment_invalid');
 const pool=new PoolClass({
  host:'127.0.0.1',
  port,
  user:required(environment,'POSTGRES_USER'),
  password:required(environment,'POSTGRES_PASSWORD'),
  database:required(environment,'POSTGRES_DB')
 });
 const composition=createHermesMaintainerGithubWriteOperationalCanaryComposition({pool,environment,fetchImpl,createTimeoutSignal});
 return Object.freeze({
  runtime_version:RUNTIME_VERSION,
  environment:'staging',
  credential_material_present:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  execute:composition.execute,
  async close(){await pool.end();}
 });
}

module.exports={RUNTIME_VERSION,createHermesMaintainerGithubWriteOperationalPostgresRuntime};
