'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {propose,SQL}=require('../src/runtime/hermes-brain-inbox-propose');
const USER='11111111-1111-4111-8111-111111111111';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const required={tenant_id:'grupo_erick',user_id:USER,source_type:'user_note',
 source_ref:'telegram/owner001',source_version:'v1',
 title:'Contexto piloto',body:'Sinal selecionado pelo usuário',
 domain:'projetos',classification:'internal'};
function pool({role='authenticated',actor=USER,error=null}={}){
 const calls=[];let released=false;
 return {calls,get released(){return released},connect:async()=>({
  query:async(sql,params)=>{
   calls.push({sql,params});
   if(sql.startsWith('SELECT (SELECT auth.uid())'))
    return {rows:[{user_id:actor,db_role:role}]};
   if(sql===SQL){
    if(error)throw error;
    return {rows:[{proposal_id:id,tenant_id:required.tenant_id,status:'pending',
     submitted_at:'2026-10-23T02:00:00.000Z'}]};
   }
   return {rows:[]};
  },
  release:()=>{released=true}
 })};
}
test('propose uses pinned auth transaction, returns only pending not approval',async()=>{
 const p=pool();
 const r=await propose({pool:p,...required});
 assert.deepEqual(p.calls.map(x=>x.sql),['BEGIN',
  'SELECT (SELECT auth.uid())::text AS user_id, current_user AS db_role',
  SQL,'COMMIT']);
 assert.deepEqual(p.calls[2].params,
  [required.tenant_id,USER,'user_note','telegram/owner001','v1',
   'Contexto piloto','Sinal selecionado pelo usuário','projetos','internal',null,null]);
 assert.equal(r.status,'pending');assert.equal(r.approved,false);assert.equal(r.executed,false);
 assert.ok(!JSON.stringify(r).includes(required.body));assert.equal(p.released,true);
 assert.doesNotMatch(SQL, /UPDATE|DELETE|ON CONFLICT/i);
});
test('propose fails closed for owner spoof and privileged role',async()=>{
 for(const options of [{actor:'22222222-2222-4222-8222-222222222222'},
  {role:'postgres'},{role:'service_role'}]){
  const p=pool(options);
  await assert.rejects(propose({pool:p,...required}),/brain_verified_rls_principal_denied/);
  assert.equal(p.calls.at(-1).sql,'ROLLBACK');
  assert.equal(p.calls.some(c=>c.sql===SQL),false);
  assert.equal(p.released,true);
 }
});
test('propose aborts SQL failures and releases client',async()=>{
 const p=pool({error:new Error('simulated RLS deny')});
 await assert.rejects(propose({pool:p,...required}),/simulated RLS deny/);
 assert.equal(p.calls.at(-1).sql,'ROLLBACK');assert.equal(p.released,true);
});
test('propose rejects malformed tenant, source, classifications and length before DB',async()=>{
 for(const invalid of [
  {tenant_id:'client::alpha; DROP SCHEMA hermes_brain'},
  {user_id:'telegram:12345'}, {source_ref:'bad\nref'},
  {title:'x'.repeat(161)},{body:'x'.repeat(4001)},
  {classification:'public'}, {source_type:'credential_dump'},
  {domain:'../financeiro'}, {company_id:'other company'},
  {source_version:''}]){
  const p=pool();
  await assert.rejects(propose({pool:p,...required,...invalid}),/brain_inbox_proposal_contract_denied/);
  assert.equal(p.calls.length,0);
 }
});
test('cannot auto promote: SQL only creates pending candidate; table RLS matches',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const migration=fs.readFileSync(path.resolve(__dirname,
  '../../../migrations/hermes/039_create_second_brain_inbox_candidates.sql'),'utf8');
 assert.match(migration,/FOR INSERT TO authenticated WITH CHECK/);
 assert.match(migration,/status='pending'/);
 assert.match(migration,/actor_user_id=\(SELECT auth[.]uid\(\)\)/);
 assert.match(migration,/GRANT SELECT,INSERT/);
 assert.match(migration,/FORCE ROW LEVEL SECURITY/);
 assert.doesNotMatch(migration,/SECURITY DEFINER|GRANT UPDATE|GRANT DELETE/i);
});
