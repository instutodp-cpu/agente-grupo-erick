'use strict';

const {Pool}=require('pg');
const {createHermesMaintainerGithubWriteE2eDurableClosure}=require('./hermes-maintainer-github-write-e2e-durable-closure');

const RUNTIME_VERSION='hermes_maintainer_github_write_e2e_postgres_runtime_v1';

function required(env,key){
 const value=env?.[key];
 if(typeof value!=='string'||value.trim()==='')throw new TypeError('postgres_environment_invalid');
 return value;
}

function createHermesMaintainerGithubWriteE2ePostgresRuntime({environment=process.env,PoolClass=Pool,fetchImpl=globalThis.fetch,createTimeoutSignal=AbortSignal.timeout}={}){
 if(typeof PoolClass!=='function')throw new TypeError('postgres_pool_class_required');
 const port=Number(required(environment,'POSTGRES_PORT'));
 if(!Number.isInteger(port)||port<1||port>65535)throw new TypeError('postgres_environment_invalid');
 const pool=new PoolClass({host:'127.0.0.1',port,user:required(environment,'POSTGRES_USER'),password:required(environment,'POSTGRES_PASSWORD'),database:required(environment,'POSTGRES_DB')});
 const closure=createHermesMaintainerGithubWriteE2eDurableClosure({pool,environment,fetchImpl,createTimeoutSignal});
 return Object.freeze({runtime_version:RUNTIME_VERSION,environment:'staging',credential_reference:closure.credential_reference,credential_material_present:false,network_call_performed:false,write_performed:false,production_used:false,execute:closure.execute,async close(){await pool.end();}});
}

module.exports={RUNTIME_VERSION,createHermesMaintainerGithubWriteE2ePostgresRuntime};
