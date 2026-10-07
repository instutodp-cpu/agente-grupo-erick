'use strict';

const { createPostgresPublicWebCanaryAuditPersistence } = require('../adapters/postgres/public-web-canary-audit-persistence-postgres');
const { createPublicWebCanaryPersistentAuditSink } = require('../core/public-web-canary-persistent-audit-sink');
const { createPublicWebCanaryStagingBootstrap } = require('./public-web-canary-staging-bootstrap');

const VERSION = 'public_web_canary_operational_postgres_bootstrap_v1';
function required(env,key){ const v=env?.[key]; if(typeof v!=='string'||v.trim()==='') throw new TypeError('postgres_environment_invalid'); return v; }

function createPublicWebCanaryOperationalPostgresBootstrap({environment=process.env,PoolClass, runtime={}}={}) {
  if(typeof PoolClass!=='function') throw new TypeError('postgres_pool_class_required');
  const port=Number(required(environment,'POSTGRES_PORT'));
  if(!Number.isInteger(port)||port<1||port>65535) throw new TypeError('postgres_environment_invalid');
  const pool=new PoolClass({host:'127.0.0.1',port,user:required(environment,'POSTGRES_USER'),password:required(environment,'POSTGRES_PASSWORD'),database:required(environment,'POSTGRES_DB')});
  const persistence=createPostgresPublicWebCanaryAuditPersistence({pool});
  const auditSink=createPublicWebCanaryPersistentAuditSink({persistence});
  const staging=createPublicWebCanaryStagingBootstrap({...runtime,auditSink,requireDurableAudit:true});
  let closed=false;
  return Object.freeze({version:VERSION,bootstrap:staging,credential_material_present:false,network_call_performed:false,async close(){if(!closed){closed=true;await pool.end();}}});
}
module.exports={VERSION,createPublicWebCanaryOperationalPostgresBootstrap};
