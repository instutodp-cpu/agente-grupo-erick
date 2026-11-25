'use strict';

// API transport for the existing seta_read_v1 adapter (Linx da Seta), kept
// ready for when the official API is discovered. It does NOT call the
// network: a connector (outside this module, through the governed gateway)
// fetches ONE page of records and hands it here. This module refuses
// anything until the transport discovery is verified (official endpoint,
// auth strategy, signed-off receipt) AND the record layout of the page
// matches the reviewed mapping. It then plans the page exactly like a file
// export: same canonical records, same manifest entries, so a company can
// move from file exports to the API without re-importing anything.

const crypto = require('crypto');
const { ENTITY_MAP, assertTransportConfigured } = require('./seta-read-adapter');
const syncPlan = require('./seta-sync-plan');
const { convert } = require('./seta-file-transport');

const API_TRANSPORT_POLICY = Object.freeze({
  adapterId: 'seta_read_v1',
  transport: 'API',
  mode: 'READ_ONLY',
  network: false, // the page is fetched by the connector, never here
  persistence: 'NONE',
  failClosed: true
});
const API_MAPPING_VERSION = 1;
const MAX_PAGE_RECORDS = 1000;
const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const FIELD_TYPES = Object.freeze(['text', 'money_brl', 'money_decimal', 'integer', 'date']);
const DATE_FORMATS = Object.freeze(['DD/MM/YYYY', 'YYYY-MM-DD']);
const SLUG = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const NAME = /^[a-z][a-z0-9_]{0,39}$/;
const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const fail = syncPlan.fail;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

// The reviewed description of one API record layout for one company: the
// JSON keys holding id, date and store, and the typed payload fields.
function validateApiMapping(mapping) {
  if (!mapping || mapping.version !== API_MAPPING_VERSION) throw fail('api mapping version must be 1');
  if (!Object.hasOwn(ENTITY_MAP, mapping.kind)) throw fail(`unsupported Seta record kind: ${mapping.kind}`);
  if (!SLUG.test(mapping.tenantId || '')) throw fail('tenantId must be a slug');
  if (!SLUG.test(mapping.companyId || '')) throw fail('companyId must be a slug');
  if (!DATE_FORMATS.includes(mapping.dateFormat)) throw fail('unsupported dateFormat');
  const f = mapping.fields || {};
  for (const name of ['id', 'occurredAt', 'establishment']) {
    if (!KEY.test(f[name] || '')) throw fail(`fields.${name} must be a JSON key`);
  }
  if (f.sourceUpdatedAt != null && !KEY.test(f.sourceUpdatedAt)) throw fail('fields.sourceUpdatedAt must be a JSON key');
  const stores = mapping.stores;
  if (!stores || typeof stores !== 'object' || Array.isArray(stores) || !Object.keys(stores).length) {
    throw fail('stores must map every external store code to an establishment');
  }
  for (const establishment of Object.values(stores)) {
    if (!SLUG.test(establishment)) throw fail('establishment must be a slug');
  }
  for (const [name, spec] of Object.entries(mapping.payload || {})) {
    if (!NAME.test(name)) throw fail('payload field names must be snake_case');
    if (!spec || !FIELD_TYPES.includes(spec.type) || !KEY.test(spec.field || '')) {
      throw fail(`invalid payload spec for ${name}`);
    }
  }
  return mapping;
}

// The layout of a page is the sorted set of keys of its records. It must
// match what a person reviewed; a new or missing key is a layout change.
function layoutHash(records) {
  const keys = new Set();
  for (const r of records) for (const k of Object.keys(r)) keys.add(k);
  return sha256([...keys].sort().join('\u001f'));
}

function assertApiDiscovered(mapping, pageLayout) {
  const d = mapping.discovery;
  if (!d || !/^[0-9a-f]{64}$/.test(d.layoutSha256 || '') || typeof d.verifiedBy !== 'string' ||
      d.verifiedBy.trim() === '' || Number.isNaN(Date.parse(d.verifiedAt || ''))) {
    throw fail('SETA_API_LAYOUT_DISCOVERY_REQUIRED', 'DISCOVERY_REQUIRED');
  }
  if (pageLayout !== d.layoutSha256) throw fail('SETA_API_LAYOUT_CHANGED', 'DISCOVERY_REQUIRED');
}

function value(raw, type, format) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (type === 'money_decimal') {
    const v = String(raw).trim();
    if (!/^-?\d{1,13}(\.\d{1,2})?$/.test(v)) return undefined;
    const [whole, frac = ''] = v.replace('-', '').split('.');
    const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
    return v.startsWith('-') ? -cents : cents;
  }
  if (typeof raw === 'object') return undefined;
  const converted = convert(String(raw), type, format);
  return converted === null ? undefined : converted;
}

