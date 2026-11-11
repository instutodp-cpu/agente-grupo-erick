'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {createComposioOutlookStagingBootstrap,createOwnerGrantReader}=
  require('../src/runtime/hermes-composio-outlook-staging-bootstrap');

const OWNER='11111111-1111-4111-8111-111111111111';
const TOKEN='synthetic-outlook-owner-bearer-token';
const KEY_ID='outlook-owner-machine-key';
const PRINCIPAL='outlook-owner-machine';
const PROJECT='asceucchdnuoaqgdjbtg';
function writePrivate(file,data){
  fs.writeFileSync(file,typeof data==='string'?data:JSON.stringify(data),{mode:0o600});
  fs.chmodSync(file,0o600);
}
function makeFixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hermes-outlook-bootstrap-'));
  const machineFile=path.join(dir,'machines.json');
  const grantFile=path.join(dir,'grants.json');
  const passwordFile=path.join(dir,'db-password');
  const caFile=path.join(dir,'ca.pem');
  const digest=createHash('sha256').update(TOKEN).digest('hex');
  writePrivate(machineFile,{entries:[{key_id:KEY_ID,key_digest:digest,
    principal_id:PRINCIPAL,tenant_id:'grupo_erick',active:true}]});
  const grant={tenant_id:'grupo_erick',key_id:KEY_ID,principal_id:PRINCIPAL,
    user_id:OWNER,status:'active',source:'trusted_registry',
    group_scope:'grupo_erick_all_companies',user_scope:'owner_director'};
  writePrivate(grantFile,{grants:[grant]});
  writePrivate(passwordFile,'synthetic-database-password-only-for-tests');
  fs.writeFileSync(caFile,'-----BEGIN CERTIFICATE-----\n'+'A'.repeat(400)+
    '\n-----END CERTIFICATE-----\n');
  const environment={
    HERMES_COMPOSIO_OUTLOOK_METADATA_ENABLED:'true',
    HERMES_DEPLOYMENT_STAGE:'staging',
    HERMES_EXECUTION_ENABLED:'false',
    HERMES_EXECUTION_KILL_SWITCH:'true',
    HERMES_MISSION_INGRESS_ENABLED:'false',
    HERMES_COMPOSIO_OUTLOOK_OWNER_USER_ID:OWNER,
    HERMES_COMPOSIO_OUTLOOK_MACHINE_REGISTRY_FILE:machineFile,
    HERMES_COMPOSIO_OUTLOOK_OWNER_GRANTS_FILE:grantFile,
    HERMES_COMPOSIO_OUTLOOK_DB_HOST:'db.'+PROJECT+'.supabase.co',
    HERMES_COMPOSIO_OUTLOOK_DB_PORT:'5432',
    HERMES_COMPOSIO_OUTLOOK_DB_USER:'hermes_outlook_audit_login',
    HERMES_COMPOSIO_OUTLOOK_DB_NAME:'postgres',
    HERMES_COMPOSIO_OUTLOOK_DB_PASSWORD_FILE:passwordFile,
    HERMES_COMPOSIO_OUTLOOK_DB_CA_FILE:caFile
  };
  const state={config:null,connections:0,ends:0,fetches:0};
  class Pool {
    constructor(config){state.config=config;}
    async connect(){state.connections++;throw Error('no real database in unit tests');}
    async end(){state.ends++;}
  }
  const fetchImpl=async()=>{state.fetches++;throw Error('network forbidden');};
  return {dir,environment,grantFile,grant,state,Pool,fetchImpl,
    cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('disabled by default without files, db driver or provider',()=>{
  const b=createComposioOutlookStagingBootstrap({environment:{}});
  assert.equal(b.enabled,false);
  assert.equal(b.pilot,null);
});
test('production and unsafe gates refuse bootstrap',()=>{
  const f=makeFixture();
  try{
    for(const patch of [
      {HERMES_DEPLOYMENT_STAGE:'production'},
      {HERMES_EXECUTION_ENABLED:'true'},
      {HERMES_EXECUTION_KILL_SWITCH:'false'},
      {HERMES_MISSION_INGRESS_ENABLED:'true'}
    ])assert.throws(()=>createComposioOutlookStagingBootstrap({
      environment:{...f.environment,...patch},PoolClass:f.Pool}));
    assert.equal(f.state.config,null);
  }finally{f.cleanup();}
});
test('requires verified UUID owner and a private machine registry',()=>{
  const f=makeFixture();
  try{
    assert.throws(()=>createComposioOutlookStagingBootstrap({
      environment:{...f.environment,HERMES_COMPOSIO_OUTLOOK_OWNER_USER_ID:'owner'},
      PoolClass:f.Pool}));
    fs.chmodSync(f.environment.HERMES_COMPOSIO_OUTLOOK_MACHINE_REGISTRY_FILE,0o644);
    assert.throws(()=>createComposioOutlookStagingBootstrap({
      environment:f.environment,PoolClass:f.Pool}));
    assert.equal(f.state.config,null);
  }finally{f.cleanup();}
});
test('scoped TLS pool, bad bearer blocked, owner grant revocable',async()=>{
  const f=makeFixture();
  try{
    const b=createComposioOutlookStagingBootstrap({
      environment:f.environment,PoolClass:f.Pool,fetchImpl:f.fetchImpl,
      credentialReader:()=>{throw Error('no credential read before reservation');}
    });
    assert.equal(b.enabled,true);
    assert.equal(f.state.config.host,'db.'+PROJECT+'.supabase.co');
    assert.equal(f.state.config.user,'hermes_outlook_audit_login');
    assert.equal(f.state.config.ssl.rejectUnauthorized,true);
    assert.equal(f.state.config.ssl.servername,f.state.config.host);
    assert.equal(f.state.config.max,2);
    assert.equal((await b.pilot.run({authorization:'Bearer wrong'})).status,
      'identity_unavailable');
    assert.equal(f.state.connections,0);
    writePrivate(f.grantFile,{grants:[{...f.grant,status:'revoked'}]});
    assert.equal((await b.pilot.run({authorization:'Bearer '+TOKEN})).status,
      'identity_unavailable');
    assert.equal(f.state.connections,0);
    writePrivate(f.grantFile,{grants:[f.grant]});
    assert.equal((await b.pilot.run({authorization:'Bearer '+TOKEN})).status,
      'audit_reservation_unavailable');
    assert.equal(f.state.connections,1);
    assert.equal(f.state.fetches,0);
    await b.close();await b.close();
    assert.equal(f.state.ends,1);
  }finally{f.cleanup();}
});
test('wrong project, login, database and missing certificate fail closed',()=>{
  const f=makeFixture();
  try{
    for(const patch of [
      {HERMES_COMPOSIO_OUTLOOK_DB_HOST:'db.attacker.supabase.co'},
      {HERMES_COMPOSIO_OUTLOOK_DB_USER:'postgres'},
      {HERMES_COMPOSIO_OUTLOOK_DB_USER:'hermes_personal_ingress'},
      {HERMES_COMPOSIO_OUTLOOK_DB_NAME:'template1'},
      {HERMES_COMPOSIO_OUTLOOK_DB_PORT:'7777'}
    ])assert.throws(()=>createComposioOutlookStagingBootstrap({
      environment:{...f.environment,...patch},PoolClass:f.Pool}));
    assert.equal(f.state.config,null);
    fs.chmodSync(f.environment.HERMES_COMPOSIO_OUTLOOK_DB_PASSWORD_FILE,0o644);
    assert.throws(()=>createComposioOutlookStagingBootstrap({
      environment:f.environment,PoolClass:f.Pool}));
    assert.equal(f.state.config,null);
  }finally{f.cleanup();}
});
test('grant lookup requires exact owner, machine and group scope',async()=>{
  const f=makeFixture();
  try{
    const read=createOwnerGrantReader(f.grantFile,OWNER);
    const request={tenant_id:'grupo_erick',key_id:KEY_ID,principal_id:PRINCIPAL};
    assert.equal((await read(request)).user_id,OWNER);
    await assert.rejects(()=>read({...request,key_id:'other'}));
    writePrivate(f.grantFile,{grants:[{...f.grant,
      group_scope:'erick_calcados_only'}]});
    await assert.rejects(()=>read(request));
    writePrivate(f.grantFile,{grants:[f.grant,f.grant]});
    await assert.rejects(()=>read(request));
  }finally{f.cleanup();}
});
