'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../');
const migration=fs.readFileSync(path.join(root,
 '../../migrations/hermes/050_create_personal_archive_authenticated_rpc.sql'),'utf8');
const html=fs.readFileSync(path.join(root,'brain-web/personal.html'),'utf8');
const script=fs.readFileSync(path.join(root,'brain-web/personal-app.js'),'utf8');

test('personal RPCs are public-API invokers, auth.uid owner-scoped and anon denied',()=>{
 assert.doesNotThrow(()=>new Function(script));
 assert.match(migration,/SECURITY INVOKER SET search_path=''/g);
 const functions=['hermes_personal_source_status',
  'hermes_personal_source_consent','hermes_personal_source_revoke',
  'hermes_personal_source_erase','hermes_personal_history_search'];
 for(const name of functions){
  assert.match(migration,new RegExp('CREATE OR REPLACE FUNCTION public[.]'+name+'\\('));
  assert.match(migration,new RegExp('REVOKE ALL ON FUNCTION public[.]'+name+'\\('));
 }
 assert.match(migration,/current_user <> 'authenticated' OR auth[.]uid\(\) IS NULL/g);
 assert.match(migration,/owner_user_id=auth[.]uid\(\)/);
 assert.match(migration,/g[.]revoked_at IS NULL/);
 assert.match(migration,/ON CONFLICT \(owner_user_id,provider\) DO NOTHING/);
 assert.match(migration,/pg_catalog[.]plainto_tsquery\('simple',p_query\)/);
 assert.match(migration,/GRANT EXECUTE ON FUNCTION/);
 assert.doesNotMatch(migration,/SECURITY DEFINER|GRANT ALL|SET ROLE|service_role|DROP TABLE/i);
 assert.doesNotMatch(migration,/CREATE TABLE|ALTER TABLE|INSERT INTO hermes_brain[.]memory_items/i);
});

