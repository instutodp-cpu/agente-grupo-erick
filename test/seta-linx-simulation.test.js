'use strict';

// Week 5: Linx through the official seta_read_v1 adapter, Simulation First:
// layout check, totals, provenance, invalid records, reconciliation with the
// Linx report totals and a simulated, idempotent load. No network, no DB.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const transport = require('../src/hermes/accounting/seta-file-transport');
const sync = require('../src/hermes/accounting/seta-sync-plan');
const cli = require('../scripts/seta-file-import-plan');

const HEADER = 'Código Venda;Data;Loja;Valor Total;Situação';
const headerSha = crypto.createHash('sha256').update(HEADER.split(';').join('\u001f')).digest('hex');
const csv = (lines, header = HEADER) => Buffer.from([header, ...lines].join('\r\n') + '\r\n', 'utf8');
const at = '2026-11-26T09:00:00Z';
function mapping(overrides = {}) {
  return {
    version: 1, kind: 'sale', tenantId: 'grupo_erick', companyId: 'erick_calcados',
    delimiter: ';', dateFormat: 'DD/MM/YYYY',
    columns: { id: 'Código Venda', occurredAt: 'Data', establishment: 'Loja' },
    stores: { '001': 'calcados_barreiros', '002': 'calcados_sirinhaem' },
    payload: { total_cents: { column: 'Valor Total', type: 'money_brl' }, status: { column: 'Situação', type: 'text' } },
    discovery: { sampleSha256: 'a'.repeat(64), headerSha256: headerSha, verifiedBy: 'operador', verifiedAt: '2026-11-25T12:00:00Z' },
    ...overrides
  };
}
const GOOD = ['V1;24/11/2026;001;"1.234,56";FECHADA', 'V2;24/11/2026 18:05;002;89,90;FECHADA', 'V3;25/11/2026;001;10,00;FECHADA'];
const plan = (lines = GOOD, extra = {}) => transport.planFileImport({ file: csv(lines), fileName: 'vendas.csv',
  receivedAt: at, mapping: mapping(extra.mapping), previousManifest: extra.previousManifest ?? null });
// What an operator copies from the Linx report screen for the same export.
const controls = (o = {}) => ({ version: 1, source: 'relatorio_linx_vendas', rows: 3,
  money: { total_cents: 123456 + 8990 + 1000 },
  byEstablishment: { calcados_barreiros: { rows: 2, money: { total_cents: 124456 } },
    calcados_sirinhaem: { rows: 1, money: { total_cents: 8990 } } },
  period: { from: '2026-11-24', to: '2026-11-25' }, ...o });

test('layout check reports columns, counts and store codes before any import, never row content', () => {
  const report = transport.validateLayout({ file: csv([...GOOD, 'V4;31/02/2026;001;1,00;X', 'V5;25/11/2026;777;abc;"Cliente Fulano"']),
    mapping: mapping() });
  assert.equal(report.status, 'VALUES_INVALID');
  assert.equal(report.rows, 5); assert.equal(report.valid, 3);
  assert.deepEqual(report.invalidByReason, { invalid_date: 1, unknown_store: 1 });
  assert.deepEqual(report.unknownStores, { 777: 1 });
  assert.deepEqual(report.fields.total_cents, { filled: 4, empty: 0, invalid: 1 });
  assert.equal(report.firstDay, '2026-11-24'); assert.equal(report.lastDay, '2026-11-25');
  assert.equal(report.completeness, 'NOT_PROVEN_WITHOUT_RECONCILIATION');
  assert.doesNotMatch(JSON.stringify(report), /Fulano|abc|FECHADA/);
  assert.equal(transport.validateLayout({ file: csv(GOOD), mapping: mapping() }).status, 'LAYOUT_OK');
  // Without discovery it still reports, so a person can review before signing off.
  assert.equal(transport.validateLayout({ file: csv(GOOD), mapping: mapping({ discovery: undefined }) }).status, 'DISCOVERY_REQUIRED');
  const changed = transport.validateLayout({ file: csv(GOOD.map(l => l + ';x'), HEADER + ';Vendedor'), mapping: mapping() });
  assert.equal(changed.status, 'LAYOUT_CHANGED');
  assert.deepEqual(changed.header.extraColumns, ['Vendedor']);
  const missing = transport.validateLayout({ file: csv(['V1;24/11/2026;001'], 'Código Venda;Data;Loja'), mapping: mapping() });
  assert.deepEqual(missing.header.missingColumns, ['Valor Total', 'Situação']);
  assert.equal(missing.status, 'LAYOUT_CHANGED');
});

