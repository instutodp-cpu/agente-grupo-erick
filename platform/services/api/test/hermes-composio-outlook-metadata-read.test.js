'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHermesComposioOutlookMetadataRead,
  parseSummary, readCredential} =
  require('../src/runtime/hermes-composio-outlook-metadata-read');

const env = () => ({
  HERMES_COMPOSIO_OUTLOOK_METADATA_ENABLED:'true',
  HERMES_COMPOSIO_OUTLOOK_OWNER_USER_ID:'owner-fixture',
  HERMES_DEPLOYMENT_STAGE:'staging',
  HERMES_EXECUTION_ENABLED:'false',
  HERMES_EXECUTION_KILL_SWITCH:'true',
  HERMES_MISSION_INGRESS_ENABLED:'false'
});
const identity = () => ({
  tenant_id:'grupo_erick', workspace_type:'corporate',
  organization_id:'grupo_erick', connector_scope:'corporate_private',
  group_scope:'grupo_erick_all_companies',
  scope_source:'authenticated_session', company_id:null, store_id:null,
  principal:{type:'machine',id:'outlook-reader-fixture'},
  key_id:'reader-key-fixture', user_id:'owner-fixture',
  role:'admin', user_scope:'owner_director'
});
const messages = () => [
  {id:'never-return-this-id',receivedDateTime:'2026-11-11T13:00:00Z',
    isRead:false,hasAttachments:true,subject:'never-return-this-subject',
    body:{content:'never-return-this-body'}},
  {id:'also-secret',receivedDateTime:'2026-11-10T09:00:00Z',
    isRead:true,hasAttachments:false}
];
function fakeFetch(calls, {invalidResponse=false}={}) {
  return async (url, options) => {
    assert.equal(url,'https://connect.composio.dev/mcp');
    assert.equal(options.method,'POST');
    assert.equal(options.redirect,'error');
    assert.equal(options.headers['x-consumer-api-key'],'ck_fixture_only_secret');
    const body = JSON.parse(options.body);
    calls.push(body);
    if (body.method === 'initialize')
      return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,
        result:{protocolVersion:'2025-03-26',serverInfo:{name:'fixture'}}}),
        {status:200,headers:{'Content-Type':'application/json',
          'mcp-session-id':'session-fixture'}});
    assert.equal(body.method,'tools/call');
    assert.equal(options.headers['mcp-session-id'],'session-fixture');
    const params = body.params;
    assert.equal(params.name,'COMPOSIO_MULTI_EXECUTE_TOOL');
    assert.equal(params.arguments.tools.length,1);
    const tool = params.arguments.tools[0];
    assert.equal(tool.tool_slug,'OUTLOOK_LIST_MESSAGES');
    assert.equal(tool.account,'outlook-inicial');
    assert.equal(tool.arguments.top,10);
    assert.deepEqual(tool.arguments.select,
      ['id','receivedDateTime','isRead','hasAttachments']);
    assert.equal(tool.arguments.folder,'inbox');
    assert.equal(tool.arguments.response_detail,'minimal');
    const result = invalidResponse ?
      {successful:true,data:{results:[]}} :
      {successful:true,data:{results:[{
        tool_slug:'OUTLOOK_LIST_MESSAGES',
        response:{successful:true,data:{value:messages()}}
      }]}};
    return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,
      result:{content:[{type:'text',text:JSON.stringify(result)}]}}),
      {status:200,headers:{'Content-Type':'application/json'}});
  };
}
function fixture({environment=env(),readUsage=async()=>0,
  appendAudit, fetchImpl, credentialReader=()=> 'ck_fixture_only_secret',
  maxRequests=10}={}) {
  const calls=[], audit=[];
  const pilot=createHermesComposioOutlookMetadataRead({
    environment, readUsage,
    appendAudit:appendAudit || (async item=>{audit.push(item);}),
    fetchImpl:fetchImpl || fakeFetch(calls), credentialReader,
    maxRequests, clock:()=>Date.parse('2026-11-11T16:00:00Z')
  });
  return {pilot,calls,audit};
}
test('default disabled; no credential, network, or audit',async()=>{
  const f=fixture({environment:{}});
  assert.equal((await f.pilot.run({identity:identity()})).status,'disabled');
  assert.equal(f.calls.length,0);
  assert.equal(f.audit.length,0);
});
test('deny unconfigured group owner and wrong tenant, store or company context',async()=>{
  const e=env(); delete e.HERMES_COMPOSIO_OUTLOOK_OWNER_USER_ID;
  const f=fixture({environment:e});
  assert.equal((await f.pilot.run({identity:identity()})).status,
    'group_owner_not_configured');
  const g=fixture();
  for (const change of [
    {tenant_id:'external_client'},{workspace_type:'personal'},
    {organization_id:'other'},{company_id:'erick_calcados'},
    {store_id:'barreiros'}, {connector_scope:'personal_private'},
    {group_scope:'erick_calcados_only'},
    {scope_source:'prompt'},
    {role:'financeiro'},{role:'gerente_loja'},
    {user_scope:'finance_user'},
    {user_id:'store-manager'}, {user_id:''},
    {principal:{type:'human',id:'x'}}
  ]) {
    assert.equal((await g.pilot.run({identity:{...identity(),...change}})).status,
      'identity_scope_invalid');
  }
  assert.equal(g.calls.length,0);
  assert.equal(g.audit.length,0);
});
test('deny when execution kill switch or staging boundary fails',async()=>{
  for (const patch of [
    {HERMES_DEPLOYMENT_STAGE:'production'},
    {HERMES_EXECUTION_KILL_SWITCH:'false'},
    {HERMES_EXECUTION_ENABLED:'true'},
    {HERMES_MISSION_INGRESS_ENABLED:'true'}
  ]) {
    const f=fixture({environment:{...env(),...patch}});
    assert.equal((await f.pilot.run({identity:identity()})).status,'disabled');
    assert.equal(f.calls.length,0);
  }
});
test('durable quota and audit fail closed before network',async()=>{
  const f=fixture({readUsage:async()=>10});
  assert.equal((await f.pilot.run({identity:identity()})).status,
    'request_budget_exhausted');
  assert.equal(f.calls.length,0);
  const g=fixture({readUsage:async()=>{throw Error('db');}});
  assert.equal((await g.pilot.run({identity:identity()})).status,
    'quota_store_unavailable');
  const h=fixture({appendAudit:async()=>{throw Error('db');}});
  assert.equal((await h.pilot.run({identity:identity()})).status,
    'audit_unavailable');
  assert.equal(h.calls.length,0);
});
test('usage budget is group-shared, never partitioned by store/company',async()=>{
  let usageRequest;
  const f=fixture({readUsage:async request=>{usageRequest=request;return 0;}});
  assert.equal((await f.pilot.run({identity:identity()})).status,'succeeded');
  assert.equal(usageRequest.tenant_id,'grupo_erick');
  assert.equal(usageRequest.scope_type,'group_shared');
  assert.equal(usageRequest.provider,'COMPOSIO_OUTLOOK');
  assert.equal(Object.hasOwn(usageRequest,'company_id'),false);
  assert.equal(Object.hasOwn(usageRequest,'store_id'),false);
});
test('only bounded metadata, no content, sender, IDs, or mutations returned',async()=>{
  const f=fixture();
  const result=await f.pilot.run({identity:identity()});
  assert.equal(result.status,'succeeded');
  assert.equal(result.sampled_messages,2);
  assert.equal(result.unread_messages,1);
  assert.equal(result.messages_with_attachments,1);
  assert.equal(result.earliest_date,'2026-11-10');
  assert.equal(result.latest_date,'2026-11-11');
  assert.equal(result.write_performed,false);
  assert.equal(result.content_read,false);
  assert.equal(result.messages_imported,0);
  assert.equal(f.calls.length,2);
  assert.deepEqual(f.audit.map(x=>x.event),['attempt','result']);
  assert.equal(f.audit[0].operation,'METADATA_READ');
  assert.equal(f.audit[0].scope_type,'group_shared');
  assert.equal(f.audit[0].tenant_id,'grupo_erick');
  assert.equal(f.audit[0].company_id,null);
  assert.equal(f.audit[0].store_id,null);
  assert.equal(f.audit[0].user_id,'owner-fixture');
  assert.equal(f.audit[1].outcome,'SUCCEEDED');
  const serialized=JSON.stringify({result,audit:f.audit});
  for (const sensitive of ['never-return-this','also-secret',
    'ck_fixture_only_secret']) assert.ok(!serialized.includes(sensitive));
});
test('malformed provider result fails closed without leaking data',async()=>{
  const calls=[];
  const f=fixture({fetchImpl:fakeFetch(calls,{invalidResponse:true})});
  const result=await f.pilot.run({identity:identity()});
  assert.equal(result.status,'provider_failed');
  assert.equal(result.write_performed,false);
  assert.equal(result.messages_imported,0);
  assert.deepEqual(f.audit.map(x=>x.event),['attempt','result']);
});
test('audit result failure fails closed even after successful provider',async()=>{
  let count=0;
  const f=fixture({appendAudit:async()=>{if (++count===2)throw Error('db');}});
  assert.equal((await f.pilot.run({identity:identity()})).status,
    'audit_unavailable_after_provider');
});
test('invalid or oversized provider metadata rejected',()=>{
  const wrap = values => ({content:[{type:'text',text:JSON.stringify({
    successful:true,data:{results:[{tool_slug:'OUTLOOK_LIST_MESSAGES',
      response:{successful:true,data:{value:values}}}]}
  })}]});
  assert.throws(()=>parseSummary(wrap(Array.from({length:11},()=>messages()[0]))));
  assert.throws(()=>parseSummary(wrap([{receivedDateTime:'invalid',
    isRead:false,hasAttachments:false}])));
});
test('credential file requires ck_ format and private file mode',()=>{
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
