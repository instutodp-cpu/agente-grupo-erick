'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compareAdmittedCardSources } = require('../src/core/financeiro-card-source-admission');

const now = '2026-10-24T15:00:00.000Z';
const scope = Object.freeze({
  tenant_id:'grupo_erick',workspace_type:'grupo_erick',company_id:'erick_calcados',
  user_id:'owner1',store_ids:['barreiros'],permission:'financeiro.receivables.read'
});
function binding(kind,over={}) {
  return { connection_id:'conn_'+kind,connector_id:'mock_rede_'+kind,
    tenant_id:scope.tenant_id,company_id:scope.company_id,provider_id:'rede',
    kind,state:'mock_only',environment:'staging',
    permission:'financeiro.receivables.read',config_version:1,
    valid_until:'2026-10-25T15:00:00.000Z',
    store_merchants:[{store_id:'barreiros',merchant_id:'merchant_01'}],...over};
}
function row(tx,amount,over={}) {
  return { tenant_id:scope.tenant_id, company_id:scope.company_id,
    store_id:'barreiros',merchant_id:'merchant_01',transaction_ref:tx,
    installment:1,gross_cents:amount,...over };
}
function snapshot(kind,records,over={}) {
  return { connection_id:'conn_'+kind,tenant_id:scope.tenant_id,
    company_id:scope.company_id,provider_id:'rede',kind,
    source_ref:'fixture_'+kind,observed_at:'2026-10-24T14:00:00.000Z',
    period:{from:'2026-10-01',to:'2026-10-24'},
    records,source_total_count:records.length,has_more:false,pages_verified:true,
    snapshot_consistent:true,...over };
}
function run({
  authorized_scope=scope,
  trusted_connections=[binding('pos'),binding('acquirer')],
  normalized_snapshots=[snapshot('pos',[row('tx1',10000)]),
    snapshot('acquirer',[row('tx1',10000)])]
}={}) {
  return compareAdmittedCardSources({
    authorized_scope,trusted_connections,normalized_snapshots,now
  });
}
test('same-company mock-only source pair feeds existing read-only comparator',()=>{
  const result=run();
  assert.equal(result.status,'comparison_complete');
  assert.equal(result.summary.matched,1);
  assert.equal(result.admission_mode,'mock_only');
  assert.equal(result.trusted_connection_count,2);
  assert.equal(result.executed,false);
  assert.equal(result.real_provider_called,false);
  assert.equal(result.payment_recorded,false);
});
test('a second SaaS tenant reuses code with separate scoped connections',()=>{
  const tenant='client::clientb',company='company_b';
  const a=runSaaSPair(tenant,company);
  assert.equal(a.tenant_id,tenant);
  assert.equal(a.company_id,company);
  assert.equal(a.summary.matched,1);
});
function runSaaSPair(tenant,company){
  return run({
    authorized_scope:{...scope,workspace_type:'external_client',tenant_id:tenant,company_id:company},
    trusted_connections:[binding('pos',{tenant_id:tenant,company_id:company}),
      binding('acquirer',{tenant_id:tenant,company_id:company})],
    normalized_snapshots:['pos','acquirer'].map(kind=>
      snapshot(kind,[row('tx1',10000,{tenant_id:tenant,company_id:company})],
        {tenant_id:tenant,company_id:company}))
  });
}
test('only matching registered tenant and company may supply a source',()=>{
  assert.throws(()=>run({trusted_connections:[binding('pos',{tenant_id:'client::other'}),
    binding('acquirer')]}),/connection_not_authorized/);
  assert.throws(()=>run({normalized_snapshots:[snapshot('pos',[],{company_id:'other'}),
    snapshot('acquirer',[])]}),/snapshot_identity_mismatch/);
  assert.throws(()=>run({normalized_snapshots:[snapshot('pos',
    [row('tx1',100,{company_id:'other'})]),
    snapshot('acquirer',[])]}),/snapshot_merchant_or_tenant_mismatch/);
});
test('unknown, duplicate and missing connections deny',()=>{
  assert.throws(()=>run({normalized_snapshots:[snapshot('pos',[],{connection_id:'not_registered'}),
    snapshot('acquirer',[])]}),/snapshot_unbound_or_duplicate/);
  assert.throws(()=>run({trusted_connections:[binding('pos'),binding('pos')]}),
    /duplicate_connection/);
  assert.throws(()=>run({trusted_connections:[binding('pos'),binding('acquirer')],
    normalized_snapshots:[snapshot('pos',[]),snapshot('pos',[])]}),
    /snapshot_unbound_or_duplicate/);
});
test('inactive or production/expired configuration never becomes active by implication',()=>{
  for (const override of [{state:'read_only_active'},{state:'revoked'},
    {environment:'production'},{valid_until:'2026-10-23T00:00:00.000Z'},
    {permission:'financeiro.payments.write'},{config_version:0}]) {
    assert.throws(()=>run({trusted_connections:[binding('pos',override),
      binding('acquirer')]}),/connection_not_authorized/);
  }
});
test('store/merchant pair is always checked; parallel allowlists are insufficient',()=>{
  assert.throws(()=>run({normalized_snapshots:[snapshot('pos',
    [row('tx1',100,{merchant_id:'merchant_other'})]),
    snapshot('acquirer',[])]}),/snapshot_merchant_or_tenant_mismatch/);
  assert.throws(()=>run({trusted_connections:[binding('pos',
    {store_merchants:[{store_id:'sirinhaem',merchant_id:'merchant_01'}]}),
    binding('acquirer')]}),/merchant_scope_invalid/);
  assert.throws(()=>run({trusted_connections:[binding('pos'),
    binding('acquirer',{store_merchants:[{store_id:'barreiros',merchant_id:'merchant_02'}]})]}),
    /unmatched_merchant_mapping/);
});
test('incomplete pagination never generates a confirmed missing-card divergence',()=>{
  const result=run({normalized_snapshots:[
    snapshot('pos',[row('tx1',100)]),
    snapshot('acquirer',[],{source_total_count:10,has_more:true,pages_verified:false})
  ]});
  assert.equal(result.status,'partial_evidence');
  assert.equal(result.summary.coverage_unconfirmed,1);
  assert.equal(result.summary.missing_at_acquirer,0);
  assert.equal(result.reports[0].sources[1].complete,false);
});
test('source total does not imply completeness when cursor or snapshot not verified',()=>{
  for (const extra of [{has_more:true},{pages_verified:false},
    {snapshot_consistent:false},{source_total_count:null}]) {
    const r=run({normalized_snapshots:[snapshot('pos',[row('tx1',100)]),
      snapshot('acquirer',[row('tx1',100)],extra)]});
    assert.equal(r.status,'partial_evidence');
    assert.equal(r.reports[0].sources[1].complete,false);
  }
});
test('rejects forged complete flag, extra provider fields and payment data',()=>{
  assert.throws(()=>run({normalized_snapshots:[snapshot('pos',[],
    {complete:true}),snapshot('acquirer',[])]}),/snapshot_invalid/);
  assert.throws(()=>run({trusted_connections:[binding('pos',{secret:'token'}),
    binding('acquirer')]}),/connection_not_authorized/);
  assert.throws(()=>run({normalized_snapshots:[snapshot('pos',
    [row('tx1',100,{cardholder_name:'person'})]),snapshot('acquirer',[])]}),
    /snapshot_merchant_or_tenant_mismatch/);
});
test('freshness limit, future records and inconsistent total fail closed',()=>{
  assert.throws(()=>run({normalized_snapshots:[snapshot('pos',[],
    {observed_at:'2026-10-22T11:00:00.000Z'}),snapshot('acquirer',[])]}),
    /snapshot_invalid/);
  assert.throws(()=>run({normalized_snapshots:[snapshot('pos',[],
    {observed_at:'2026-10-25T11:00:00.000Z'}),snapshot('acquirer',[])]}),
    /snapshot_invalid/);
  assert.throws(()=>run({normalized_snapshots:[snapshot('pos',[row('tx1',1)],
    {source_total_count:0}),snapshot('acquirer',[])]}),/snapshot_invalid/);
});
test('malformed membership context cannot bypass the underlying comparator',()=>{
  assert.throws(()=>run({authorized_scope:{...scope,permission:'financeiro.payments.write'}}),
    /trusted_scope_required/);
  assert.throws(()=>run({authorized_scope:{...scope,workspace_type:'personal'}}),
    /card_reconciliation_scope_blocked/);
});
test('provider pairs need exactly one POS and one acquirer, with equal merchants',()=>{
  assert.throws(()=>run({trusted_connections:[binding('pos'),
    binding('pos',{connection_id:'other_pos'})]}),/ambiguous_connection_pair/);
  assert.throws(()=>run({trusted_connections:[binding('pos'),
    binding('acquirer',{provider_id:'senff'})]}),/unpaired_connections/);
});
