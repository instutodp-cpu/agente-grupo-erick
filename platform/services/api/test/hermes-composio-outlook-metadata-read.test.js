'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHermesComposioOutlookMetadataRead,
  createComposioOutlookOwnerIdentityResolver,parseSummary,readCredential}=
  require('../src/runtime/hermes-composio-outlook-metadata-read');

const env=()=>({
  HERMES_COMPOSIO_OUTLOOK_METADATA_ENABLED:'true',
  HERMES_COMPOSIO_OUTLOOK_OWNER_USER_ID:'owner-fixture',
  HERMES_DEPLOYMENT_STAGE:'staging',
  HERMES_EXECUTION_ENABLED:'false',
  HERMES_EXECUTION_KILL_SWITCH:'true',
  HERMES_MISSION_INGRESS_ENABLED:'false'
});
const identity=()=>({
  tenant_id:'grupo_erick',workspace_type:'corporate',
  organization_id:'grupo_erick',connector_scope:'corporate_private',
  group_scope:'grupo_erick_all_companies',scope_source:'trusted_machine_owner_grant',
  company_id:null,store_id:null,
  principal:{type:'machine',id:'reader-fixture'},key_id:'reader-key-fixture',
  user_id:'owner-fixture',role:'admin',user_scope:'owner_director'
});
const approval=()=>({
  approval_id:'maestro-synthetic-approved-1',decision:'APPROVED',
  source:'maestro_control_plane',governance_review:'APPROVED',
  tenant_id:'grupo_erick',user_id:'owner-fixture',provider_id:'composio',
  account_alias:'outlook-inicial',operation:'OUTLOOK_LIST_MESSAGES',
  data_scope:'metadata_only',max_messages:10,read_only:true,one_time:true,
  approved_at:new Date(Date.now()-1000).toISOString(),
  expires_at:new Date(Date.now()+120000).toISOString()
});
const messages=()=>[
  {id:'never-return-this-id',receivedDateTime:'2026-11-11T13:00:00Z',
    isRead:false,hasAttachments:true},
  {id:'also-secret',receivedDateTime:'2026-11-10T09:00:00Z',
    isRead:true,hasAttachments:false}
];
function fakeFetch(calls,{invalidResponse=false,missingTool=false}={}) {
  return async (url,options)=>{
    assert.equal(url,'https://connect.composio.dev/mcp');
    assert.equal(options.method,'POST');
    assert.equal(options.redirect,'error');
    assert.equal(options.headers['x-consumer-api-key'],'ck_fixture_only_secret');
    const body=JSON.parse(options.body);
    calls.push(body);
    if(body.method==='initialize')
      return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,
        result:{protocolVersion:'2025-03-26',serverInfo:{name:'fixture'}}}),
        {status:200,headers:{'Content-Type':'application/json',
          'mcp-session-id':'session-fixture'}});
    if(body.method==='notifications/initialized') {
      assert.equal(body.id,undefined);
      return new Response(null,{status:202});
    }
    if(body.method==='tools/list')
      return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,
        result:{tools:missingTool?[]:[{name:'COMPOSIO_MULTI_EXECUTE_TOOL'}]}}),
        {status:200,headers:{'Content-Type':'application/json'}});
    assert.equal(body.method,'tools/call');
    assert.equal(options.headers['mcp-session-id'],'session-fixture');
    const params=body.params;
    assert.equal(params.name,'COMPOSIO_MULTI_EXECUTE_TOOL');
    assert.equal(params.arguments.tools.length,1);
    const tool=params.arguments.tools[0];
    assert.equal(tool.tool_slug,'OUTLOOK_LIST_MESSAGES');
    assert.equal(tool.account,'outlook-inicial');
    assert.equal(tool.arguments.top,10);
    assert.deepEqual(tool.arguments.select,
      ['id','receivedDateTime','isRead','hasAttachments']);
    assert.equal(tool.arguments.folder,'inbox');
    assert.deepEqual(Object.keys(tool.arguments).sort(),
      ['user_id','folder','top','select'].sort());
    const result=invalidResponse ?
      {successful:true,data:{results:[]}} :
      {successful:true,data:{results:[{tool_slug:'OUTLOOK_LIST_MESSAGES',
        response:{successful:true,data:{value:messages()}}}]}};
    return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,
      result:{content:[{type:'text',text:JSON.stringify(result)}]}}),
      {status:200,headers:{'Content-Type':'application/json'}});
  };
}
function fixture({environment=env(),resolveIdentity, reserveAttempt,
  appendOutcome,authorizeRead=async()=>approval(),fetchImpl,
  credentialReader=()=> 'ck_fixture_only_secret',
  maxRequests=10}={}) {
  const calls=[],audit=[];
  const pilot=createHermesComposioOutlookMetadataRead({
    environment,
    resolveIdentity:resolveIdentity||(async()=>identity()),
    reserveAttempt:reserveAttempt||(async item=>{
      audit.push({event:'attempt',...item});
      return {reserved:true,trace_id:item.trace_id};
    }),
    appendOutcome:appendOutcome||(async item=>{
      audit.push({event:'result',...item});
      return {persisted:true,trace_id:item.trace_id};
    }),
    fetchImpl:fetchImpl||fakeFetch(calls),credentialReader,maxRequests,
    authorizeRead
  });
  return {pilot,calls,audit};
}
const run=f=>f.pilot.run({authorization:'Bearer synthetic-machine-token'});
test('default disabled; no identity, credential, network, or audit',async()=>{
  const f=fixture({environment:{}});
  assert.equal((await run(f)).status,'disabled');
  assert.equal(f.calls.length,0);
  assert.equal(f.audit.length,0);
});
test('missing Maestro approval denies before audit, secrets or network',async()=>{
  const f=fixture({authorizeRead:null});
  assert.equal((await run(f)).status,'maestro_approval_unavailable');
  assert.equal(f.audit.length,0);
  assert.equal(f.calls.length,0);
  const g=fixture({authorizeRead:async()=>{throw Error('Maestro unavailable');}});
  assert.equal((await run(g)).status,'maestro_approval_unavailable');
  assert.equal(g.audit.length,0);
  assert.equal(g.calls.length,0);
});
test('Maestro approval requires fresh one-time scope and governance exception',async()=>{
  const invalid=[
    {decision:'PENDING'},{source:'caller_prompt'},
    {governance_review:'PENDING'},{tenant_id:'other'},
    {user_id:'another-owner'},{provider_id:'google_workspace_super'},
    {account_alias:'other'},{operation:'OUTLOOK_SEND_MAIL'},
    {data_scope:'full_content'},{max_messages:11},
    {read_only:false},{one_time:false},{approval_id:''},
    {approved_at:new Date(Date.now()-600000).toISOString(),
      expires_at:new Date(Date.now()+120000).toISOString()},
    {expires_at:new Date(Date.now()-1000).toISOString()}
  ];
  for(const patch of invalid){
    const f=fixture({authorizeRead:async()=>({...approval(),...patch})});
    assert.equal((await run(f)).status,'maestro_approval_unavailable');
    assert.equal(f.audit.length,0);
    assert.equal(f.calls.length,0);
  }
});
test('owner identity is resolved from trusted auth, not caller-supplied fields',async()=>{
  const f=fixture();
  const result=await f.pilot.run({authorization:'Bearer synthetic-machine-token',
    identity:{...identity(),tenant_id:'attacker',user_id:'attacker'}});
  assert.equal(result.status,'succeeded');
  assert.equal(f.audit[0].user_id,'owner-fixture');
  const g=fixture({resolveIdentity:async()=>{throw Error('auth failed');}});
  assert.equal((await run(g)).status,'identity_unavailable');
  assert.equal(g.calls.length,0);
});
test('deny unconfigured owner and wrong tenant, store or company scope',async()=>{
  const e=env();delete e.HERMES_COMPOSIO_OUTLOOK_OWNER_USER_ID;
  const f=fixture({environment:e});
  assert.equal((await run(f)).status,'group_owner_not_configured');
  for(const change of [
    {tenant_id:'external_client'},{workspace_type:'personal'},
    {organization_id:'other'},{company_id:'erick_calcados'},
    {store_id:'barreiros'},{connector_scope:'personal_private'},
    {group_scope:'erick_calcados_only'},{scope_source:'prompt'},
    {role:'financeiro'},{role:'gerente_loja'},
    {user_scope:'finance_user'},{user_id:'store-manager'},
    {user_id:''},{principal:{type:'human',id:'x'}}
  ]) {
    const g=fixture({resolveIdentity:async()=>({...identity(),...change})});
    assert.equal((await run(g)).status,'identity_scope_invalid');
    assert.equal(g.calls.length,0);
    assert.equal(g.audit.length,0);
  }
});
test('kill switch, production, execution and ingress gates block',async()=>{
  for(const patch of [
    {HERMES_DEPLOYMENT_STAGE:'production'},
    {HERMES_EXECUTION_KILL_SWITCH:'false'},
    {HERMES_EXECUTION_ENABLED:'true'},
    {HERMES_MISSION_INGRESS_ENABLED:'true'}
  ]) {
    const f=fixture({environment:{...env(),...patch}});
    assert.equal((await run(f)).status,'disabled');
    assert.equal(f.calls.length,0);
  }
});
test('atomic quota reservation fails closed before network',async()=>{
  const f=fixture({reserveAttempt:async()=>({
    reserved:false,reason:'request_budget_exhausted'})});
  assert.equal((await run(f)).status,'request_budget_exhausted');
  assert.equal(f.calls.length,0);
  const g=fixture({reserveAttempt:async()=>{throw Error('db');}});
  assert.equal((await run(g)).status,'audit_reservation_unavailable');
  assert.equal(g.calls.length,0);
  const h=fixture({reserveAttempt:async()=>({reserved:true,trace_id:'wrong'})});
  assert.equal((await run(h)).status,'audit_reservation_unavailable');
  assert.equal(h.calls.length,0);
});
test('only bounded metadata and aggregate audit, never content or IDs',async()=>{
  const f=fixture();
  const result=await run(f);
  assert.equal(result.status,'succeeded');
  assert.equal(result.sampled_messages,2);
  assert.equal(result.unread_messages,1);
  assert.equal(result.messages_with_attachments,1);
  assert.equal(result.earliest_date,'2026-11-10');
  assert.equal(result.latest_date,'2026-11-11');
  assert.equal(result.write_performed,false);
  assert.equal(result.content_read,false);
  assert.equal(result.messages_imported,0);
  assert.equal(f.calls.length,4);
  assert.deepEqual(f.audit.map(x=>x.event),['attempt','result']);
  assert.equal(f.audit[0].user_id,'owner-fixture');
  assert.equal(f.audit[0].max_requests,10);
  assert.equal(f.audit[1].outcome,'SUCCEEDED');
  assert.equal(f.audit[1].sampled_messages,2);
  const serialized=JSON.stringify({result,audit:f.audit});
  for(const sensitive of ['never-return-this','also-secret',
    'ck_fixture_only_secret']) assert.ok(!serialized.includes(sensitive));
});
test('real Composio SSE-style streaming envelopes parse correctly',async()=>{
  const calls=[];
  const base=fakeFetch(calls);
  const sseFetch=async(url,options)=>{
    const res=await base(url,options);
    if(res.status===202)return res;
    const json=await res.text();
    return new Response('event: message\ndata: '+json+'\n\n',{
      status:200,headers:{'Content-Type':'text/event-stream',
        'mcp-session-id':res.headers.get('mcp-session-id')||''}
    });
  };
  const f=fixture({fetchImpl:sseFetch});
  assert.equal((await run(f)).status,'succeeded');
  assert.equal(calls.length,4);
});
test('unadvertised Composio tool blocks Outlook invocation',async()=>{
  const calls=[];
  const f=fixture({fetchImpl:fakeFetch(calls,{missingTool:true})});
  const result=await run(f);
  assert.equal(result.status,'provider_failed');
  assert.equal(result.network_call_performed,true);
  assert.equal(calls.length,3);
  assert.deepEqual(calls.map(x=>x.method),
    ['initialize','notifications/initialized','tools/list']);
  assert.equal(f.audit[1].outcome,'FAILED');
});
test('oversized streaming tool response is rejected before Outlook call',async()=>{
  const calls=[];
  const base=fakeFetch(calls);
  const oversized=async(url,options)=>{
    const method=JSON.parse(options.body).method;
    if(method==='tools/list')
      return new Response('x'.repeat(130*1024),{status:200,
        headers:{'Content-Type':'text/event-stream'}});
    return base(url,options);
  };
  const f=fixture({fetchImpl:oversized});
  const result=await run(f);
  assert.equal(result.status,'provider_failed');
  assert.equal(result.network_call_performed,true);
  assert.deepEqual(calls.map(x=>x.method),
    ['initialize','notifications/initialized']);
});
test('malformed provider response fails closed with persisted FAILED outcome',async()=>{
  const calls=[];
  const f=fixture({fetchImpl:fakeFetch(calls,{invalidResponse:true})});
  assert.equal((await run(f)).status,'provider_failed');
  assert.deepEqual(f.audit.map(x=>x.event),['attempt','result']);
  assert.equal(f.audit[1].outcome,'FAILED');
  assert.equal(f.audit[1].sampled_messages,null);
});
test('failed or unacknowledged outcome persistence denies result',async()=>{
  const f=fixture({appendOutcome:async()=>{throw Error('db');}});
  assert.equal((await run(f)).status,'audit_unavailable_after_provider');
  const g=fixture({appendOutcome:async()=>({persisted:false})});
  assert.equal((await run(g)).status,'audit_unavailable_after_provider');
});
test('invalid or oversized provider metadata rejected',()=>{
  const wrap=values=>({content:[{type:'text',text:JSON.stringify({
    successful:true,data:{results:[{tool_slug:'OUTLOOK_LIST_MESSAGES',
      response:{successful:true,data:{value:values}}}]}
  })}]});
  assert.throws(()=>parseSummary(wrap(Array.from({length:11},()=>messages()[0]))));
  assert.throws(()=>parseSummary(wrap([{receivedDateTime:'invalid',
    isRead:false,hasAttachments:false}])));
});
test('provider returning body or subject despite select is rejected',()=>{
  const wrap=values=>({content:[{type:'text',text:JSON.stringify({
    successful:true,data:{results:[{tool_slug:'OUTLOOK_LIST_MESSAGES',
      response:{successful:true,data:{value:values}}}]}
  })}]});
  for(const extra of [{body:{content:'private'}},
    {subject:'private'},{from:{emailAddress:{address:'private'}}}])
    assert.throws(()=>parseSummary(wrap([{...messages()[0],...extra}])));
});
test('unrecognized message fields and malformed IDs fail closed',()=>{
  const wrap=values=>({content:[{type:'text',text:JSON.stringify({
    successful:true,data:{results:[{tool_slug:'OUTLOOK_LIST_MESSAGES',
      response:{successful:true,data:{value:values}}}]}
  })}]});
  assert.throws(()=>parseSummary(wrap([{...messages()[0],
    private_custom_field:'not requested'}])));
  assert.throws(()=>parseSummary(wrap([{...messages()[0],id:{secret:'nested'}}])));
  assert.throws(()=>parseSummary(wrap([{...messages()[0],id:''}])));
});
test('cannot raise Outlook canary daily quota above 10',()=>{
  assert.throws(()=>fixture({maxRequests:11}),/dependencies_invalid/);
});
test('credential requires ck_ format and private mode',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hermes-outlook-test-'));
  const p=path.join(dir,'key');
  try {
    fs.writeFileSync(p,'ck_fixture_only_secret',{mode:0o600});
    assert.equal(readCredential(p),'ck_fixture_only_secret');
    fs.chmodSync(p,0o644);
    assert.throws(()=>readCredential(p));
    fs.chmodSync(p,0o600);
    fs.writeFileSync(p,'ak_wrong_kind');
    assert.throws(()=>readCredential(p));
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('machine bearer plus trusted owner grant, no self-declared identity',async()=>{
  const registry={findByDigest:()=>({
    active:true,tenant_id:'grupo_erick',principal_id:'reader-fixture',
    key_id:'reader-key-fixture'
  })};
  let grantLookup;
  const resolver=createComposioOutlookOwnerIdentityResolver({
    registry,readOwnerGrant:async request=>{
      grantLookup=request;
      return {status:'active',source:'trusted_registry',user_id:'owner-fixture',
        tenant_id:request.tenant_id,key_id:request.key_id,
        principal_id:request.principal_id};
    }
  });
  const resolved=await resolver({authorization:'Bearer synthetic-machine-token',
    user_id:'attacker',role:'admin',company_id:'other'});
  assert.equal(resolved.user_id,'owner-fixture');
  assert.equal(resolved.tenant_id,'grupo_erick');
  assert.equal(resolved.company_id,null);
  assert.equal(resolved.group_scope,'grupo_erick_all_companies');
  assert.equal(grantLookup.key_id,'reader-key-fixture');
  const blocked=createComposioOutlookOwnerIdentityResolver({
    registry,readOwnerGrant:async()=>({
      status:'revoked',source:'trusted_registry',user_id:'owner-fixture'
    })
  });
  await assert.rejects(()=>blocked({authorization:'Bearer synthetic-machine-token'}));
  const wrongKey=createComposioOutlookOwnerIdentityResolver({
    registry,readOwnerGrant:async()=>({status:'active',
      source:'trusted_registry',tenant_id:'grupo_erick',
      key_id:'different-key',principal_id:'reader-fixture',user_id:'owner-fixture'})
  });
  await assert.rejects(()=>wrongKey({authorization:'Bearer synthetic-machine-token'}));
  const deniedResolver=createComposioOutlookOwnerIdentityResolver({
    registry:{findByDigest:()=>null},
    readOwnerGrant:async()=>{throw Error('must not query grant');}
  });
  await assert.rejects(()=>deniedResolver({authorization:'Bearer wrong-key'}));
});
