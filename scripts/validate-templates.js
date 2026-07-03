'use strict';

// ── Validação real dos SQL Templates no Supabase/Railway ─────────────────────
// Executa cada SQL Template contra o banco real, de forma SOMENTE-LEITURA, para
// confirmar que as tabelas/views/colunas usadas existem e que as consultas
// rodam. NÃO altera dados: cada template roda dentro de uma transação
// `READ ONLY` que sempre termina em ROLLBACK.
//
// Uso:
//   DATABASE_URL=postgres://... node scripts/validate-templates.js
//   (ou defina DATABASE_URL no .env)
//
// Saída: apenas nome do template, status, rowCount, tempo e erro (redigido).
// Nunca imprime linhas/valores do banco.

require('dotenv').config();
const { Pool } = require('pg');
const { templates } = require('../src/hermes/sql-templates');

const STATEMENT_TIMEOUT_MS = (() => {
  const v = Number(process.env.SQL_TEMPLATE_VALIDATION_TIMEOUT_MS);
  return Number.isInteger(v) && v > 0 ? v : 30000;
})();

// Perguntas representativas (as mesmas da tela) para gerar parâmetros de teste.
const SAMPLE_QUESTIONS = {
  monthly_revenue_by_store: 'Qual foi o faturamento de cada loja em junho de 2026?',
  recoverable_delinquency_by_store: 'Quanto cada loja tem de inadimplência recuperável agora?',
  revenue_year_comparison_by_store: 'Compare o faturamento de 2025 vs 2024 por loja',
  top_products_last_six_months: 'Quais os 10 produtos mais vendidos nos últimos 6 meses?',
  top_salespeople_by_year: 'Quem foram os melhores vendedores em 2025?',
  average_ticket_last_three_months: 'Qual o ticket médio de cada loja nos últimos 3 meses?'
};

// Redação básica de dados sensíveis em mensagens de erro (mesmo padrão do server).
function redactSensitive(value = '') {
  return String(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[cnpj]')
    .replace(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?9?\d{4}[-\s]?\d{4}/g, '[telefone]')
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, '[anthropic_key]')
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database_url]')
    .replace(/\s+/g, ' ')
    .trim();
}

async function validateTemplate(pool, template) {
  const params = template.buildParams(SAMPLE_QUESTIONS[template.name] || '');
  const values = template.values(params);
  const startedAt = Date.now();
  const client = await pool.connect();
  try {
    // Transação estritamente somente-leitura: qualquer escrita seria rejeitada,
    // e o ROLLBACK garante que nada é persistido.
    await client.query('BEGIN');
    await client.query('SET TRANSACTION READ ONLY');
    await client.query(`SET LOCAL statement_timeout TO ${STATEMENT_TIMEOUT_MS}`);
    const result = await client.query(template.sql, values);
    await client.query('ROLLBACK');
    return { template: template.name, status: 'OK', rowCount: result.rowCount, durationMs: Date.now() - startedAt, error: null };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    return { template: template.name, status: 'ERRO', rowCount: null, durationMs: Date.now() - startedAt, error: redactSensitive(err.message) };
  } finally {
    client.release();
  }
}

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

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    statement_timeout: STATEMENT_TIMEOUT_MS
  });

  const results = [];
  try {
    for (const template of Object.values(templates)) {
      results.push(await validateTemplate(pool, template));
    }
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
