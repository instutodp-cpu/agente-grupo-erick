'use strict';

// ── Hermes Intelligence Layer (HIL) — Decisão: chamar Claude? ────────────────
//
// FUNDAÇÃO (Fase 2). Função pura de decisão, NÃO integrada ao fluxo do chat.
// Responde apenas `true` ou `false` com base na classificação: o Claude é a
// ÚLTIMA opção, então só deve ser chamado quando nenhum caminho mais barato foi
// recomendado (ou quando a confiança é baixa demais para confiar no caminho
// determinístico).

const { classify, PATHS } = require('./intent-classifier');

// Abaixo deste nível de confiança, mesmo um caminho não-Claude é considerado
// incerto e preferimos deixar o Claude decidir (na integração futura).
const MIN_CONFIDENCE = 0.4;

/**
 * Decide se o Claude deve ser chamado.
 * @param {string|object} input Pergunta (string) ou resultado de `classify()`.
 * @returns {boolean}
 */
function shouldCallClaude(input) {
  const classification = typeof input === 'string' ? classify(input) : input;
  if (!classification || typeof classification !== 'object') return true;

  if (classification.recommendedPath === PATHS.CLAUDE) return true;
  if (typeof classification.confidence === 'number' && classification.confidence < MIN_CONFIDENCE) {
    return true;
  }
  return false;
}

module.exports = {
  shouldCallClaude,
  MIN_CONFIDENCE
};
