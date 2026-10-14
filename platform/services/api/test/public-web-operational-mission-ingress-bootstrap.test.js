'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const { createHash }=require('node:crypto');
const { createPublicWebOperationalMissionIngressBootstrap }=require('../src/pilots/public-web-operational-mission-ingress-bootstrap');

class FakePool { constructor(options){this.options=options;this.ended=false;} async query(){return {rows:[{table_exists:true}]};} async connect(){throw new Error('not used');} async end(){this.ended=true;} }
function files(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hermes-ingress-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const identity=path.join(dir,'identity.json'), policy=path.join(dir,'policy.json'), ca=path.join(dir,'ca.pem'), password=path.join(dir,'password');
  fs.writeFileSync(identity,JSON.stringify({entries:[{key_id:'k1',key_digest:createHash('sha256').update('token').digest('hex'),principal_id:'maestro-control-plane',tenant_id:'grupo_erick',active:true}]}),{mode:0o600});
  fs.writeFileSync(policy,JSON.stringify({principal_id:'maestro-control-plane',tenant_id:'grupo_erick',workspace_type:'corporate',workspace_ids:['workspace-1'],user_id:'human:owner',operator_id:'human:owner',approver_id:'human:owner',environment:'staging',production_allowed:false}),{mode:0o600});
  fs.writeFileSync(ca,'-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n',{mode:0o600}); fs.writeFileSync(password,'secret',{mode:0o600});
  return {identity,policy,ca,password};
}
function env(f={}){return {HERMES_MISSION_INGRESS_ENABLED:'true',HERMES_MISSION_INGRESS_IDENTITY_FILE:f.identity,HERMES_MISSION_INGRESS_POLICY_FILE:f.policy,POSTGRES_HOST:'db.vvzvqinbzdqzcwrfoomd.supabase.co',POSTGRES_PORT:'5432',POSTGRES_USER:'postgres',POSTGRES_DB:'postgres',POSTGRES_PASSWORD_FILE:f.password,HERMES_STAGING_CA_FILE:f.ca};}

test('bootstrap stays disabled by default without touching files or network',async()=>{const c=createPublicWebOperationalMissionIngressBootstrap({environment:{},PoolClass:FakePool}); assert.equal(c.enabled,false); assert.equal(c.machineIdentityRegistry,null); await c.close();});

test('enabled bootstrap requires protected identity/policy files and composes staging ingress',async t=>{const f=files(t); const c=createPublicWebOperationalMissionIngressBootstrap({environment:env(f),PoolClass:FakePool}); assert.equal(c.enabled,true); assert.equal(c.machineIdentityRegistry.size,1); assert.equal(typeof c.missionIngress.admit,'function'); await c.close();});

test('enabled bootstrap rejects permissive configuration file modes',t=>{const f=files(t); fs.chmodSync(f.policy,0o644); assert.throws(()=>createPublicWebOperationalMissionIngressBootstrap({environment:env(f),PoolClass:FakePool}),/permissions_invalid/);});

test('enabled bootstrap remains pinned to staging postgres identity',t=>{const f=files(t); const e=env(f); e.POSTGRES_HOST='prod.example.com'; assert.throws(()=>createPublicWebOperationalMissionIngressBootstrap({environment:e,PoolClass:FakePool}),/staging_postgres_identity_invalid/);});