test('plans carry totals per store and money field, and invalid records block past the reviewed tolerance', () => {
  const p = plan();
  assert.equal(p.status, 'PLANNED');
  assert.equal(p.totals.rows, 3); assert.equal(p.totals.valid, 3); assert.equal(p.totals.created, 3);
  assert.deepEqual(p.totals.money, { total_cents: 133446 });
  assert.deepEqual(p.totals.byEstablishment.calcados_barreiros, { rows: 2, money: { total_cents: 124456 } });
  assert.equal(p.totals.firstDay, '2026-11-24'); assert.equal(p.totals.lastDay, '2026-11-25');
  assert.equal(p.totals.completeness, 'NOT_PROVEN_WITHOUT_RECONCILIATION');
  // 1 bad row in 30 (3.3%) within a reviewed 5% tolerance: planned, bad row quarantined.
  const rows = Array.from({ length: 29 }, (_, i) => `W${i};24/11/2026;001;1,00;FECHADA`);
  const tolerant = plan([...rows, 'W99;24/11/2026;999;1,00;FECHADA'], { mapping: { limits: { maxRejectedRatio: 0.05 } } });
  assert.equal(tolerant.status, 'PLANNED');
  assert.deepEqual(tolerant.rejected, [{ line: 31, reason: 'unknown_store' }]);
  assert.equal(tolerant.records.length, 29);
  // Same file without a tolerance: blocked, nothing planned, manifest not advanced.
  const strict = plan([...rows, 'W99;24/11/2026;999;1,00;FECHADA']);
  assert.equal(strict.status, 'BLOCKED_INVALID_RECORDS');
  assert.deepEqual(strict.records, []); assert.deepEqual(strict.manifest.entries, {});
  assert.throws(() => plan(GOOD, { mapping: { limits: { maxRejectedRatio: 0.5 } } }), /maxRejectedRatio/);
});

test('provenance identifies the plan deterministically: same input, mapping and manifest, same planId', () => {
  const a = plan(), b = plan();
  assert.equal(a.provenance.planId, b.provenance.planId);
  assert.match(a.provenance.planId, /^[0-9a-f]{64}$/);
  assert.equal(a.provenance.transport, 'FILE_EXPORT');
  assert.equal(a.provenance.previousManifestSha256, null);
  assert.match(a.provenance.mappingSha256, /^[0-9a-f]{64}$/);
  assert.notEqual(plan(GOOD, { mapping: { payload: { total_cents: { column: 'Valor Total', type: 'money_brl' } } } })
    .provenance.planId, a.provenance.planId);
  const next = plan(['V1;24/11/2026;001;"1.234,56";CANCELADA'], { previousManifest: a.manifest });
  assert.notEqual(next.provenance.planId, a.provenance.planId);
  assert.match(next.provenance.previousManifestSha256, /^[0-9a-f]{64}$/);
});

test('reconciliation against the Linx report totals: only exact matches reconcile', () => {
  const p = plan();
  const ok = sync.reconcile(p, controls());
  assert.equal(ok.status, 'RECONCILED');
  assert.equal(ok.planId, p.provenance.planId);
  assert.match(ok.controlsSha256, /^[0-9a-f]{64}$/);
  assert.ok(ok.checks.every(c => c.ok));
  const fail = (o, name) => {
    const r = sync.reconcile(p, controls(o));
    assert.equal(r.status, 'MISMATCH', name);
    return r.checks.filter(c => !c.ok).map(c => c.check);
  };
  assert.deepEqual(fail({ rows: 4 }, 'rows'), ['rows']);
  assert.deepEqual(fail({ money: { total_cents: 133445 } }, 'money'), ['money.total_cents']);
  assert.deepEqual(fail({ money: { desconto_cents: 0 } }, 'unknown field'), ['money.desconto_cents']);
  assert.deepEqual(fail({ byEstablishment: { calcados_barreiros: { rows: 2, money: { total_cents: 124456 } } } }, 'store missing'),
    ['calcados_sirinhaem.present_in_controls']);
  assert.deepEqual(fail({ period: { from: '2026-11-25', to: '2026-11-25' } }, 'period'), ['period']);
  // Only a planned input reconciles; controls must say something checkable.
  const blocked = plan([...GOOD, 'X;24/11/2026;999;1,00;FECHADA']);
  assert.equal(sync.reconcile(blocked, controls()).status, 'NOT_RECONCILABLE');
  for (const bad of [{ version: 2 }, { source: 'Relatório' }, { rows: undefined, money: undefined, byEstablishment: undefined },
    { money: { total_cents: 1.5 } }, { period: { from: '2026-11-26', to: '2026-11-25' } }]) {
    assert.throws(() => sync.reconcile(p, controls(bad)), /controls/, JSON.stringify(bad));
  }
});

