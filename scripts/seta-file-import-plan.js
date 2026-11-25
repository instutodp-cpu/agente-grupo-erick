'use strict';

// Dry-run planner for one Linx (Seta) file export. Reads the export, the
// reviewed mapping and the previous manifest, and writes plan.json and
// manifest.next.json to an output folder. No network, no database and no
// write to Linx: loading the plan into Supabase is a separate reviewed step.
//
//   node scripts/seta-file-import-plan.js --discover --file vendas.csv --delimiter ';'
//   node scripts/seta-file-import-plan.js --file vendas.csv --mapping mapping.json \
//     --out ./saida [--manifest ./manifest.json]

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { planFileImport, headerHashOf } = require('../src/hermes/accounting/seta-file-transport');

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--discover') { out.discover = true; continue; }
    if (!/^--(file|mapping|manifest|out|delimiter)$/.test(key) || argv[i + 1] === undefined) {
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
  if (!a.file) throw new Error('usage');
  const file = fs.readFileSync(a.file);
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
  return {
    status: plan.status,
    summary: plan.summary,
    plan: writePrivate(a.out, 'plan.json', rest),
    manifest: writePrivate(a.out, 'manifest.next.json', manifest)
  };
}

if (require.main === module) {
  try {
    process.stdout.write(JSON.stringify(main()) + '\n');
  } catch (err) {
    process.stderr.write(err.message === 'usage'
      ? 'uso: --discover --file F [--delimiter ;|,|tab]  |  --file F --mapping M --out PASTA [--manifest P]\n'
      : JSON.stringify({ error: err.code || 'PLAN_FAILED', message: err.message }) + '\n');
    process.exitCode = err.message === 'usage' ? 2 : 1;
  }
}

module.exports = { main };
