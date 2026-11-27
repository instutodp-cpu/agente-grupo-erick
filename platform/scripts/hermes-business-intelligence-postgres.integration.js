'use strict';
// Runs only against the disposable PostgreSQL service in the CI job.
// It never connects to Supabase, production, a VPS, or a real business database.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {Pool}=require(require.resolve('pg',{paths:[path.resolve(__dirname,'../services/api')]}));

const DATABASE_URL=process.env.HERMES_POSTGRES_TEST_DATABASE_URL;
const SAFE_DB=/^postgres(?:ql)?:\/\/(?:[^@/]+(?::[^@/]*)?@)?(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\/hermes_test(?:_[a-z0-9_-]+)?(?:\?.*)?$/i;
if(!SAFE_DB.test(DATABASE_URL||'')) throw new Error('hermes_bi_isolated_database_required');
const migration=name=>fs.readFileSync(
 path.resolve(__dirname,'../migrations/hermes',name),'utf8'
);
const createRoles=async pool=>pool.query(`DO $roles$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $roles$`);
const asRole=async(pool,role,work)=>{
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SET LOCAL ROLE '+role);
  const result=await work(client);
  await client.query('ROLLBACK');
  return result;
 }catch(error){
  try{await client.query('ROLLBACK')}catch{}
  throw error;
 }finally{client.release()}
};
async function main(){
 const pool=new Pool({connectionString:DATABASE_URL,max:2,connectionTimeoutMillis:5000});
 try{
  await pool.query('DROP VIEW IF EXISTS hermes_history.monthly_seller_activity_v1');
  await pool.query('DROP VIEW IF EXISTS hermes_history.monthly_commercial_v2');
  await pool.query('DROP SCHEMA IF EXISTS hermes_history CASCADE');
  await pool.query('DROP SCHEMA IF EXISTS softcom_import CASCADE');
  await pool.query('DROP ROLE IF EXISTS hermes_history_reader');
  await pool.query('CREATE SCHEMA softcom_import');
  await pool.query(`CREATE TABLE softcom_import.cadastro_de_vendas(
    data_da_venda text, lojaorigem text, vendedor text, cancelado text, valor_pago text
  )`);
  await pool.query(`INSERT INTO softcom_import.cadastro_de_vendas
    (data_da_venda,lojaorigem,vendedor,cancelado,valor_pago) VALUES
    ('2026-01-15','CALCADOS','7','false','10.50'),
    ('15/01/2026','CALCADOS','7','sim','20,00'),
    ('invalid-date','CALCADOS','8','false','4.00'),
    ('2026-01-20','OUTRA LOJA','9','false','9.00'),
    ('2026-01-21','MAGAZINE','codigo-invalido','false','8.00')`);
  await createRoles(pool);
  await pool.query(migration('055_create_monthly_commercial_v2.sql'));
  await pool.query(migration('056_create_monthly_seller_activity_v1.sql'));

  const commercial=await pool.query(`SELECT month,raw_store,registered,cancelled,noncancelled,
    valor_pago_noncancelled_sum,last_day
    FROM hermes_history.monthly_commercial_v2 ORDER BY raw_store`);
  assert.deepEqual(commercial.rows,[
   {month:'2026-01',raw_store:'CALCADOS',registered:'2',cancelled:'1',noncancelled:'1',
    valor_pago_noncancelled_sum:'10.50',last_day:'2026-01-15'},
   {month:'2026-01',raw_store:'MAGAZINE',registered:'1',cancelled:'0',noncancelled:'1',
    valor_pago_noncancelled_sum:'8.00',last_day:'2026-01-21'}
  ]);
  const sellers=await pool.query(`SELECT month,raw_store,seller_code,seller_label,registered,
    cancelled,noncancelled,valor_pago_noncancelled_sum,last_day
    FROM hermes_history.monthly_seller_activity_v1`);
  assert.deepEqual(sellers.rows,[
   {month:'2026-01',raw_store:'CALCADOS',seller_code:'7',seller_label:'Código 7',
    registered:'2',cancelled:'1',noncancelled:'1',valor_pago_noncancelled_sum:'10.50',
    last_day:'2026-01-15'}
  ]);

  const privileges=await pool.query(`SELECT
    has_table_privilege('hermes_history_reader','hermes_history.monthly_commercial_v2','SELECT') AS reader_select,
    has_table_privilege('hermes_history_reader','hermes_history.monthly_commercial_v2','INSERT') AS reader_insert,
    has_table_privilege('hermes_history_reader','softcom_import.cadastro_de_vendas','SELECT') AS raw_select,
    has_table_privilege('anon','hermes_history.monthly_commercial_v2','SELECT') AS anon_select,
    has_table_privilege('authenticated','hermes_history.monthly_seller_activity_v1','SELECT') AS authenticated_select`);
  assert.deepEqual(privileges.rows[0],{
   reader_select:true,reader_insert:false,raw_select:false,anon_select:false,authenticated_select:false
  });
  assert.equal((await asRole(pool,'hermes_history_reader',
   c=>c.query('SELECT count(*)::int AS n FROM hermes_history.monthly_commercial_v2'))).rows[0].n,2);
  await assert.rejects(
   asRole(pool,'hermes_history_reader',
    c=>c.query('SELECT count(*) FROM softcom_import.cadastro_de_vendas')),
   error=>error.code==='42501'
  );
  await assert.rejects(
   asRole(pool,'anon',
    c=>c.query('SELECT count(*) FROM hermes_history.monthly_commercial_v2')),
   error=>error.code==='42501'
  );
  console.log('Hermes BI migration isolation: PASS');
 }finally{
  await pool.query('DROP VIEW IF EXISTS hermes_history.monthly_seller_activity_v1');
  await pool.query('DROP VIEW IF EXISTS hermes_history.monthly_commercial_v2');
  await pool.query('DROP SCHEMA IF EXISTS hermes_history CASCADE');
  await pool.query('DROP SCHEMA IF EXISTS softcom_import CASCADE');
  await pool.query('DROP ROLE IF EXISTS hermes_history_reader');
  await pool.end();
 }
}
main().catch(error=>{console.error(error);process.exitCode=1});
