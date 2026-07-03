'use strict';

// ── Hermes Intelligence Layer (HIL) — Decision Report ────────────────────────
//
// Transforma o snapshot de métricas (contadores agregados do shadow mode) num
// relatório simples: percentuais por caminho + uma recomendação operacional que
// responde "o Hermes está economizando IA ou ainda depende demais do Claude?".
//
// Função PURA — não toca em banco, não expõe perguntas reais (usa só os
// contadores/rótulos do snapshot).

// Abaixo deste total de classificações, ainda não há dados suficientes.
const LOW_DATA_THRESHOLD = 30;

function pct(part, total) {
  if (!total || total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10; // 1 casa decimal
}

/**
 * Constrói o relatório de decisões a partir de um snapshot de métricas.
 * @param {object} snapshot Saída de `snapshot()` do módulo de métricas.
 * @param {{lowDataThreshold?:number}} [options]
 */
function buildDecisionReport(snapshot = {}, { lowDataThreshold = LOW_DATA_THRESHOLD } = {}) {
  const total = Number(snapshot.totalClassifications) || 0;
  const byPath = snapshot.byRecommendedPath || {};

  const percentages = {};
  for (const [path, count] of Object.entries(byPath)) {
    percentages[path] = pct(count, total);
  }

  const claudePercent = pct(byPath.claude || 0, total);
  const sqlTemplatePercent = pct(byPath.sql_template || 0, total);
  const semanticCachePercent = pct(byPath.semantic_cache || 0, total);

  const recommendations = [];
  if (total < lowDataThreshold) {
    recommendations.push('Coletar mais dados antes de decidir.');
  } else {
    if (claudePercent > 50) {
      recommendations.push('Criar mais SQL Templates ou respostas reutilizáveis.');
    }
    if (sqlTemplatePercent > 50) {
      recommendations.push('Boa oportunidade para otimizar cache e materialized views.');
    }
    if (semanticCachePercent > 20) {
      recommendations.push('Priorizar ativação do semantic cache.');
    }
    if (recommendations.length === 0) {
      recommendations.push('Distribuição equilibrada; continuar monitorando.');
    }
  }

  return {
    totalClassifications: total,
    enoughData: total >= lowDataThreshold,
    percentages,
    claudePercent,
    sqlTemplatePercent,
    semanticCachePercent,
    topIntents: Array.isArray(snapshot.topIntents) ? snapshot.topIntents : [],
    recommendation: recommendations[0],
    recommendations
  };
}

module.exports = {
  buildDecisionReport,
  LOW_DATA_THRESHOLD
};
