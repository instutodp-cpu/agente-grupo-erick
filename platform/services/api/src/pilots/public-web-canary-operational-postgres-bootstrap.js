'use strict';

const { randomUUID } = require('node:crypto');

const { createPostgresPublicWebCanaryAuditPersistence } = require('../adapters/postgres/public-web-canary-audit-persistence-postgres');
const { createPublicWebCanaryPersistentAuditSink } = require('../core/public-web-canary-persistent-audit-sink');
const { createPublicWebCanaryStagingBootstrap } = require('./public-web-canary-staging-bootstrap');
const { createPublicWebCanaryOperationalControls } = require('./public-web-canary-operational-controls');
const { createPublicWebCanaryOperationalBindings } = require('./public-web-canary-operational-bindings');
const { createOperationalCanaryContext } = require('./public-web-canary-trial-dry-run');
const { prepareEmailReauthOperationalExecution } = require('../core/public-web-canary-email-reauth-operational-preparation');
const { createStrongHumanReauthEmailEvidencePostgres } = require('../adapters/postgres/strong-human-reauth-email-evidence-postgres');
const { authorizePublicWebCanaryWithEmailReauth } = require('../core/public-web-canary-email-reauth-authorization');
const { buildEmailReauthRuntimeBinding } = require('../core/public-web-canary-email-reauth-runtime-binding');

const VERSION = 'public_web_canary_operational_postgres_bootstrap_v1';
function required(env,key){ const v=env?.[key]; if(typeof v!=='string'||v.trim()==='') throw new TypeError('postgres_environment_invalid'); return v; }

