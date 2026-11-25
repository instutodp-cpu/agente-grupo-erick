'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const transport = require('../src/hermes/accounting/seta-file-transport');
const cli = require('../scripts/seta-file-import-plan');

const HEADER = 'Código Venda;Data;Loja;Valor Total;Situação';
const csv = lines => Buffer.from('﻿' + [HEADER, ...lines].join('\r\n') + '\r\n', 'utf8');
const headerSha = crypto.createHash('sha256')
  .update(HEADER.split(';').join('\u001f')).digest('hex');

function mapping(overrides = {}) {
  return {
    version: 1,
    kind: 'sale',
    tenantId: 'grupo_erick',
    companyId: 'erick_calcados',
    delimiter: ';',
    dateFormat: 'DD/MM/YYYY',
    columns: { id: 'Código Venda', occurredAt: 'Data', establishment: 'Loja' },
    stores: { '001': 'calcados_barreiros', '002': 'calcados_sirinhaem' },
    payload: {
      total_cents: { column: 'Valor Total', type: 'money_brl' },
      status: { column: 'Situação', type: 'text' }
    },
    discovery: { sampleSha256: 'a'.repeat(64), headerSha256: headerSha,
      verifiedBy: 'operador', verifiedAt: '2026-11-25T12:00:00Z' },
    ...overrides
  };
}

const ROWS = [
  'V1;24/11/2026;001;"1.234,56";FECHADA',
  'V2;24/11/2026 18:05;002;89,90;"CANCELADA; estorno"',
  'V3;31/02/2026;001;10,00;FECHADA',
  'V4;24/11/2026;999;10,00;FECHADA',
  'V1;24/11/2026;001;1,00;DUPLICADA'
];

test('file transport is read-only, offline and has no persistence', () => {
  assert.deepEqual({ ...transport.FILE_TRANSPORT_POLICY }, {
    adapterId: 'seta_read_v1', transport: 'FILE_EXPORT', mode: 'READ_ONLY',
    network: false, persistence: 'NONE', failClosed: true
  });
  const source = fs.readFileSync(require.resolve('../src/hermes/accounting/seta-file-transport'), 'utf8');
  assert.doesNotMatch(source, /require\('(fs|http|https|net|pg|child_process)'\)/);
});

test('a layout must be discovered by a person before any row is read', () => {
  const base = { file: csv(ROWS), fileName: 'vendas.csv', receivedAt: '2026-11-25T09:00:00Z' };
  assert.throws(() => transport.planFileImport({ ...base, mapping: mapping({ discovery: undefined }) }),
    err => err.code === 'DISCOVERY_REQUIRED' && /DISCOVERY_REQUIRED/.test(err.message));
  const changed = Buffer.from('Código;Data;Loja;Valor Total;Situação\nV1;24/11/2026;001;1,00;X\n');
  assert.throws(() => transport.planFileImport({ ...base, file: changed, mapping: mapping() }),
    err => err.code === 'DISCOVERY_REQUIRED' && /LAYOUT_CHANGED/.test(err.message));
});

test('rows become canonical READ records; bad rows are rejected by line and reason only', () => {
  const plan = transport.planFileImport({ file: csv(ROWS), fileName: 'vendas.csv',
    receivedAt: '2026-11-25T09:00:00Z', mapping: mapping() });
  assert.equal(plan.status, 'PLANNED');
  assert.deepEqual(plan.summary, { create: 2, unchanged: 0, rejected: 3 });
  assert.deepEqual(plan.rejected, [
    { line: 4, reason: 'invalid_date' },
    { line: 5, reason: 'unknown_store' },
    { line: 6, reason: 'duplicate_in_file' }
  ]);
  assert.doesNotMatch(JSON.stringify(plan.rejected), /DUPLICADA|999/);
  const [v1, v2] = plan.records.map(x => x.record);
  assert.equal(v1.entityType, 'Sale');
  assert.equal(v1.sourceSystem, 'seta');
  assert.equal(v1.authorityLevel, 'READ');
  assert.equal(v1.id, 'seta:erick_calcados:sale:V1');
  assert.equal(v1.companyId, 'erick_calcados');
  assert.equal(v1.establishmentId, 'calcados_barreiros');
  assert.equal(v1.occurredAt, '2026-11-24');
  assert.equal(v1.payload.total_cents, 123456);
  assert.match(v1.evidenceIds[0], new RegExp('^file:' + plan.provenance.sha256 + '#L2$'));
  assert.equal(v2.occurredAt, '2026-11-24T18:05:00-03:00');
  assert.equal(v2.payload.total_cents, 8990);
  assert.equal(v2.payload.status, 'CANCELADA; estorno');
  assert.equal(plan.provenance.headerSha256, headerSha);
  assert.equal(plan.provenance.rows, 5);
});

