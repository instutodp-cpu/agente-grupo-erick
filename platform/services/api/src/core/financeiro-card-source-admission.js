'use strict';

// Admission to the existing pure Financeiro comparator. This code must receive
// trusted Maestro scope + connector lifecycle metadata, never chat/provider claims.
// Only synthetic staging fixtures are accepted in this increment.
const { compareCardAcquirerSources } = require('./financeiro-card-acquirer-read-only');

const ID = /^[A-Za-z0-9:_-]{1,80}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const BINDING_KEYS = ['connection_id','connector_id','tenant_id','company_id','provider_id',
  'kind','state','environment','permission','config_version','valid_until','store_merchants'];
const MERCHANT_KEYS = ['store_id','merchant_id'];
const SNAPSHOT_KEYS = ['connection_id','tenant_id','company_id','provider_id','kind',
  'source_ref','observed_at','period','records','source_total_count',
  'has_more','pages_verified','snapshot_consistent'];
const RECORD_KEYS = ['tenant_id','company_id','store_id','merchant_id',
  'transaction_ref','installment','gross_cents'];

function deny(reason) { throw Error('card_source_admission_' + reason); }
function exact(obj, keys) {
  return obj !== null && typeof obj === 'object' && !Array.isArray(obj) &&
    Object.keys(obj).length === keys.length &&
    keys.every(k => Object.hasOwn(obj,k));
}
function id(v) { return typeof v === 'string' && ID.test(v); }
function instant(v) {
  return typeof v === 'string' && TIMESTAMP.test(v) &&
    !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v;
}
function asTime(v) { return instant(v) ? Date.parse(v) : NaN; }
function pairKey(p) { return p.store_id + '\0' + p.merchant_id; }
function pairs(binding, scope) {
  if (!Array.isArray(binding.store_merchants) ||
      binding.store_merchants.length < 1 || binding.store_merchants.length > 100)
    deny('merchant_scope_invalid');
  const list = [];
  for (const p of binding.store_merchants) {
    if (!exact(p,MERCHANT_KEYS) || !id(p.store_id) || !id(p.merchant_id) ||
        !scope.store_ids.includes(p.store_id)) deny('merchant_scope_invalid');
    list.push(pairKey(p));
  }
  if (new Set(list).size !== list.length) deny('merchant_scope_duplicated');
  return new Set(list);
}

function compareAdmittedCardSources({
  authorized_scope, trusted_connections, normalized_snapshots, now
} = {}) {
  // Caller still MUST validate JWT, membership, active workspace selection and
  // provider lifecycle via existing Maestro gates; shape checks cannot do AuthN.
  if (!authorized_scope || !Array.isArray(authorized_scope.store_ids) ||
      !id(authorized_scope.tenant_id) || !id(authorized_scope.company_id) ||
      !id(authorized_scope.user_id) ||
      authorized_scope.permission !== 'financeiro.receivables.read' ||
      !instant(now)) deny('trusted_scope_required');
  if (!Array.isArray(trusted_connections) ||
      trusted_connections.length < 2 || trusted_connections.length > 30 ||
      !Array.isArray(normalized_snapshots) ||
      normalized_snapshots.length !== trusted_connections.length)
    deny('source_count_invalid');

  const connections = new Map();
  const groups = new Map();
  for (const connection of trusted_connections) {
    if (!exact(connection,BINDING_KEYS) || !id(connection.connection_id) ||
        !id(connection.connector_id) || !id(connection.provider_id) ||
        connection.tenant_id !== authorized_scope.tenant_id ||
        connection.company_id !== authorized_scope.company_id ||
        !['pos','acquirer'].includes(connection.kind) ||
        connection.state !== 'mock_only' ||
        connection.environment !== 'staging' ||
        connection.permission !== 'financeiro.receivables.read' ||
        !Number.isSafeInteger(connection.config_version) ||
        connection.config_version < 1 ||
        !instant(connection.valid_until) || asTime(connection.valid_until) <= asTime(now))
      deny('connection_not_authorized');
    if (connections.has(connection.connection_id)) deny('duplicate_connection');
    const merchants = pairs(connection,authorized_scope);
    connections.set(connection.connection_id, { connection, merchants });
    const groupKey = connection.provider_id;
    const group = groups.get(groupKey) || new Map();
    if (group.has(connection.kind)) deny('ambiguous_connection_pair');
    group.set(connection.kind, merchants);
    groups.set(groupKey, group);
  }
  // Comparator groups by provider + exact period. All stores and establishment
  // mappings must be identical on both sides; subset reads are never full-company.
  for (const group of groups.values()) {
    if (!group.has('pos') || !group.has('acquirer')) deny('unpaired_connections');
    const pos = group.get('pos'); const acq = group.get('acquirer');
    if (pos.size !== acq.size || [...pos].some(k => !acq.has(k)))
      deny('unmatched_merchant_mapping');
  }

  const seen = new Set(); const batches = [];
  for (const item of normalized_snapshots) {
    if (!exact(item,SNAPSHOT_KEYS) || !id(item.connection_id) ||
        !id(item.source_ref) || !instant(item.observed_at) ||
        asTime(item.observed_at) > asTime(now) ||
        asTime(now) - asTime(item.observed_at) > 86400000 ||
        !Array.isArray(item.records) || item.records.length > 500 ||
        !(item.source_total_count === null ||
          (Number.isSafeInteger(item.source_total_count) &&
           item.source_total_count >= item.records.length &&
           item.source_total_count <= 10000000)) ||
        typeof item.has_more !== 'boolean' ||
        typeof item.pages_verified !== 'boolean' ||
        typeof item.snapshot_consistent !== 'boolean')
      deny('snapshot_invalid');
    const registration = connections.get(item.connection_id);
    if (!registration || seen.has(item.connection_id)) deny('snapshot_unbound_or_duplicate');
    seen.add(item.connection_id);
    const { connection, merchants } = registration;
    if (item.tenant_id !== connection.tenant_id ||
        item.company_id !== connection.company_id ||
        item.provider_id !== connection.provider_id ||
        item.kind !== connection.kind) deny('snapshot_identity_mismatch');
    for (const row of item.records) {
      if (!exact(row,RECORD_KEYS) ||
          row.tenant_id !== connection.tenant_id ||
          row.company_id !== connection.company_id ||
          !id(row.store_id) || !id(row.merchant_id) ||
          !merchants.has(pairKey(row)))
        deny('snapshot_merchant_or_tenant_mismatch');
    }
    // No caller-provided "complete" is allowed. Positive completeness needs
    // page verification, exhausted cursor, consistent snapshot and exact count.
    const complete = item.pages_verified && !item.has_more &&
      item.snapshot_consistent && item.source_total_count !== null &&
      item.source_total_count === item.records.length;
    batches.push({
      kind: item.kind, tenant_id: item.tenant_id, company_id: item.company_id,
      provider_id: item.provider_id, source_ref: item.source_ref,
      observed_at: item.observed_at, period: item.period,
      complete, records: item.records
    });
  }
  if (seen.size !== connections.size) deny('snapshot_missing');
  const comparison = compareCardAcquirerSources({ authorized_scope, batches, now });
  return Object.freeze({ ...comparison, admission_mode: 'mock_only',
    trusted_connection_count: connections.size });
}
module.exports = { compareAdmittedCardSources };