test('staging personal page is separate, no direct upload or corporate operations',()=>{
 assert.match(html,/name="robots" content="noindex,nofollow,noarchive"/);
 assert.match(html,/Content-Security-Policy/);
 assert.match(html,/integrity="sha384-/);
 assert.match(html,/personal-app[.]js/);
 assert.match(html,/id="ownerArea" hidden/);
 assert.match(html,/id="chatgptConsent" type="checkbox"/);
 assert.match(html,/id="claudeConsent" type="checkbox"/);
 assert.match(html,/id="eraseConfirm"/);
 assert.doesNotMatch(html,/type="file"|id="upload"|grupo_erick|service_role/i);
 assert.match(script,/location[.]pathname!=='\/brain\/personal[.]html'/);
 assert.match(script,/persistSession:false/);
 assert.match(script,/shouldCreateUser:false/);
 assert.match(script,/client[.]auth[.]getSession\(\)/);
 assert.match(script,/client[.]auth[.]getUser\(\)/);
 assert.match(script,/client[.]rpc\(name,args\)/);
 assert.match(script,/receipt!==true/);
 assert.match(script,/confirmation!=='EXCLUIR'/);
 assert.match(script,/item[.]trust_level!=='unreviewed_personal_archive'/);
 assert.doesNotMatch(script,/innerHTML|localStorage|sessionStorage|fetch\(|\bservice_role\b|grupo_erick|memory_items/i);
});
function setup(origin='https://hermes-staging.grupoerick.tech',userPresent=true,rpcUnavailable=false){
 const el=new Map(),calls=[];
 function element(id){
  if(!el.has(id))el.set(id,{id,hidden:false,disabled:false,
   value:'',checked:false,textContent:'',listeners:{},children:[],
   addEventListener(name,fn){this.listeners[name]=fn},
   appendChild(x){this.children.push(x)},
   append(...xs){this.children.push(...xs)},
   replaceChildren(){this.children=[]},
   querySelector(){return {disabled:false}}
  });
  return el.get(id);
 }
 const states=new Map([['chatgpt','not_connected'],['claude','not_connected']]);
 const client={
  auth:{
   getUser:async()=>({data:{user:userPresent?{email:'owner@example.test'}:null},
     error:userPresent?null:Error('unauthorized')}),
   getSession:async()=>({data:{session:userPresent?{access_token:'synthetic_fixture'}:null},error:null}),
   signInWithOtp:async()=>({error:null}),
   signOut:async()=>({error:null})
  },
  rpc:async(name,args)=>{
   calls.push({name,args});
   if(name==='hermes_personal_source_status'&&rpcUnavailable)
    return {error:Error('synthetic_rpc_not_deployed'),data:null};
   if(name==='hermes_personal_source_status')return {error:null,data:
    [...states].map(([provider,status])=>({provider,status,archived_messages:0}))};
   if(name==='hermes_personal_source_consent'){
    states.set(args.p_provider,'authorized');return {error:null,data:'authorized'};
   }
   if(name==='hermes_personal_source_revoke'){
    states.set(args.p_provider,'revoked');return {error:null,data:true};
   }
   if(name==='hermes_personal_source_erase'){
    states.set(args.p_provider,'not_connected');return {error:null,data:true};
   }
   if(name==='hermes_personal_history_search')return {error:null,data:[]};
   return {error:Error('unexpected'),data:null};
  }
 };
 const context={
  location:{origin,pathname:'/brain/personal.html'},
  document:{currentScript:{dataset:{
    publishableKey:'sb_publishable_example',supabaseUrl:'https://example.supabase.co'
   }},getElementById:element,createElement:(tag)=>element('dynamic:'+tag)},
  window:{supabase:{createClient:()=>client}},
  console:{error:()=>{}}
 };
 vm.runInNewContext(script,context,{timeout:3000});
 return {element,calls,states,client};
}
const tick=async()=>{for(let i=0;i<60;i++)await Promise.resolve()};
test('wrong origin is refused without accessing Supabase or returning content',()=>{
 const x=setup('https://evil.example');
 assert.equal(x.element('ownerArea').hidden,true);
 assert.equal(x.calls.length,0);
 assert.match(x.element('status').textContent,/não autorizado/);
});
test('unauthenticated session keeps consent and search completely hidden',async()=>{
 const x=setup(undefined,false);await tick();
 assert.equal(x.element('ownerArea').hidden,true);
 assert.equal(x.calls.length,0);
 assert.match(x.element('status').textContent,/Sem acesso pessoal confirmado/);
});
test('login unlocks only owner UI; source consent requires explicit checkbox',async()=>{
 const x=setup();await tick();
 assert.equal(x.element('ownerArea').hidden,false);
 assert.equal(x.element('loginArea').hidden,true);
 assert.equal(x.element('chatgptGrant').disabled,false);
 assert.equal(x.element('claudeGrant').disabled,false);
 const grantClick=x.element('chatgptGrant').listeners.click;
 assert.equal(typeof grantClick,'function');
 await grantClick({currentTarget:{disabled:false}});await tick();
 assert(!x.calls.some(c=>c.name==='hermes_personal_source_consent'));
 x.element('chatgptConsent').checked=true;
 await grantClick({currentTarget:{disabled:false}});await tick();
 assert.equal(x.states.get('chatgpt'),'authorized');
 assert.equal(x.states.get('claude'),'not_connected');
 assert.equal(x.element('chatgptGrant').disabled,true);
 assert.equal(x.element('chatgptRevoke').disabled,false);
 const revoke=x.element('chatgptRevoke').listeners.click;
 await revoke({currentTarget:{disabled:false}});await tick();
 assert.equal(x.states.get('chatgpt'),'revoked');
 assert.equal(x.element('chatgptRevoke').disabled,true);
});
test('explicit EXCLUIR is required before deletion of personal source',async()=>{
 const x=setup();await tick();
 const erase=x.element('erase').listeners.click;
 x.element('eraseProvider').value='claude';
 await erase({currentTarget:{disabled:false}});await tick();
 assert(!x.calls.some(c=>c.name==='hermes_personal_source_erase'));
 x.element('eraseConfirm').value='EXCLUIR';
 await erase({currentTarget:{disabled:false}});await tick();
 assert(x.calls.some(c=>c.name==='hermes_personal_source_erase'
  &&c.args.p_provider==='claude'));
});

test('verified login remains visible but ALL private operations fail closed before RPC deployment',async()=>{
 const x=setup(undefined,true,true);await tick();
 assert.equal(x.element('ownerArea').hidden,false);
 assert.equal(x.element('loginArea').hidden,true);
 assert.match(x.element('ownerIdentity').textContent,/Identidade confirmada/);
 assert.match(x.element('status').textContent,/módulo pessoal ainda não está habilitado/);
 assert.equal(x.element('chatgptGrant').disabled,true);
 assert.equal(x.element('claudeGrant').disabled,true);
 assert.equal(x.element('chatgptRevoke').disabled,true);
 assert.equal(x.element('claudeRevoke').disabled,true);
 assert.equal(x.element('erase').disabled,true);
 assert.equal(x.element('results').children.length,0);
 // Even synthetic click bypassing a disabled button must not reach a write RPC.
 x.element('chatgptConsent').checked=true;
 await x.element('chatgptGrant').listeners.click({
  currentTarget:{disabled:false}
 });
 assert(!x.calls.some(c=>c.name==='hermes_personal_source_consent'));
 assert.equal(x.states.get('chatgpt'),'not_connected');
});
test('authenticated identity alone cannot search or erase when services are unavailable',async()=>{
 const x=setup(undefined,true,true);await tick();
 const before=x.calls.length;
 x.element('provider').value='chatgpt';
 x.element('query').value='Hermes';
 await x.element('searchForm').listeners.submit({
  preventDefault(){},currentTarget:{querySelector:()=>({disabled:false})}
 });
 x.element('eraseProvider').value='claude';
 x.element('eraseConfirm').value='EXCLUIR';
 await x.element('erase').listeners.click({currentTarget:{disabled:false}});
 assert.equal(x.calls.length,before);
 assert.equal(x.element('results').children.length,0);
});
