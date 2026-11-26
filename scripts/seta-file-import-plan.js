'use strict';

// Simulation First tooling for Linx (Seta) file exports. No network, no
// database and no write to Linx: loading into Supabase is a separate,
// reviewed step. Every output is a private file (0600) that is never
// overwritten.
//
//   1. hashes of a sample, for the reviewed mapping:
//      --discover --file vendas.csv --delimiter ';'
//   2. layout check against the mapping (counts only):
//      --validate --file vendas.csv --mapping mapping.json
//   3. incremental plan (+ reconciliation with the Linx report totals):
//      --file vendas.csv --mapping mapping.json --out ./saida
//        [--manifest ./manifest.json] [--controls ./totais-linx.json]
//   4. simulated load of a reconciled plan against a destination ledger:
//      --simulate --plan ./saida/plan.json --reconciliation ./saida/reconciliation.json
//        --out ./simulacao [--ledger ./ledger.json]

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { planFileImport, headerHashOf, validateLayout } = require('../src/hermes/accounting/seta-file-transport');
const { reconcile, simulateLoad } = require('../src/hermes/accounting/seta-sync-plan');

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (/^--(discover|validate|simulate)$/.test(key)) { out[key.slice(2)] = true; continue; }
    if (!/^--(file|mapping|manifest|out|delimiter|controls|plan|reconciliation|ledger)$/.test(key) || argv[i + 1] === undefined) {
      throw new Error('usage');
    }
    out[key.slice(2)] = argv[++i];
  }
  return out;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writePrivate(dir, name, value) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return file;
}

function main(argv = process.argv.slice(2), now = () => new Date()) {
  const a = args(argv);
  if (a.simulate) {
    if (!a.plan || !a.reconciliation || !a.out) throw new Error('usage');
    const result = simulateLoad({ plan: readJson(a.plan), reconciliation: readJson(a.reconciliation),
      ledger: a.ledger ? readJson(a.ledger) : null });
    const { ledger, ...rest } = result;
    return { status: result.status, writes: result.writes.length,
      simulation: writePrivate(a.out, 'simulation.json', rest),
      ...(result.status === 'SIMULATED' ? { ledger: writePrivate(a.out, 'ledger.next.json', ledger) } : {}) };
  }
  if (!a.file) throw new Error('usage');
  const file = fs.readFileSync(a.file);
  if (a.validate) {
    if (!a.mapping) throw new Error('usage');
    return validateLayout({ file, mapping: readJson(a.mapping) });
  }
  if (a.discover) {
    const delimiter = a.delimiter === 'tab' ? '\t' : (a.delimiter || ';');
    return {
      sampleSha256: crypto.createHash('sha256').update(file).digest('hex'),
      headerSha256: headerHashOf(file, delimiter),
      next: 'Confira o layout com uma pessoa e registre estes hashes em mapping.discovery.'
    };
  }
  if (!a.mapping || !a.out) throw new Error('usage');
  const plan = planFileImport({
    file,
    fileName: path.basename(a.file),
    receivedAt: now().toISOString(),
    mapping: readJson(a.mapping),
    previousManifest: a.manifest ? readJson(a.manifest) : null
  });
  const { manifest, ...rest } = plan;
  const reconciliation = a.controls ? reconcile(plan, readJson(a.controls)) : null;
  return {
    status: plan.status,
    summary: plan.summary,
    plan: writePrivate(a.out, 'plan.json', rest),
    // A blocked plan does not advance the manifest: none is written.
    ...(plan.status === 'PLANNED' || plan.status === 'IGNORE_DUPLICATE_FILE'
      ? { manifest: writePrivate(a.out, 'manifest.next.json', manifest) } : {}),
    ...(reconciliation ? { reconciliationStatus: reconciliation.status,
      reconciliation: writePrivate(a.out, 'reconciliation.json', reconciliation) } : {})
  };
}

if (require.main === module) {
  try {
    process.stdout.write(JSON.stringify(main()) + '\n');
  } catch (err) {
    process.stderr.write(err.message === 'usage'
      ? 'uso: --discover --file F [--delimiter ;|,|tab] | --validate --file F --mapping M |' +
        ' --file F --mapping M --out PASTA [--manifest P] [--controls C] |' +
        ' --simulate --plan P --reconciliation R --out PASTA [--ledger L]\n'
      : JSON.stringify({ error: err.code || 'PLAN_FAILED', message: err.message }) + '\n');
    process.exitCode = err.message === 'usage' ? 2 : 1;
  }
}

module.exports = { main };
