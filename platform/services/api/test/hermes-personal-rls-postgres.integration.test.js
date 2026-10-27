'use strict';
// Runs ONLY against the pre-existing disposable hermes_test PostgreSQL 16 in CI.
// Uses synthetic identities/text and scoped schemas; no service_role, no Supabase.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const URL=process.env.HERMES_POSTGRES_TEST_DATABASE_URL;
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const DS='hermes_personal_rls_ci',RS='hermes_personal_rpc_ci';
const SHA=x=>crypto.createHash('sha256').update(x).digest('hex');
function safeDb(value){
 try{
  const url=new URLClass(value);
  return ['postgres:','postgresql:'].includes(url.protocol)
   &&['127.0.0.1','localhost','::1'].includes(url.hostname)
   &&/^hermes_test(?:_[a-z0-9_-]+)?$/i.test(decodeURIComponent(url.pathname.slice(1)));
 }catch{return false}
}
const URLClass=globalThis.URL;
const file=name=>fs.readFileSync(path.resolve(__dirname,
 '../../../migrations/hermes/'+name),'utf8');
const migrate=sql=>sql.replaceAll('hermes_brain.',DS+'.')
 .replaceAll('public.hermes_personal_',RS+'.hermes_personal_')
 .replaceAll("n.nspname='public'","n.nspname='"+RS+"'");
