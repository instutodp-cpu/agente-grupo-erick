'use strict';

// ── Validação real dos SQL Templates no Supabase/Railway (CLI) ───────────────
// Wrapper de linha de comando sobre a lógica reutilizável em
// `src/hermes/template-validation.js`. Executa cada SQL Template contra o banco
// real, SOMENTE-LEITURA, e imprime apenas metadados (nunca linhas do banco).
//
// Uso:
//   DATABASE_URL=postgres://... node scripts/validate-templates.js
//   (ou defina DATABASE_URL no .env)

require('dotenv').config();
const { Pool } = require('pg');
const {
  validateAllTemplates,
  redactSensitive,
  getValidationTimeoutMs
} = require('../src/hermes/template-validation');

function printReport(results) {
  const pad = (s, n) => String(s).padEnd(n);
  const padLeft = (s, n) => String(s).padStart(n);
  console.log('');
  console.log('Validação dos SQL Templates (somente leitura)');
  console.log('─'.repeat(72));
  console.log(`${pad('Template', 34)} ${pad('Status', 6)} ${padLeft('rowCount', 9)} ${padLeft('tempo(ms)', 10)}`);
  console.log('─'.repeat(72));
  for (const r of results) {
    console.log(`${pad(r.template, 34)} ${pad(r.status, 6)} ${padLeft(r.rowCount === null ? '—' : r.rowCount, 9)} ${padLeft(r.durationMs, 10)}`);
    if (r.error) console.log(`  ↳ erro: ${r.error}`);
  }
  console.log('─'.repeat(72));
  const ok = results.filter(r => r.status === 'OK').length;
  console.log(`Total: ${results.length} | OK: ${ok} | ERRO: ${results.length - ok}`);
  console.log('');
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL não definido. Configure a variável (ou o arquivo .env) com a connection string do Supabase/Railway antes de validar. Nenhuma consulta foi executada.');
    process.exit(1);
  }

  const timeoutMs = getValidationTimeoutMs();
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    statement_timeout: timeoutMs
  });

  let results;
  try {
    results = await validateAllTemplates(pool, { statementTimeoutMs: timeoutMs });
  } finally {
    await pool.end();
  }

  printReport(results);
  const hasError = results.some(r => r.status !== 'OK');
  process.exit(hasError ? 1 : 0);
}

main().catch(err => {
  console.error(`Falha inesperada na validação: ${redactSensitive(err.message)}`);
  process.exit(1);
});
