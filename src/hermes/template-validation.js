'use strict';

// ── Lógica reutilizável de validação dos SQL Templates ───────────────────────
// Usada tanto pelo script CLI (`scripts/validate-templates.js`) quanto pelo
// endpoint administrativo (`POST /admin/validate/templates`). Executa cada
// template de forma SOMENTE-LEITURA (BEGIN / SET TRANSACTION READ ONLY /
// ROLLBACK) e devolve apenas metadados — nunca linhas/valores do banco.

const { templates } = require('./sql-templates');

// Perguntas representativas (as mesmas da tela) para gerar parâmetros de teste.
const SAMPLE_QUESTIONS = {
  monthly_revenue_by_store: 'Qual foi o faturamento de cada loja em junho de 2026?',
  recoverable_delinquency_by_store: 'Quanto cada loja tem de inadimplência recuperável agora?',
  revenue_year_comparison_by_store: 'Compare o faturamento de 2025 vs 2024 por loja',
  top_products_last_six_months: 'Quais os 10 produtos mais vendidos nos últimos 6 meses?',
  top_salespeople_by_year: 'Quem foram os melhores vendedores em 2025?',
  average_ticket_last_three_months: 'Qual o ticket médio de cada loja nos últimos 3 meses?'
};

function getValidationTimeoutMs() {
  const v = Number(process.env.SQL_TEMPLATE_VALIDATION_TIMEOUT_MS);
  return Number.isInteger(v) && v > 0 ? v : 30000;
}

// Redação básica de dados sensíveis em mensagens de erro.
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

/**
 * Valida um único template contra o banco, somente leitura.
 * @returns {{template:string, status:'OK'|'ERRO', rowCount:number|null, durationMs:number, error:string|null}}
 */
async function validateTemplate(pool, template, { statementTimeoutMs = getValidationTimeoutMs() } = {}) {
  const params = template.buildParams(SAMPLE_QUESTIONS[template.name] || '');
  const values = template.values(params);
  const startedAt = Date.now();
  let client;
  try {
    // connect() dentro do try para que falhas de conexão também virem um ERRO
    // redigido, sem derrubar a validação dos demais templates.
    client = await pool.connect();
    // Transação estritamente somente-leitura: qualquer escrita seria rejeitada,
    // e o ROLLBACK garante que nada é persistido.
    await client.query('BEGIN');
    await client.query('SET TRANSACTION READ ONLY');
    await client.query(`SET LOCAL statement_timeout TO ${statementTimeoutMs}`);
    const result = await client.query(template.sql, values);
    await client.query('ROLLBACK');
    return { template: template.name, status: 'OK', rowCount: result.rowCount, durationMs: Date.now() - startedAt, error: null };
  } catch (err) {
    if (client) { try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ } }
    return { template: template.name, status: 'ERRO', rowCount: null, durationMs: Date.now() - startedAt, error: redactSensitive(err.message) };
  } finally {
    if (client) client.release();
  }
}

/**
 * Valida todos os SQL Templates. Retorna um array de metadados por template.
 */
async function validateAllTemplates(pool, options = {}) {
  const results = [];
  for (const template of Object.values(templates)) {
    results.push(await validateTemplate(pool, template, options));
  }
  return results;
}

module.exports = {
  validateTemplate,
  validateAllTemplates,
  redactSensitive,
  getValidationTimeoutMs,
  SAMPLE_QUESTIONS
};