test('imports are incremental: same file is ignored, a changed row creates a new version', () => {
  const first = transport.planFileImport({ file: csv(ROWS.slice(0, 2)), fileName: 'd1.csv',
    receivedAt: '2026-11-25T09:00:00Z', mapping: mapping() });
  const again = transport.planFileImport({ file: csv(ROWS.slice(0, 2)), fileName: 'd1-copia.csv',
    receivedAt: '2026-11-25T10:00:00Z', mapping: mapping(), previousManifest: first.manifest });
  assert.equal(again.status, 'IGNORE_DUPLICATE_FILE');
  assert.equal(again.records.length, 0);
  const next = transport.planFileImport({
    file: csv(['V1;24/11/2026;001;"1.234,56";FECHADA', 'V2;24/11/2026 18:05;002;99,90;FECHADA']),
    fileName: 'd2.csv', receivedAt: '2026-11-26T09:00:00Z', mapping: mapping(),
    previousManifest: first.manifest });
  assert.deepEqual(next.summary, { create: 1, unchanged: 1, rejected: 0 });
  assert.equal(next.records[0].record.sourceReference, 'V2');
  assert.equal(next.records[0].version, 2);
  assert.equal(next.manifest.entries.V2.version, 2);
  assert.equal(next.manifest.files.length, 2);
});

test('a manifest never crosses company, tenant or record kind', () => {
  const first = transport.planFileImport({ file: csv(ROWS.slice(0, 1)), fileName: 'a.csv',
    receivedAt: '2026-11-25T09:00:00Z', mapping: mapping() });
  for (const other of [{ companyId: 'erick_magazine' }, { tenantId: 'outro_grupo' }, { kind: 'receivable' }]) {
    assert.throws(() => transport.planFileImport({ file: csv(ROWS.slice(0, 1)), fileName: 'a.csv',
      receivedAt: '2026-11-25T09:00:00Z', mapping: mapping(other), previousManifest: first.manifest }),
    /another tenant, company or kind/);
  }
});

test('mapping, money and date validation fail closed', () => {
  for (const bad of [{ kind: 'unknown' }, { companyId: 'Empresa X' }, { delimiter: '|' },
    { dateFormat: 'MM/DD/YYYY' }, { stores: {} }, { payload: { 'Total': { column: 'x', type: 'text' } } },
    { payload: { total: { column: 'x', type: 'float' } } }]) {
    assert.throws(() => transport.validateMapping(mapping(bad)), JSON.stringify(bad));
  }
  assert.equal(transport.parseMoneyBrl('1.234,5'), 123450);
  assert.equal(transport.parseMoneyBrl('-10,00'), -1000);
  assert.equal(transport.parseMoneyBrl('1234'), 123400);
  for (const bad of ['1,234.56', '12,345', 'R$ 10,00', '']) assert.equal(transport.parseMoneyBrl(bad), null, bad);
  assert.equal(transport.parseDate('29/02/2028', 'DD/MM/YYYY'), '2028-02-29');
  assert.equal(transport.parseDate('29/02/2027', 'DD/MM/YYYY'), null);
  assert.equal(transport.parseDate('24/11/2026 25:00', 'DD/MM/YYYY'), null);
  assert.throws(() => transport.parseDelimited('"aberto;sem fim', ';'), /unterminated/);
});

test('CLI discovers the layout hashes and writes a private dry-run plan without overwriting', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seta-plan-'));
  try {
    const file = path.join(dir, 'vendas.csv');
    fs.writeFileSync(file, csv(ROWS.slice(0, 2)));
    const found = cli.main(['--discover', '--file', file, '--delimiter', ';']);
    assert.equal(found.headerSha256, headerSha);
    assert.equal(found.sampleSha256, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
    const map = path.join(dir, 'mapping.json');
    fs.writeFileSync(map, JSON.stringify(mapping()));
    const out = path.join(dir, 'saida');
    const result = cli.main(['--file', file, '--mapping', map, '--out', out],
      () => new Date('2026-11-25T09:00:00Z'));
    assert.deepEqual(result.summary, { create: 2, unchanged: 0, rejected: 0 });
    assert.equal(fs.statSync(result.plan).mode & 0o777, 0o600);
    assert.equal(JSON.parse(fs.readFileSync(result.manifest, 'utf8')).companyId, 'erick_calcados');
    assert.equal(JSON.parse(fs.readFileSync(result.plan, 'utf8')).policy.persistence, 'NONE');
    assert.throws(() => cli.main(['--file', file, '--mapping', map, '--out', out]), /EEXIST/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
