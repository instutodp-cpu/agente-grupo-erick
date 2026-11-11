'use strict';
// Inert staging bootstrap for the group-shared Outlook metadata canary.
// No HTTP route, cron, Telegram tool, generic MCP proxy or production activation.
const fs=require('node:fs');
const path=require('node:path');
const {createMachineIdentityRegistry}=require('../core/machine-identity-registry');
const {createComposioOutlookOwnerIdentityResolver,
  createHermesComposioOutlookMetadataRead}=require('./hermes-composio-outlook-metadata-read');
const {createPostgresComposioOutlookAudit}=
  require('../adapters/postgres/composio-outlook-metadata-audit-postgres');

const PROJECT='asceucchdnuoaqgdjbtg';
const LOGIN='hermes_outlook_audit_login';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function protectedFile(file,maxBytes=65536) {
  if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('\0'))
    throw Error('outlook_protected_file_path_invalid');
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||
      (stat.mode&0o777)!==0o600||stat.size<1||stat.size>maxBytes||
      (typeof process.getuid==='function'&&stat.uid!==process.getuid()))
    throw Error('outlook_protected_file_permissions_invalid');
  return fs.readFileSync(file,'utf8');
}
function protectedJson(file) {
  const parsed=JSON.parse(protectedFile(file));
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))
    throw Error('outlook_protected_json_invalid');
  return parsed;
}
function projectCertificate(file) {
  if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('\0'))
    throw Error('outlook_ca_path_invalid');
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<350||stat.size>65536)
    throw Error('outlook_ca_invalid');
  const ca=fs.readFileSync(file,'utf8');
  if(!/^\s*-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/.test(ca))
    throw Error('outlook_ca_invalid');
  return ca;
}
function createOwnerGrantReader(file,expectedOwner) {
  // Re-read for every attempt so a revoked owner grant takes effect without
  // waiting for a process restart. Never accept grants from caller arguments.
  return async ({tenant_id,key_id,principal_id})=>{
    const data=protectedJson(file);
    if(!Array.isArray(data.grants)||data.grants.length!==1)
      throw Error('outlook_owner_grant_cardinality_invalid');
    const grant=data.grants[0];
    if(grant?.tenant_id!==tenant_id||tenant_id!=='grupo_erick'||
      grant.key_id!==key_id||grant.principal_id!==principal_id||
      grant.user_id!==expectedOwner||grant.status!=='active'||
      grant.source!=='trusted_registry'||
      grant.group_scope!=='grupo_erick_all_companies'||
      grant.user_scope!=='owner_director')
      throw Error('outlook_owner_grant_invalid');
    return grant;
  };
}
function createComposioOutlookStagingBootstrap({
  environment=process.env,PoolClass=null,fetchImpl=globalThis.fetch,
  credentialReader,authorizeRead
}={}) {
  const disabled=()=>Object.freeze({enabled:false,pilot:null,async close(){}});
  if(environment.HERMES_COMPOSIO_OUTLOOK_METADATA_ENABLED!=='true')
    return disabled();
  if(environment.HERMES_DEPLOYMENT_STAGE!=='staging'||
     environment.HERMES_EXECUTION_ENABLED!=='false'||
     environment.HERMES_EXECUTION_KILL_SWITCH!=='true'||
     environment.HERMES_MISSION_INGRESS_ENABLED!=='false')
    throw Error('outlook_staging_gate_closed');
  const owner=environment.HERMES_COMPOSIO_OUTLOOK_OWNER_USER_ID;
  if(typeof owner!=='string'||!UUID.test(owner))
    throw Error('outlook_verified_owner_uuid_required');
  const identity=protectedJson(environment.HERMES_COMPOSIO_OUTLOOK_MACHINE_REGISTRY_FILE);
  const registry=createMachineIdentityRegistry(identity);
  if(registry.size!==1)throw Error('outlook_machine_registry_cardinality_invalid');
  const grantFile=environment.HERMES_COMPOSIO_OUTLOOK_OWNER_GRANTS_FILE;
  // Fail at startup if owner grant is missing, malformed or inactive.
  const initial=protectedJson(grantFile);
  if(!Array.isArray(initial.grants)||initial.grants.length!==1||
    initial.grants[0]?.status!=='active'||
    initial.grants[0]?.user_id!==owner)
    throw Error('outlook_owner_grant_not_verified');
  const host=environment.HERMES_COMPOSIO_OUTLOOK_DB_HOST;
  const user=environment.HERMES_COMPOSIO_OUTLOOK_DB_USER;
  const port=Number(environment.HERMES_COMPOSIO_OUTLOOK_DB_PORT);
  const direct=host==='db.'+PROJECT+'.supabase.co'&&port===5432&&user===LOGIN;
  const pooler=typeof host==='string'&&
    /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)&&
    (port===5432||port===6543)&&user===LOGIN+'.'+PROJECT;
  if(!direct&&!pooler||
     environment.HERMES_COMPOSIO_OUTLOOK_DB_NAME!=='postgres')
    throw Error('outlook_scoped_database_identity_required');
  const password=protectedFile(environment.HERMES_COMPOSIO_OUTLOOK_DB_PASSWORD_FILE,4096).trim();
  if(password.length<20)throw Error('outlook_database_password_invalid');
  const ca=projectCertificate(environment.HERMES_COMPOSIO_OUTLOOK_DB_CA_FILE);
  const ResolvedPool=PoolClass||require('pg').Pool;
  const pool=new ResolvedPool({host,port,user,password,database:'postgres',
    ssl:{ca,rejectUnauthorized:true,servername:host},
    max:2,idleTimeoutMillis:10000,connectionTimeoutMillis:6000,
    application_name:'hermes_outlook_staging_audit'});
  const audit=createPostgresComposioOutlookAudit({pool});
  const resolveIdentity=createComposioOutlookOwnerIdentityResolver({
    registry,readOwnerGrant:createOwnerGrantReader(grantFile,owner)
  });
  const pilot=createHermesComposioOutlookMetadataRead({
    environment,fetchImpl,reserveAttempt:audit.reserveAttempt,
    appendOutcome:audit.appendOutcome,resolveIdentity,
    ...(credentialReader?{credentialReader}:{}),
    ...(authorizeRead?{authorizeRead}:{})
  });
  let closed=false;
  return Object.freeze({enabled:true,pilot,async close(){
    if(!closed){closed=true;await pool.end();}
  }});
}
module.exports={createComposioOutlookStagingBootstrap,
  createOwnerGrantReader,protectedFile,projectCertificate};
