'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const api = require('../src/hermes/accounting/seta-api-transport');
const file = require('../src/hermes/accounting/seta-file-transport');

const config = {
  officialEndpoint: 'https://api.example-seta.invalid/v1',
  authStrategy: 'oauth_client_credentials',
  discoveryReceipt: { status: 'verified', endpoint: 'https://api.example-seta.invalid/v1',
    authStrategy: 'oauth_client_credentials' }
};
const record = (o = {}) => ({ codigo: 'V1', data: '2026-11-24', loja: '001', total: '1234.56', situacao: 'FECHADA', ...o });
const layout = api.layoutHash([record()]);
function mapping(overrides = {}) {
  return {
    version: 1, kind: 'sale', tenantId: 'grupo_erick', companyId: 'erick_calcados', dateFormat: 'YYYY-MM-DD',
    fields: { id: 'codigo', occurredAt: 'data', establishment: 'loja' },
    stores: { '001': 'calcados_barreiros', '002': 'calcados_sirinhaem' },
    payload: { total_cents: { field: 'total', type: 'money_decimal' }, status: { field: 'situacao', type: 'text' } },
    discovery: { layoutSha256: layout, verifiedBy: 'operador', verifiedAt: '2026-11-25T12:00:00Z' },
    ...overrides
  };
}
const page = (records, nextCursor = null) => ({ records, nextCursor });
const at = '2026-11-25T09:00:00Z';