test('simulated load: reconciled plans only, idempotent, atomic on version conflicts, isolated per company', () => {
  const first = plan();
  // Not reconciled, reconciled for another plan, or blocked: refused, nothing written.
  assert.equal(sync.simulateLoad({ plan: first }).reason, 'NOT_RECONCILED');
  const other = sync.reconcile(plan(GOOD.slice(0, 2)), controls({ rows: 2, money: undefined, byEstablishment: undefined, period: undefined }));
  assert.equal(sync.simulateLoad({ plan: first, reconciliation: other }).reason, 'NOT_RECONCILED');
  const blocked = plan([...GOOD, 'X;24/11/2026;999;1,00;FECHADA']);
  assert.equal(sync.simulateLoad({ plan: blocked, reconciliation: sync.reconcile(blocked, controls()) }).reason, 'BLOCKED_INVALID_RECORDS');
  // First load.
  const loaded = sync.simulateLoad({ plan: first, reconciliation: sync.reconcile(first, controls()) });
  assert.equal(loaded.status, 'SIMULATED');
  assert.equal(loaded.writes.length, 3);
  assert.deepEqual(loaded.postLoad, { applied: 3, expected: 3 });
  assert.equal(loaded.ledger.records['seta:erick_calcados:sale:V1'].version, 1);
  // The same plan again changes nothing.
  const again = sync.simulateLoad({ plan: first, reconciliation: sync.reconcile(first, controls()), ledger: loaded.ledger });
  assert.equal(again.status, 'ALREADY_APPLIED'); assert.deepEqual(again.writes, []);
  // The next export: one changed sale becomes version 2.
  const second = plan(['V1;24/11/2026;001;"1.234,56";CANCELADA', ...GOOD.slice(1)], { previousManifest: first.manifest });
  assert.deepEqual(second.summary, { create: 1, unchanged: 2, rejected: 0 });
  const rec2 = sync.reconcile(second, controls());
  const loaded2 = sync.simulateLoad({ plan: second, reconciliation: rec2, ledger: loaded.ledger });
  assert.equal(loaded2.status, 'SIMULATED');
  assert.deepEqual(loaded2.writes.map(w => [w.id, w.version]), [['seta:erick_calcados:sale:V1', 2]]);
  // A plan built from a stale manifest conflicts with the destination: nothing applied.
  const stale = plan(['V1;24/11/2026;001;"1.234,56";DEVOLVIDA', ...GOOD.slice(1)], { previousManifest: first.manifest });
  const conflict = sync.simulateLoad({ plan: stale, reconciliation: sync.reconcile(stale, controls()), ledger: loaded2.ledger });
  assert.equal(conflict.status, 'CONFLICT');
  assert.deepEqual(conflict.conflicts, [{ id: 'seta:erick_calcados:sale:V1', expected: 3, planned: 2 }]);
  assert.equal(conflict.ledger, loaded2.ledger);
  // A destination ledger never crosses company, tenant or kind.
  assert.throws(() => sync.simulateLoad({ plan: first, reconciliation: sync.reconcile(first, controls()),
    ledger: { ...sync.emptyLedger({ tenantId: 'grupo_erick', companyId: 'erick_magazine', kind: 'sale' }) } }),
    /another tenant, company or kind/);
});

test('CLI runs the whole Simulation First chain with private, never-overwritten outputs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seta-sim-'));
  try {
    const file = path.join(dir, 'vendas.csv');
    fs.writeFileSync(file, csv(GOOD));
    const map = path.join(dir, 'mapping.json');
    fs.writeFileSync(map, JSON.stringify(mapping()));
    const ctl = path.join(dir, 'totais-linx.json');
    fs.writeFileSync(ctl, JSON.stringify(controls()));
    assert.equal(cli.main(['--validate', '--file', file, '--mapping', map]).status, 'LAYOUT_OK');
    const planned = cli.main(['--file', file, '--mapping', map, '--out', path.join(dir, 'plano'), '--controls', ctl],
      () => new Date(at));
    assert.equal(planned.status, 'PLANNED');
    assert.equal(planned.reconciliationStatus, 'RECONCILED');
    for (const f of [planned.plan, planned.manifest, planned.reconciliation]) assert.equal(fs.statSync(f).mode & 0o777, 0o600);
    const sim = cli.main(['--simulate', '--plan', planned.plan, '--reconciliation', planned.reconciliation,
      '--out', path.join(dir, 'sim1')]);
    assert.equal(sim.status, 'SIMULATED'); assert.equal(sim.writes, 3);
    const again = cli.main(['--simulate', '--plan', planned.plan, '--reconciliation', planned.reconciliation,
      '--ledger', sim.ledger, '--out', path.join(dir, 'sim2')]);
    assert.equal(again.status, 'ALREADY_APPLIED'); assert.equal(again.ledger, undefined);
    assert.throws(() => cli.main(['--simulate', '--plan', planned.plan, '--reconciliation', planned.reconciliation,
      '--out', path.join(dir, 'sim1')]), /EEXIST/);
    // A blocked plan writes no next manifest.
    fs.writeFileSync(file, csv([...GOOD, 'X;24/11/2026;999;1,00;FECHADA']));
    const blocked = cli.main(['--file', file, '--mapping', map, '--out', path.join(dir, 'bloqueado')], () => new Date(at));
    assert.equal(blocked.status, 'BLOCKED_INVALID_RECORDS'); assert.equal(blocked.manifest, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
