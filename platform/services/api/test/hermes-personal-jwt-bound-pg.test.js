'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPersonalJwtBoundPgBinder}
 =require('../src/runtime/hermes-brain-personal-jwt-bound-pg');
const {createPersonalArchiveIngressBootstrap}
 =require('../src/runtime/hermes-brain-personal-ingress-bootstrap');
const {withAuthenticatedTransaction}
 =require('../src/runtime/hermes-brain-authenticated-transaction');
const a='11111111-1111-4111-8111-111111111111';
const b='22222222-2222-4222-8222-222222222222';
function harness({spoof=false,role='authenticated',failSetup=false}={}){
 const events=[],connections=[];
 const pgPool={async connect(){
  const instance={uid:null,released:null,done:false};
  connections.push(instance);
  const client={
   async query(sql,params=[]){
    events.push({sql,params});
    if(sql==='BEGIN')return {rows:[]};
    if(sql==='SET LOCAL ROLE authenticated'){
     if(failSetup)throw Error('SENSITIVE_PG_EXCEPTION');
     return {rows:[]};
    }
    if(sql.includes("set_config('request.jwt.claim.sub'")){
     instance.uid=params[0];return {rows:[]};
    }
    if(sql.startsWith('SELECT current_user AS db_role')||
       sql.startsWith('SELECT (SELECT auth.uid())')){
     return {rows:[{db_role:role,user_id:spoof?b:instance.uid}]};
    }
    if(sql==='ROLLBACK'||sql==='COMMIT'){instance.done=true;return {rows:[]}};
    if(sql==='SELECT 42 AS answer')return {rows:[{answer:42}]};
    return {rows:[]};
   },
   release(destroy){instance.released=Boolean(destroy)}
  };
  return client;
 }};
 return {pgPool,events,connections};
}
test('bound connection uses transaction-local role and verified auth.uid',async()=>{
 const {pgPool,events,connections}=harness();
 const bind=createPersonalJwtBoundPgBinder({pgPool});
 const scope=await bind({userId:a});
 const result=await withAuthenticatedTransaction({
  pool:scope.pool,user_id:a,readOnly:false,
  work:async client=>(await client.query('SELECT 42 AS answer')).rows[0].answer
 });
 assert.equal(result,42);
 assert.deepEqual(events.map(e=>e.sql),[
  'BEGIN','SET LOCAL ROLE authenticated',
  "SELECT pg_catalog.set_config('request.jwt.claim.sub',$1,true)",
  'SELECT current_user AS db_role,(SELECT auth.uid())::text AS user_id',
  'SELECT (SELECT auth.uid())::text AS user_id, current_user AS db_role',
  'SELECT 42 AS answer','COMMIT']);
 assert.deepEqual(events[2].params,[a]);
 assert.equal(connections[0].released,false);
 await scope.close();
 await assert.rejects(scope.pool.connect(),/personal_db_principal_denied/);
});
test('user B never inherits user A despite pooled physical connection',async()=>{
 const x=harness();const binder=createPersonalJwtBoundPgBinder({pgPool:x.pgPool});
 for(const uid of [a,b]){
  const scope=await binder({userId:uid});
  await withAuthenticatedTransaction({pool:scope.pool,user_id:uid,
   readOnly:false,work:async()=>{}});
  await scope.close();
 }
 const userBinds=x.events.filter(e=>e.sql.includes("set_config('request.jwt.claim.sub'"));
 assert.deepEqual(userBinds.map(e=>e.params[0]),[a,b]);
 assert(x.connections.every(c=>c.released===false));
});
test('principal mismatch and role mismatch both roll back and destroy connection',async()=>{
 for(const options of [{spoof:true},{role:'postgres'},{role:'service_role'}]){
  const x=harness(options);
  const scope=await createPersonalJwtBoundPgBinder({pgPool:x.pgPool})({userId:a});
  await assert.rejects(withAuthenticatedTransaction({
   pool:scope.pool,user_id:a,readOnly:false,work:async()=>{}
  }),/personal_db_principal_denied/);
  assert(x.events.some(e=>e.sql==='ROLLBACK'));
  assert.equal(x.connections[0].released,true);
 }
});
test('failed privilege downgrade destroys the connection; no message queries',async()=>{
 const x=harness({failSetup:true});
 const scope=await createPersonalJwtBoundPgBinder({pgPool:x.pgPool})({userId:a});
 await assert.rejects(withAuthenticatedTransaction({
  pool:scope.pool,user_id:a,readOnly:false,work:async()=>{}
 }),/personal_db_principal_denied/);
 assert.equal(x.connections[0].released,true);
 assert(!x.events.some(e=>e.sql==='SELECT 42 AS answer'));
});
test('invalid user, second lease, and post-commit operations are refused',async()=>{
 const x=harness(),binder=createPersonalJwtBoundPgBinder({pgPool:x.pgPool});
 await assert.rejects(binder({userId:'bad'}),/personal_db_principal_denied/);
 const scope=await binder({userId:a});
 const conn=await scope.pool.connect();
 await assert.rejects(scope.pool.connect(),/personal_db_principal_denied/);
 await conn.query('BEGIN');
 await conn.query('COMMIT');
 await assert.rejects(conn.query('SELECT 42 AS answer'),/personal_db_principal_denied/);
 conn.release();
 assert.equal(x.connections[0].released,false);
});
test('bootstrap defaults off; staging/environment/project gates reject invalid config',()=>{
 const disabled=createPersonalArchiveIngressBootstrap({env:{}});
 assert.equal(disabled.ingress,null);
 const base={
  HERMES_PERSONAL_INGRESS_ENABLED:'true',
  HERMES_PERSONAL_ENVIRONMENT:'staging',
  HERMES_PERSONAL_PG_URL:'postgresql://postgres:fake@db.asceucchdnuoaqgdjbtg.supabase.co/postgres',
  HERMES_PERSONAL_SUPABASE_URL:'https://asceucchdnuoaqgdjbtg.supabase.co/',
  HERMES_PERSONAL_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_testing'
 };
 assert.throws(()=>createPersonalArchiveIngressBootstrap({
  env:base
 }),/personal_ingress_ca_required/);
 const pgPool=harness().pgPool;
 assert.throws(()=>createPersonalArchiveIngressBootstrap({
  env:{...base,HERMES_PERSONAL_ENVIRONMENT:'production'},pgPool
 }),/staging_only/);
 assert.throws(()=>createPersonalArchiveIngressBootstrap({
  env:{...base,HERMES_PERSONAL_PG_URL:'postgresql://admin:fake@evil.example/postgres'},pgPool
 }),/db_configuration_denied/);
 assert.throws(()=>createPersonalArchiveIngressBootstrap({
  env:{...base,HERMES_PERSONAL_SUPABASE_PUBLISHABLE_KEY:'service_role_fake'},pgPool
 }),/invalid_auth_config/);
 const composition=createPersonalArchiveIngressBootstrap({
  env:base,pgPool,fetchImpl:async()=>({status:401})
 });
 assert.equal(composition.ingress.enabled(),true);
});