async function as(pool,actor,op,role='authenticated'){
 const c=await pool.connect();let tx=false;
 try{
  await c.query('BEGIN');tx=true;
  await c.query('SET LOCAL ROLE '+role);
  if(actor!==null)await c.query(
   "SELECT set_config('request.jwt.claim.sub',$1,true)",[actor]);
  const answer=await op(c);
  await c.query('COMMIT');tx=false;
  return answer;
 }catch(e){if(tx)await c.query('ROLLBACK');throw e}
 finally{c.release()}
}
async function denies(work,code){
 await assert.rejects(work,e=>{assert.equal(e.code,code);return true});
}
const CONSENTS=DS+'.personal_import_consents';
const MESSAGES=DS+'.personal_conversation_messages';
const rpc=name=>RS+'.hermes_personal_'+name;
async function put(c,owner,provider,id,content){
 return c.query('INSERT INTO '+MESSAGES+
  ' (owner_user_id,provider,grant_id,source_ref,conversation_ref,'+
  'role,branch_status,content,content_digest)'+
  ' VALUES($1,$2,(SELECT grant_id FROM '+CONSENTS+
  ' WHERE owner_user_id=$1 AND provider=$2),$3,$4,$5,$6,$7,$8)'+
  ' RETURNING source_ref',
  [owner,provider,provider+':'+id.repeat(28)+':'+id.repeat(28),
   provider+':'+id.repeat(32),'user','selected',content,
   'sha256:'+SHA(content)]);
}
async function count(pool,actor,table){
 const r=await as(pool,actor,c=>c.query('SELECT count(*)::int AS n FROM '+table));
 return r.rows[0].n;
}
test('real PostgreSQL RLS: separate users, revoke, purge, immutable hash, deny anon/enterprise', {
 skip:!safeDb(URL),timeout:75000
},async()=>{
 const {Pool}=require('pg');
 const pool=new Pool({connectionString:URL,max:3,connectionTimeoutMillis:5000});
 try{
  await pool.query('CREATE SCHEMA IF NOT EXISTS '+DS);
  await pool.query('CREATE SCHEMA IF NOT EXISTS '+RS);
  await pool.query('CREATE SCHEMA IF NOT EXISTS auth');
  await pool.query('DO $x$ BEGIN '+
   "IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; "+
   "IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; "+
   "IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='hermes_personal_ci_enterprise_reader') THEN CREATE ROLE hermes_personal_ci_enterprise_reader NOLOGIN; END IF; "+
   'END $x$');
  await pool.query("CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ "+
   "SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $f$");
  await pool.query('CREATE TABLE IF NOT EXISTS auth.users(id uuid PRIMARY KEY)');
  await pool.query('INSERT INTO auth.users(id) VALUES($1),($2) ON CONFLICT DO NOTHING',[A,B]);
  await pool.query('GRANT USAGE ON SCHEMA auth,'+DS+','+RS+' TO authenticated');
  await pool.query('GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated');
  await pool.query(migrate(file('049_create_personal_conversation_archive.sql')));
  await pool.query(migrate(file('050_create_personal_archive_authenticated_rpc.sql')));
  let a=await as(pool,A,c=>c.query('SELECT '+rpc('source_consent')+'($1) AS v',['chatgpt']));
  assert.equal(a.rows[0].v,'authorized');
  let b=await as(pool,B,c=>c.query('SELECT '+rpc('source_consent')+'($1) AS v',['claude']));
  assert.equal(b.rows[0].v,'authorized');
  assert.equal((await as(pool,A,c=>put(c,A,'chatgpt','a','SYNTHETIC HERMES HISTORY'))).rowCount,1);
  assert.equal((await as(pool,B,c=>put(c,B,'claude','b','SYNTHETIC CLAUDE HISTORY'))).rowCount,1);
  assert.equal(await count(pool,A,MESSAGES),1);
  assert.equal(await count(pool,B,MESSAGES),1);
  assert.equal(await count(pool,A,CONSENTS),1);
  assert.equal(await count(pool,B,CONSENTS),1);
  assert.equal((await as(pool,B,c=>c.query('SELECT * FROM '+
   rpc('history_search')+'($1,$2,$3)',['chatgpt','SYNTHETIC',5]))).rowCount,0);
  const own=await as(pool,A,c=>c.query('SELECT * FROM '+
   rpc('history_search')+'($1,$2,$3)',['chatgpt','SYNTHETIC',5]));
  assert.equal(own.rowCount,1);
  assert.equal(own.rows[0].trust_level,'unreviewed_personal_archive');
  await denies(()=>as(pool,B,c=>c.query('INSERT INTO '+CONSENTS+
   '(owner_user_id,provider) VALUES($1,$2)',[A,'claude'])),'42501');
  await denies(()=>as(pool,B,c=>put(c,A,'chatgpt','c','SYNTHETIC CROSS-OWNER')),'42501');
  assert.equal((await as(pool,B,c=>c.query('SELECT '+rpc('source_revoke')+'($1) AS v',['chatgpt']))).rows[0].v,false);
  assert.equal((await as(pool,B,c=>c.query('SELECT '+rpc('source_erase')+'($1) AS v',['chatgpt']))).rows[0].v,false);
  await denies(()=>as(pool,A,c=>c.query('INSERT INTO '+MESSAGES+
   ' (owner_user_id,provider,grant_id,source_ref,conversation_ref,'+
   'role,branch_status,content,content_digest) VALUES($1,$2,'+
   '(SELECT grant_id FROM '+CONSENTS+' WHERE owner_user_id=$1 AND provider=$2),'+
   '$3,$4,$5,$6,$7,$8)',[
   A,'chatgpt','chatgpt:'+('d'.repeat(28))+':'+('d'.repeat(28)),
   'chatgpt:'+('d'.repeat(32)),'user','selected',
   'SYNTHETIC FORGED','sha256:'+('f'.repeat(64))
  ])),'23514');
  assert.equal((await as(pool,A,c=>c.query('SELECT '+rpc('source_revoke')+'($1) AS v',['chatgpt']))).rows[0].v,true);
  assert.equal(await count(pool,A,MESSAGES),0);
  assert.equal((await as(pool,A,c=>c.query('SELECT * FROM '+
   rpc('history_search')+'($1,$2,$3)',['chatgpt','SYNTHETIC',5]))).rowCount,0);
  await denies(()=>as(pool,A,c=>put(c,A,'chatgpt','e','SYNTHETIC REVOKED')),'42501');
  assert.equal((await as(pool,A,c=>c.query('SELECT '+rpc('source_erase')+'($1) AS v',['chatgpt']))).rows[0].v,true);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM '+MESSAGES+
    ' WHERE owner_user_id=$1',[A])).rows[0].n,0);
  assert.equal(await count(pool,B,MESSAGES),1);
  await denies(()=>as(pool,null,c=>c.query('SELECT count(*) FROM '+MESSAGES),
   'hermes_personal_ci_enterprise_reader'),'42501');
  await denies(()=>as(pool,null,c=>c.query('SELECT * FROM '+
   rpc('source_status')+'()'),'anon'),'42501');
  const policy=await pool.query('SELECT relrowsecurity,relforcerowsecurity'+
    ' FROM pg_class WHERE oid IN($1::regclass,$2::regclass)',[CONSENTS,MESSAGES]);
  assert.equal(policy.rowCount,2);
  assert(policy.rows.every(x=>x.relrowsecurity===true&&x.relforcerowsecurity===true));
 }finally{
  await pool.query('DROP SCHEMA IF EXISTS '+RS+' CASCADE').catch(()=>{});
  await pool.query('DROP SCHEMA IF EXISTS '+DS+' CASCADE').catch(()=>{});
  await pool.end();
 }
});
