'use strict';

// ── Hermes Intelligence Layer (HIL) — Camada de aprendizado (estatísticas) ───
//
// FUNDAÇÃO (Fase 2). Este módulo é responsável APENAS por registrar métricas de
// uso e por definir os agregadores de análise. NADA aqui está implementado ou
// integrado ainda — são apenas INTERFACES. Não altera o chat, o cache, o SQL,
// o Claude nem a HIL. O objetivo é medir como o sistema é usado para, no futuro,
// calibrar as decisões da HIL.
//
// A tabela correspondente está documentada em
// `docs/sql/QUESTION_STATISTICS.sql` (não aplicada automaticamente).

// Colunas previstas para a tabela `question_statistics` (referência da interface).
const QUESTION_STATISTICS_COLUMNS = Object.freeze([
  'id',
  'intent',
  'normalized_question',
  'recommended_path',
  'complexity',
  'estimated_cost',
  'estimated_latency',
  'used_sql_template',
  'used_cache',
  'used_claude',
  'response_time_ms',
  'success',
  'error_type',
  'created_at'
]);

/**
 * Registra as estatísticas de uma pergunta respondida.
 *
 * INTERFACE APENAS — não implementada nesta PR. Não persiste nada e não lança;
 * retorna `false` (nada gravado) para deixar claro que é um no-op por enquanto.
 *
 * @param {object} [stats]
 * @param {string} [stats.intent]
 * @param {string} [stats.normalizedQuestion]
 * @param {string} [stats.recommendedPath]
 * @param {string} [stats.complexity]
 * @param {number} [stats.estimatedCost]
 * @param {number} [stats.estimatedLatency]
 * @param {boolean} [stats.usedSqlTemplate]
 * @param {boolean} [stats.usedCache]
 * @param {boolean} [stats.usedClaude]
 * @param {number} [stats.responseTimeMs]
 * @param {boolean} [stats.success]
 * @param {string} [stats.errorType]
 * @returns {Promise<boolean>} sempre `false` (no-op) nesta fundação.
 */
async function recordQuestionStatistics(stats = {}) {
  // Fundação: sem persistência. Apenas define o contrato.
  void stats;
  return false;
}

// ── Agregadores (interfaces apenas — não calculam nada ainda) ────────────────
// Cada função devolverá, no futuro, um array ordenado de itens agregados.
// Por enquanto retornam sempre um array vazio, sem tocar em banco.

async function getTopIntents(options = {}) { void options; return []; }
async function getTopQuestions(options = {}) { void options; return []; }
async function getTopTemplates(options = {}) { void options; return []; }
async function getHighestCost(options = {}) { void options; return []; }
async function getHighestLatency(options = {}) { void options; return []; }
async function getMostCacheHits(options = {}) { void options; return []; }
async function getMostClaudeFallback(options = {}) { void options; return []; }

// Índice nomeado dos agregadores, útil para expor via admin no futuro.
const aggregators = Object.freeze({
  topIntents: getTopIntents,
  topQuestions: getTopQuestions,
  topTemplates: getTopTemplates,
  highestCost: getHighestCost,
  highestLatency: getHighestLatency,
  mostCacheHits: getMostCacheHits,
  mostClaudeFallback: getMostClaudeFallback
});

module.exports = {
  recordQuestionStatistics,
  getTopIntents,
  getTopQuestions,
  getTopTemplates,
  getHighestCost,
  getHighestLatency,
  getMostCacheHits,
  getMostClaudeFallback,
  aggregators,
  QUESTION_STATISTICS_COLUMNS
};
