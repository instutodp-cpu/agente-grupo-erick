'use strict';

const { createPostgresPublicWebCanaryAuditPersistence } = require('../adapters/postgres/public-web-canary-audit-persistence-postgres');
const { createPublicWebCanaryPersistentAuditSink } = require('../core/public-web-canary-persistent-audit-sink');
const { createPublicWebCanaryStagingBootstrap } = require('./public-web-canary-staging-bootstrap');
const { createPublicWebCanaryOperationalControls } = require('./public-web-canary-operational-controls');
const { createOperationalCanaryContext } = require('./public-web-canary-trial-dry-run');
const { prepareEmailReauthOperationalExecution } = require('../core/public-web-canary-email-reauth-operational-preparation');

const VERSION = 'public_web_canary_operational_postgres_bootstrap_v1';
function required(env,key){ const v=env?.[key]; if(typeof v!=='string'||v.trim()==='') throw new TypeError('postgres_environment_invalid'); return v; }

function createPublicWebCanaryOperationalPostgresBootstrap({environment=process.env,PoolClass, runtime={}}={}) {
  if(typeof PoolClass!=='function') throw new TypeError('postgres_pool_class_required');
  const port=Number(required(environment,'POSTGRES_PORT'));
  if(!Number.isInteger(port)||port<1||port>65535) throw new TypeError('postgres_environment_invalid');
  const pool=new PoolClass({host:'127.0.0.1',port,user:required(environment,'POSTGRES_USER'),password:required(environment,'POSTGRES_PASSWORD'),database:required(environment,'POSTGRES_DB')});
  const controls=createPublicWebCanaryOperationalControls({environment});
  const persistence=createPostgresPublicWebCanaryAuditPersistence({pool});
  const auditSink=createPublicWebCanaryPersistentAuditSink({persistence});
  if(runtime.production_allowed===true||runtime.production===true) { pool.end(); return Object.freeze({version:VERSION,bootstrap:Object.freeze({ok:false,blocked_reason:'production_blocked'}),controls,credential_material_present:false,network_call_performed:false,async close(){}}); }
  const staging=createPublicWebCanaryStagingBootstrap({...runtime,...controls,featureFlagResolver:controls.canaryFeatureFlagResolver,killSwitchResolver:controls.canaryKillSwitchResolver,auditSink,requireDurableAudit:true});
  let closed=false;
  function prepareEmailReauthExecution({durableComposition,plan,requested_at}={}) {
    if(!staging.ok) return Object.freeze({ok:false,status:'PUBLIC_WEB_CANARY_EMAIL_REAUTH_OPERATIONAL_PREPARATION_BLOCKED',reason:'operational_bootstrap_not_ready',execution_authorized:false,external_network_called:false,production_allowed:false});
    const operational=createOperationalCanaryContext(plan, staging);
    if(!operational.ok) return Object.freeze({ok:false,status:'PUBLIC_WEB_CANARY_EMAIL_REAUTH_OPERATIONAL_PREPARATION_BLOCKED',reason:'operational_context_blocked',contextResult:operational,execution_authorized:false,external_network_called:false,production_allowed:false});
    return prepareEmailReauthOperationalExecution({durableComposition,plan,operationalContext:operational.context,requested_at});
  }
  return Object.freeze({version:VERSION,bootstrap:staging,controls,credential_material_present:false,network_call_performed:false,prepareEmailReauthExecution,async close(){if(!closed){closed=true;await pool.end();}}});
}
module.exports={VERSION,createPublicWebCanaryOperationalPostgresBootstrap};
