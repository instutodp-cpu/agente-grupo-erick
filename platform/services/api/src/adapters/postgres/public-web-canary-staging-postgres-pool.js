'use strict';
const fs=require('node:fs');
const path=require('node:path');
function required(env,key){const v=env?.[key];if(typeof v!=='string'||v.trim()==='')throw new TypeError('postgres_environment_invalid');return v;}
function secret(env){const direct=env?.POSTGRES_PASSWORD;if(typeof direct==='string'&&direct.trim()!=='')return direct;const file=env?.POSTGRES_PASSWORD_FILE;if(typeof file!=='string'||file.trim()===''||!path.isAbsolute(file))throw new TypeError('postgres_environment_invalid');const value=fs.readFileSync(file,'utf8').trim();if(value==='')throw new TypeError('postgres_environment_invalid');return value;}
function createPublicWebCanaryStagingPostgresPool({environment=process.env,PoolClass}={}){
 if(typeof PoolClass!=='function')throw new TypeError('postgres_pool_class_required');
 const port=Number(required(environment,'POSTGRES_PORT'));if(!Number.isInteger(port)||port<1||port>65535)throw new TypeError('postgres_environment_invalid');
 const host=required(environment,'POSTGRES_HOST');const user=required(environment,'POSTGRES_USER');const database=required(environment,'POSTGRES_DB');const caPath=required(environment,'HERMES_STAGING_CA_FILE');
 const direct=host==='db.vvzvqinbzdqzcwrfoomd.supabase.co'&&port===5432&&user==='postgres';
 const pooler=host==='aws-0-sa-east-1.pooler.supabase.com'&&port===5432&&user==='postgres.vvzvqinbzdqzcwrfoomd';
 if((!direct&&!pooler)||database!=='postgres'||!path.isAbsolute(caPath))throw new TypeError('staging_postgres_identity_invalid');
 const ca=fs.readFileSync(caPath,'utf8');if(!ca.includes('BEGIN CERTIFICATE'))throw new TypeError('staging_postgres_ca_invalid');
 return new PoolClass({host,port,user,password:secret(environment),database,ssl:{ca,rejectUnauthorized:true,servername:host}});
}
module.exports={createPublicWebCanaryStagingPostgresPool};