test('API transport is read-only, offline and has no persistence', () => {
  assert.deepEqual({ ...api.API_TRANSPORT_POLICY }, { adapterId: 'seta_read_v1', transport: 'API',
    mode: 'READ_ONLY', network: false, persistence: 'NONE', failClosed: true });
  const source = require('fs').readFileSync(require.resolve('../src/hermes/accounting/seta-api-transport'), 'utf8');
  assert.doesNotMatch(source, /require\('(fs|http|https|net|pg|child_process|undici)'\)|fetch\(/);
});

test('nothing is read until the transport and the record layout are discovered', () => {
  const base = { page: page([record()]), mapping: mapping(), receivedAt: at };
  for (const bad of [{}, { ...config, discoveryReceipt: { ...config.discoveryReceipt, status: 'pending' } },
    { ...config, discoveryReceipt: { ...config.discoveryReceipt, endpoint: 'https://other.invalid' } }]) {
    assert.throws(() => api.planApiPage({ ...base, config: bad }), err => err.code === 'DISCOVERY_REQUIRED');
  }
  assert.throws(() => api.planApiPage({ ...base, config, mapping: mapping({ discovery: undefined }) }),
    err => err.code === 'DISCOVERY_REQUIRED' && /LAYOUT_DISCOVERY_REQUIRED/.test(err.message));
  assert.throws(() => api.planApiPage({ ...base, config, page: page([record({ novo_campo: 1 })]) }),
    err => err.code === 'DISCOVERY_REQUIRED' && /LAYOUT_CHANGED/.test(err.message));
});

test('records become the same canonical READ records; bad ones are rejected by position only', () => {
  const plan = api.planApiPage({ config, mapping: mapping(), receivedAt: at, page: page([
    record(),
    record({ codigo: 'V2', loja: '002', total: '89.9' }),
    record({ codigo: 'V3', data: '2026-02-31' }),
    record({ codigo: 'V4', loja: '999' }),
    record({ codigo: 'V1', total: '1.00' }),
    record({ codigo: 'V5', total: 'mil reais' })
  ], 'c2') });
  assert.equal(plan.status, 'PLANNED');
  assert.deepEqual(plan.summary, { create: 2, unchanged: 0, rejected: 4 });
  assert.deepEqual(plan.rejected, [{ index: 2, reason: 'invalid_date' }, { index: 3, reason: 'unknown_store' },
    { index: 4, reason: 'duplicate_in_page' }, { index: 5, reason: 'invalid_money_decimal' }]);
  const first = plan.records[0].record;
  assert.equal(first.id, 'seta:erick_calcados:sale:V1');
  assert.equal(first.payload.total_cents, 123456);
  assert.equal(first.establishmentId, 'calcados_barreiros');
  assert.match(first.evidenceIds[0], /^api:[0-9a-f]{64}#0$/);
  assert.equal(plan.manifest.apiCursor, 'c2');
  assert.doesNotMatch(JSON.stringify(plan.rejected), /mil reais|999/);
});

test('file exports and the API share one manifest: switching transport re-imports nothing', () => {
  const HEADER = 'Código;Data;Loja;Total;Situação';
  const csv = Buffer.from([HEADER, 'V1;24/11/2026;001;"1.234,56";FECHADA'].join('\n') + '\n');
  const fileMapping = { version: 1, kind: 'sale', tenantId: 'grupo_erick', companyId: 'erick_calcados',
    delimiter: ';', dateFormat: 'DD/MM/YYYY', columns: { id: 'Código', occurredAt: 'Data', establishment: 'Loja' },
    stores: { '001': 'calcados_barreiros' },
    payload: { total_cents: { column: 'Total', type: 'money_brl' }, status: { column: 'Situação', type: 'text' } },
    discovery: { sampleSha256: 'a'.repeat(64), verifiedBy: 'operador', verifiedAt: '2026-11-25T12:00:00Z',
      headerSha256: crypto.createHash('sha256').update(HEADER.split(';').join('\u001f')).digest('hex') } };
  const fromFile = file.planFileImport({ file: csv, fileName: 'vendas.csv', receivedAt: at, mapping: fileMapping });
  assert.equal(fromFile.summary.create, 1);
  // The same sale arrives by API: identical payload, nothing new.
  const same = api.planApiPage({ config, mapping: mapping(), receivedAt: at, previousManifest: fromFile.manifest,
    page: page([record()], 'c1') });
  assert.deepEqual(same.summary, { create: 0, unchanged: 1, rejected: 0 });
  assert.deepEqual(same.manifest.files, fromFile.manifest.files);
  // A changed value becomes version 2, whichever transport brought it.
  const changed = api.planApiPage({ config, mapping: mapping(), receivedAt: at, previousManifest: same.manifest,
    page: page([record({ situacao: 'CANCELADA' })], 'c2') });
  assert.equal(changed.records[0].version, 2);
  // A later file import keeps what the API remembered.
  const again = file.planFileImport({ file: Buffer.from(csv.toString() + 'V9;24/11/2026;001;1,00;FECHADA\n'),
    fileName: 'vendas2.csv', receivedAt: at, mapping: fileMapping, previousManifest: changed.manifest });
  assert.equal(again.manifest.apiCursor, 'c2');
  assert.deepEqual(again.manifest.apiPages, changed.manifest.apiPages);
  assert.equal(again.summary.create, 2); // V1 back to the file value (new version) and V9
});

test('a repeated page is ignored, an empty page only moves the cursor, manifests never cross companies', () => {
  const first = api.planApiPage({ config, mapping: mapping(), receivedAt: at, page: page([record()], 'c1') });
  const repeat = api.planApiPage({ config, mapping: mapping(), receivedAt: at, previousManifest: first.manifest,
    page: page([record()], 'c1') });
  assert.equal(repeat.status, 'IGNORE_DUPLICATE_PAGE');
  const empty = api.planApiPage({ config, mapping: mapping(), receivedAt: at, previousManifest: first.manifest,
    page: page([], null) });
  assert.equal(empty.status, 'EMPTY_PAGE');
  assert.equal(empty.manifest.apiCursor, null);
  assert.throws(() => api.planApiPage({ config, mapping: mapping({ companyId: 'erick_magazine' }), receivedAt: at,
    previousManifest: first.manifest, page: page([record()]) }), /another tenant, company or kind/);
  assert.throws(() => api.planApiPage({ config, mapping: mapping(), receivedAt: at,
    page: page(Array.from({ length: 1001 }, (_, i) => record({ codigo: 'V' + i }))) }), /up to 1000 records/);
  assert.throws(() => api.planApiPage({ config, mapping: mapping(), receivedAt: at, page: page([record()], 'bad cursor;') }),
    /nextCursor/);
  for (const bad of [{ fields: { id: 'codigo', occurredAt: 'data' } }, { payload: { total: { field: 'total', type: 'float' } } },
    { tenantId: 'Grupo Erick' }, { version: 2 }]) {
    assert.throws(() => api.validateApiMapping(mapping(bad)));
  }
});