function planApiPage({ config, page, mapping, previousManifest = null, receivedAt } = {}) {
  // 1. The transport itself must be discovered and signed off.
  assertTransportConfigured(config);
  validateApiMapping(mapping);
  if (Number.isNaN(Date.parse(receivedAt || ''))) throw fail('receivedAt must be a valid date');
  if (!page || !Array.isArray(page.records) || page.records.length > MAX_PAGE_RECORDS ||
      (page.nextCursor !== null && typeof page.nextCursor !== 'string') ||
      (typeof page.nextCursor === 'string' && !/^[A-Za-z0-9._~=:-]{1,200}$/.test(page.nextCursor))) {
    throw fail('page must hold up to 1000 records and a nextCursor string or null');
  }
  if (page.records.some(r => !r || typeof r !== 'object' || Array.isArray(r))) throw fail('page records must be objects');
  const serialized = JSON.stringify(page);
  if (Buffer.byteLength(serialized) > MAX_PAGE_BYTES) throw fail('page is too large');
  const manifest = syncPlan.validateManifest(previousManifest, mapping);
  const pageSha256 = sha256(serialized);
  const provenance = Object.freeze({ pageSha256, records: page.records.length, receivedAt,
    nextCursor: page.nextCursor, kind: mapping.kind, tenantId: mapping.tenantId, companyId: mapping.companyId });
  if (page.records.length === 0) {
    return { policy: API_TRANSPORT_POLICY, status: 'EMPTY_PAGE', provenance,
      summary: { create: 0, unchanged: 0, rejected: 0 }, records: [], rejected: [],
      manifest: { ...manifest, apiCursor: page.nextCursor } };
  }
  // 2. The record layout must be the reviewed one.
  assertApiDiscovered(mapping, layoutHash(page.records));
  if ((manifest.apiPages || []).includes(pageSha256)) {
    return { policy: API_TRANSPORT_POLICY, status: 'IGNORE_DUPLICATE_PAGE', provenance,
      summary: { create: 0, unchanged: 0, rejected: 0 }, records: [], rejected: [], manifest };
  }
  // 3. Same incremental plan as a file export.
  const entries = { ...manifest.entries };
  const records = [];
  const rejected = [];
  const seen = new Set();
  let unchanged = 0;
  page.records.forEach((r, index) => {
    try {
      const sourceId = String(r[mapping.fields.id] ?? '').trim();
      if (seen.has(sourceId)) throw fail('duplicate_in_page');
      seen.add(sourceId);
      const occurredAt = value(r[mapping.fields.occurredAt], 'date', mapping.dateFormat);
      if (!occurredAt) throw fail('invalid_date');
      const storeCode = String(r[mapping.fields.establishment] ?? '').trim();
      if (!Object.hasOwn(mapping.stores, storeCode)) throw fail('unknown_store');
      const updated = mapping.fields.sourceUpdatedAt
        ? value(r[mapping.fields.sourceUpdatedAt], 'date', mapping.dateFormat) : receivedAt;
      if (!updated) throw fail('invalid_updated_at');
      const payload = {};
      for (const [name, spec] of Object.entries(mapping.payload || {})) {
        const v = value(r[spec.field], spec.type, mapping.dateFormat);
        if (v === undefined) throw fail(`invalid_${spec.type}`);
        payload[name] = v;
      }
      const planned = syncPlan.planRecord(entries, {
        identity: mapping, sourceId, establishmentId: mapping.stores[storeCode], occurredAt,
        sourceUpdatedAt: updated, receivedAt, evidenceId: `api:${pageSha256}#${index}`, payload
      });
      if (!planned) { unchanged++; return; }
      records.push(planned);
    } catch (err) {
      // Position and reason only: never the record content.
      rejected.push({ index, reason: /^[a-z_]{3,40}$/.test(err.message) ? err.message : 'invalid_record' });
    }
  });
  return {
    policy: API_TRANSPORT_POLICY,
    status: 'PLANNED',
    provenance,
    summary: { create: records.length, unchanged, rejected: rejected.length },
    records,
    rejected,
    manifest: { ...manifest, entries, apiPages: syncPlan.remember(manifest.apiPages, pageSha256),
      apiCursor: page.nextCursor }
  };
}

module.exports = {
  API_TRANSPORT_POLICY,
  API_MAPPING_VERSION,
  MAX_PAGE_RECORDS,
  validateApiMapping,
  layoutHash,
  planApiPage
};