function createPublicWebCanaryOperationalPostgresBootstrap({environment=process.env,PoolClass, runtime={}}={}) {
  const singleUseIdFactory=typeof runtime.singleUseIdFactory==='function'?runtime.singleUseIdFactory:randomUUID;
  if(typeof PoolClass!=='function') throw new TypeError('postgres_pool_class_required');
  const port=Number(required(environment,'POSTGRES_PORT'));
  if(!Number.isInteger(port)||port<1||port>65535) throw new TypeError('postgres_environment_invalid');
  const pool=new PoolClass({host:'127.0.0.1',port,user:required(environment,'POSTGRES_USER'),password:required(environment,'POSTGRES_PASSWORD'),database:required(environment,'POSTGRES_DB')});
  const controls=createPublicWebCanaryOperationalControls({environment});
  const clock=typeof runtime.clock==='function'?runtime.clock:()=>new Date().toISOString();
  const bindings=createPublicWebCanaryOperationalBindings({controls,clock});
  const persistence=createPostgresPublicWebCanaryAuditPersistence({pool});
  const auditSink=createPublicWebCanaryPersistentAuditSink({persistence});
  if(runtime.production_allowed===true||runtime.production===true) { pool.end(); return Object.freeze({version:VERSION,bootstrap:Object.freeze({ok:false,blocked_reason:'production_blocked'}),controls,credential_material_present:false,network_call_performed:false,async close(){}}); }
  const staging=createPublicWebCanaryStagingBootstrap({...runtime,...bindings,...controls,clock,featureFlagResolver:controls.canaryFeatureFlagResolver,killSwitchResolver:controls.canaryKillSwitchResolver,auditSink,requireDurableAudit:true});
  const emailEvidenceStore=createStrongHumanReauthEmailEvidencePostgres({pool});
  let closed=false;
  async function resumeEmailReauthDurableComposition({evidence_key,authorizationInput}={}) {
    if(typeof evidence_key!=='string'||!evidence_key.startsWith('sha256:')) return Object.freeze({ok:false,status:'PUBLIC_WEB_CANARY_EMAIL_REAUTH_DURABLE_RESUME_BLOCKED',reason:'evidence_key_required',execution_authorized:false,external_network_called:false,production_allowed:false});
    const stored=await emailEvidenceStore.readVerified(evidence_key);
    if(!stored.ok||stored.durable!==true) return Object.freeze({ok:false,status:'PUBLIC_WEB_CANARY_EMAIL_REAUTH_DURABLE_RESUME_BLOCKED',reason:'verified_durable_evidence_required',execution_authorized:false,external_network_called:false,production_allowed:false});
    const receipt=Object.freeze({ok:true,status:'EMAIL_REAUTH_DURABLE_EVIDENCE_CONFIRMED',challenge_id:stored.challenge_id,action_digest:stored.action_digest,email_identity_reference:stored.email_identity_reference,subject_id:stored.subject_id,provider_event_reference:stored.provider_event_reference,verified_at:new Date(stored.verified_at).toISOString(),evidence_key:stored.evidence_key,single_use:true,durable:true,execution_authorized:false,production_allowed:false});
    const callerInput=authorizationInput&&typeof authorizationInput==='object'?authorizationInput:{};
    for(const forbidden of ['replay_key','request_reference','grant_nonce','reservation_nonce']) if(Object.prototype.hasOwnProperty.call(callerInput,forbidden)) return Object.freeze({ok:false,status:'PUBLIC_WEB_CANARY_EMAIL_REAUTH_DURABLE_RESUME_BLOCKED',reason:'caller_single_use_identity_forbidden',execution_authorized:false,external_network_called:false,production_allowed:false});
    const ids=['replay','request','grant','reservation'].map(label=>`${label}:${singleUseIdFactory()}`);
    if(new Set(ids).size!==4||ids.some(v=>typeof v!=='string'||v.length<9)) return Object.freeze({ok:false,status:'PUBLIC_WEB_CANARY_EMAIL_REAUTH_DURABLE_RESUME_BLOCKED',reason:'single_use_identity_generation_failed',execution_authorized:false,external_network_called:false,production_allowed:false});
    const [replay_key,request_reference,grant_nonce,reservation_nonce]=ids;
    const authorization=authorizePublicWebCanaryWithEmailReauth({...callerInput,replay_key,request_reference,grant_nonce,reservation_nonce,reauth:receipt});
    if(!authorization.ok) return Object.freeze({ok:false,status:'PUBLIC_WEB_CANARY_EMAIL_REAUTH_DURABLE_RESUME_BLOCKED',reason:'authorization_boundary_blocked',receipt,authorization,execution_authorized:false,external_network_called:false,production_allowed:false});
    const runtimeBinding=buildEmailReauthRuntimeBinding({tenant_id:authorizationInput?.tenant_id,action_digest:receipt.action_digest,environment:authorizationInput?.environment,target_origin:authorizationInput?.target_origin,target_path:authorizationInput?.target_path,method:authorizationInput?.method,port:authorizationInput?.port,maximum_requests:authorizationInput?.maximum_requests,redirects_allowed:authorizationInput?.redirects_allowed,production_allowed:authorizationInput?.production_allowed});
    if(!runtimeBinding.ok) return Object.freeze({ok:false,status:'PUBLIC_WEB_CANARY_EMAIL_REAUTH_DURABLE_RESUME_BLOCKED',reason:'runtime_binding_blocked',receipt,authorization,runtimeBinding,execution_authorized:false,external_network_called:false,production_allowed:false});
    return Object.freeze({ok:true,status:'PUBLIC_WEB_CANARY_EMAIL_REAUTH_DURABLE_GRANT_READY_NOT_EXECUTED',receipt,authorization,runtimeBinding,execution_authorized:false,execution_started:false,external_network_called:false,production_allowed:false});
  }
  function prepareEmailReauthExecution({durableComposition,plan,requested_at}={}) {
    if(!staging.ok) return Object.freeze({ok:false,status:'PUBLIC_WEB_CANARY_EMAIL_REAUTH_OPERATIONAL_PREPARATION_BLOCKED',reason:'operational_bootstrap_not_ready',execution_authorized:false,external_network_called:false,production_allowed:false});
    const operational=createOperationalCanaryContext(plan, staging);
    if(!operational.ok) return Object.freeze({ok:false,status:'PUBLIC_WEB_CANARY_EMAIL_REAUTH_OPERATIONAL_PREPARATION_BLOCKED',reason:'operational_context_blocked',contextResult:operational,execution_authorized:false,external_network_called:false,production_allowed:false});
    return prepareEmailReauthOperationalExecution({durableComposition,plan,operationalContext:operational.context,requested_at});
  }
  return Object.freeze({version:VERSION,bootstrap:staging,controls,credential_material_present:false,network_call_performed:false,resumeEmailReauthDurableComposition,prepareEmailReauthExecution,async close(){if(!closed){closed=true;await pool.end();}}});
}
module.exports={VERSION,createPublicWebCanaryOperationalPostgresBootstrap};
