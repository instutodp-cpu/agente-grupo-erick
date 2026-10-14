'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { createServer } = require('../src/index');
const { createMachineIdentityRegistry } = require('../src/core/machine-identity-registry');
const { createOperationalMissionIngress } = require('../src/core/public-web-operational-mission-ingress');
const { computeCanonicalContentDigest } = require('../src/core/canonical-content-digest');
const { VERSION, PROVIDER, REQUIRED_DENIED_ACTIONS } = require('../src/core/public-web-operational-mission-envelope');

const TOKEN = 'maestro-test-machine-token';
function registry(tenant='grupo_erick') {
  return createMachineIdentityRegistry({ entries:[{
    key_id:'maestro-staging-key-1',
    key_digest:createHash('sha256').update(TOKEN).digest('hex'),
    principal_id:'maestro-control-plane', tenant_id:tenant, active:true
  }]});
}
function contract(overrides={}) {
  return {
    contract_version:'1.0', mission_id:'mission-1', run_id:null, workspace_id:'workspace-1', project_id:null,
    objective:'Research one public page.',
    context:JSON.stringify({public_web:{target_url:'https://example.com/docs',operation:'fetch_public_page_summary',source_type:'public_documentation_page',requested_content_types:['text/html','text/plain'],maximum_requests:1,redirects_allowed:false,timeout_ms:5000,maximum_response_bytes:100000}}),
    expected_outputs:['summary'],acceptance_criteria:['one public read'],priority:'media',approval_policy:'requer_aprovacao',
    allowed_tools:['public_web_read'],denied_actions:[...REQUIRED_DENIED_ACTIONS],budget:0,deadline:null,
    requested_by:{tipo:'usuario',id:'human:owner'},correlation_id:'corr-1',idempotency_key:'idem-1',callback:null,
    metadata:{tipo:'pesquisar',tags:'first-real-mission',issued_at:'2026-10-14T21:00:00.000Z',emitted_by:'human:owner'},
    ...overrides
  };
}
function envelope(overrides={}) {
  const c=contract(overrides.contract || {});
  return {version:VERSION,provider:PROVIDER,environment:'staging',production_allowed:false,dispatch_simulated:false,mission_run_id:'run-1',dispatch_token:'dispatch-token-1',idempotency_key:c.idempotency_key,correlation_id:c.correlation_id,contract_hash:computeCanonicalContentDigest(c),contract:c,...overrides,contract: c};
}
function memoryInbox() {
  const records=new Map();
  return { records, async admit(record) {
    const byRun=[...records.values()].find(v=>v.mission_run_id===record.mission_run_id || v.idempotency_key===record.idempotency_key);
    if (!byRun) { records.set(record.inbox_id,record); return {ok:true,status:'INSERTED'}; }
    if (byRun.inbox_id===record.inbox_id && byRun.contract_hash===record.contract_hash && byRun.dispatch_token_digest===record.dispatch_token_digest) return {ok:true,status:'IDEMPOTENT_REPLAY'};
    return {ok:false,status:'CONFLICT',reason:'mission_identity_or_contract_conflict'};
  }};
}
function policy() { return {principal_id:'maestro-control-plane',tenant_id:'grupo_erick',workspace_type:'corporate',workspace_ids:['workspace-1'],user_id:'human:owner',operator_id:'human:owner',approver_id:'human:owner',environment:'staging',production_allowed:false}; }
function request(port,{path='/internal/mission-dispatch',authorization,body=envelope()}={}) {
  return new Promise((resolve,reject)=>{
    const payload=JSON.stringify(body);
    const headers={'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)};
    if (authorization) headers.Authorization=authorization;
    const req=http.request({host:'127.0.0.1',port,method:'POST',path,headers},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({statusCode:res.statusCode,body:raw?JSON.parse(raw):null}));});
    req.on('error',reject); req.end(payload);
  });
}
async function withServer(t, options) {
  const server=createServer(options); await new Promise(r=>server.listen(0,r)); t.after(()=>new Promise(r=>server.close(r))); return server.address().port;
}

test('internal mission dispatch is fail-closed when ingress composition is absent', async t=>{
  const port=await withServer(t,{}); const res=await request(port,{authorization:`Bearer ${TOKEN}`});
  assert.equal(res.statusCode,503); assert.equal(res.body.execution_authorized,false); assert.equal(res.body.external_network_called,false);
});

test('internal mission dispatch requires authenticated machine bearer while health remains public', async t=>{
  const inbox=memoryInbox(); const ingress=createOperationalMissionIngress({inbox,policy:policy()});
  const port=await withServer(t,{machineIdentityRegistry:registry(),missionIngress:ingress});
  const noAuth=await request(port); assert.equal(noAuth.statusCode,401);
  const wrong=await request(port,{authorization:'Bearer wrong-token'}); assert.equal(wrong.statusCode,401);
  const health=await new Promise((resolve,reject)=>{http.get({host:'127.0.0.1',port,path:'/health'},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({statusCode:res.statusCode,body:JSON.parse(raw)}));}).on('error',reject);});
  assert.equal(health.statusCode,200); assert.equal(health.body.status,'ok');
});

test('valid authenticated mission is durably admitted once and replay is idempotent without execution', async t=>{
  const inbox=memoryInbox(); const ingress=createOperationalMissionIngress({inbox,policy:policy()});
  const port=await withServer(t,{machineIdentityRegistry:registry(),missionIngress:ingress});
  const first=await request(port,{authorization:`Bearer ${TOKEN}`});
  assert.equal(first.statusCode,202); assert.equal(first.body.status,'PUBLIC_WEB_OPERATIONAL_MISSION_ADMITTED');
  assert.equal(first.body.idempotent,false); assert.equal(first.body.execution_authorized,false); assert.equal(first.body.execution_started,false); assert.equal(first.body.external_network_called,false); assert.equal(first.body.production_allowed,false);
  assert.equal(inbox.records.size,1); const stored=[...inbox.records.values()][0]; assert.equal(stored.mission_payload.dispatch_token,undefined); assert.match(stored.dispatch_token_digest,/^sha256:[0-9a-f]{64}$/);
  const second=await request(port,{authorization:`Bearer ${TOKEN}`});
  assert.equal(second.statusCode,200); assert.equal(second.body.status,'PUBLIC_WEB_OPERATIONAL_MISSION_ALREADY_ADMITTED'); assert.equal(second.body.idempotent,true); assert.equal(inbox.records.size,1);
});

test('tenant workspace and contract drift fail closed before execution', async t=>{
  const inbox=memoryInbox(); const ingress=createOperationalMissionIngress({inbox,policy:policy()});
  const wrongTenantPort=await withServer(t,{machineIdentityRegistry:registry('other_tenant'),missionIngress:ingress});
  const wrongTenant=await request(wrongTenantPort,{authorization:`Bearer ${TOKEN}`}); assert.equal(wrongTenant.statusCode,403);

  const port=await withServer(t,{machineIdentityRegistry:registry(),missionIngress:ingress});
  const wrongWorkspace=envelope({contract:{workspace_id:'workspace-2'}}); // overwritten contract re-hashed by helper
  const workspaceRes=await request(port,{authorization:`Bearer ${TOKEN}`,body:wrongWorkspace}); assert.equal(workspaceRes.statusCode,403);
  const drift=envelope(); drift.contract.objective='tampered after hashing';
  const driftRes=await request(port,{authorization:`Bearer ${TOKEN}`,body:drift}); assert.equal(driftRes.statusCode,400);
  assert.equal(inbox.records.size,0);
});
