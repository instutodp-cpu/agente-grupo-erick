'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {authorizeRead}=require('../src/runtime/hermes-brain-tenant-boundary');
const now=1792680000000;
function member(tenant_id,workspace_type){
 return {tenant_id,workspace_type,user_id:'owner1',status:'active',
  company_ids:['company1'],store_ids:['store1'],
  allowed_domains:['financeiro','compras','projetos'],
  allowed_classifications:['internal'],
  allowed_visibilities:['owner_only','scoped','tenant_shared']};
}
const mGroup=member('grupo_erick','grupo_erick');
const mClient=member('client::tenantA','external_client');
const mPersonal={...member('personal::owner1','personal'),
 company_ids:[],store_ids:[],allowed_domains:['pessoal','projetos'],
 allowed_visibilities:['owner_only']};
const identity={authenticated:true,user_id:'owner1',memberships:[mGroup,mClient,mPersonal]};
const workspace=(tenant_id,workspace_type)=>({tenant_id,workspace_type,verified_session_selection:true});
const item=(tenant_id,workspace_type)=>({
 id:'fact1',tenant_id,workspace_type,owner_user_id:'owner1',domain:'projetos',
 visibility:'owner_only',classification:'internal',status:'approved',
 source_status:'verified',expires_at:now+60000,company_id:null,store_id:null
});
function run(work,itemObject,id=identity){
 return authorizeRead({identity:id,workspace:work,item:itemObject,now});
}
test('contract preserves permitted owner memory in three separate workspaces',()=>{
 for(const [tenant,type] of [
 ['personal::owner1','personal'],['grupo_erick','grupo_erick'],
 ['client::tenantA','external_client']]){
  const r=run(workspace(tenant,type),item(tenant,type));
  assert.equal(r.allowed,true);
  assert.equal(r.executed,false);
  assert.equal(r.tenant_id,tenant);
 }
});
test('client A cannot read client B, Grupo Erick, or a personal space',()=>{
 const work=workspace('client::tenantA','external_client');
 for(const [t,type] of [
  ['client::tenantB','external_client'],['grupo_erick','grupo_erick'],
  ['personal::owner1','personal']]){
  const result=run(work,item(t,type));
  assert.equal(result.allowed,false);
  assert.equal(result.reason,'TENANT_BOUNDARY_DENIED');
  assert.equal(result.executed,false);
 }
});
test('tenant injection, prompt-selected workspace and absent membership fail closed',()=>{
 const record=item('client::tenantB','external_client');
 const chosen=workspace('client::tenantB','external_client');
 assert.equal(run(chosen,record).reason,'MEMBERSHIP_DENIED');
 assert.equal(run({...chosen,verified_session_selection:false},record).reason,'WORKSPACE_DENIED');
 assert.equal(run({tenant_id:'client::tenantB',workspace_type:'external_client'},record).allowed,false);
 assert.equal(run(chosen,record,{...identity,authenticated:false}).reason,'AUTH_CONTEXT_DENIED');
 assert.equal(run(chosen,record,{...identity,memberships:[]}).reason,'MEMBERSHIP_DENIED');
 assert.equal(run(chosen,record,{...identity,memberships:[
  ...identity.memberships,member('client::tenantB','external_client')]}).allowed,true);
});
test('other user personal tenant selection forbidden, including same account memberships',()=>{
 const other=item('personal::someone','personal');
 const actor={...identity,user_id:'owner1',memberships:[
  ...identity.memberships,{...mPersonal,tenant_id:'personal::someone'}]};
 assert.equal(run(workspace('personal::someone','personal'),other,actor).reason,'WORKSPACE_DENIED');
 assert.equal(run(workspace('personal::owner1','personal'),
  {...item('personal::owner1','personal'),owner_user_id:'someone'},actor).reason,'OWNER_BOUNDARY_DENIED');
});
test('company, store, domain and classification apply inside same tenant',()=>{
 const base=item('grupo_erick','grupo_erick');
 const w=workspace('grupo_erick','grupo_erick');
 assert.equal(run(w,{...base,visibility:'scoped',company_id:'company1',store_id:'store1'}).allowed,true);
 assert.equal(run(w,{...base,visibility:'scoped',company_id:'company2'}).reason,'COMPANY_BOUNDARY_DENIED');
 assert.equal(run(w,{...base,visibility:'scoped',store_id:'store2'}).reason,'STORE_BOUNDARY_DENIED');
 assert.equal(run(w,{...base,visibility:'scoped'}).reason,'EMPTY_SCOPED_RECORD_DENIED');
 assert.equal(run(w,{...base,domain:'saude'}).reason,'DOMAIN_OR_CLASSIFICATION_DENIED');
 assert.equal(run(w,{...base,classification:'confidential'}).reason,'DOMAIN_OR_CLASSIFICATION_DENIED');
 assert.equal(run(w,{...base,classification:'restricted'}).reason,'MEMORY_TRUST_DENIED');
});
test('draft, revoked, stale, unverified or incomplete facts never enter retrieval',()=>{
 const base=item('grupo_erick','grupo_erick'),w=workspace('grupo_erick','grupo_erick');
 for(const broken of [
  {status:'pending'}, {status:'revoked'}, {source_status:'claimed'},
  {expires_at:now-1}, {expires_at:now}, {id:''}]){
  assert.equal(run(w,{...base,...broken}).allowed,false);
 }
 assert.equal(run(w,base,{...identity,memberships:[
  {...mGroup,allowed_domains:['projetos','projetos']},mClient,mPersonal
 ]}).reason,'MEMBERSHIP_SCOPE_DENIED');
 assert.equal(run(w,base,{...identity,memberships:[
  mGroup,mGroup,mClient,mPersonal
 ]}).reason,'MEMBERSHIP_DENIED');
});
test('permission decision is metadata-only, no secret or content included',()=>{
 const w=workspace('grupo_erick','grupo_erick');
 const r=run(w,{...item('grupo_erick','grupo_erick'),content:'private note'});
 assert.equal(r.allowed,true);
 assert.equal(r.executed,false);
 assert.deepEqual(Object.keys(r).sort(),['allowed','executed','memory_id','reason','tenant_id']);
 assert.equal(JSON.stringify(r).includes('private note'),false);
});
