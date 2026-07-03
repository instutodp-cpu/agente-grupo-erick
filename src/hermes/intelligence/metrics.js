'use strict';

// ── Hermes Intelligence Layer (HIL) — Métricas em memória ────────────────────
//
// Agrega, EM MEMÓRIA, as decisões que a HIL toma em shadow mode, para exposição
// nos endpoints administrativos. Guarda apenas CONTADORES agregados — nunca o
// texto real das perguntas. Os contadores são voláteis (zeram a cada restart) e
// não substituem a camada de aprendizado persistente (`question_statistics`).

const { PATHS } = require('./intent-classifier');

function emptyBoolCounter() {
  return { true: 0, false: 0 };
}

function emptyPathCounter() {
  const counter = {};
  for (const path of Object.values(PATHS)) counter[path] = 0;
  return counter;
}

function createState() {
  return {
    totalClassifications: 0,
    startedAt: Date.now(),
    byRecommendedPath: emptyPathCounter(),
    wouldCallClaude: emptyBoolCounter(),
    wouldUseTemplate: emptyBoolCounter(),
    wouldUseSemanticCache: emptyBoolCounter(),
    // Contagem por intenção (rótulo do classificador — NÃO é a pergunta real).
    intents: new Map()
  };
}

let state = createState();

function bumpBool(counter, value) {
  counter[value ? 'true' : 'false'] += 1;
}

/**
 * Registra uma decisão de shadow mode nos contadores. Nunca lança e nunca
 * armazena o texto da pergunta.
 * @param {object} classification Resultado de `classify()`.
 * @param {object} decision Resultado de `simulateDecision()`.
 */
function recordDecision(classification = {}, decision = {}) {
  try {
    state.totalClassifications += 1;

    const path = decision.recommendedPath;
    if (path && Object.prototype.hasOwnProperty.call(state.byRecommendedPath, path)) {
      state.byRecommendedPath[path] += 1;
    }

    bumpBool(state.wouldCallClaude, Boolean(decision.wouldCallClaude));
    bumpBool(state.wouldUseTemplate, Boolean(decision.wouldUseTemplate));
    bumpBool(state.wouldUseSemanticCache, Boolean(decision.wouldUseSemanticCache));

    const intent = classification && typeof classification.intent === 'string' ? classification.intent : 'unknown';
    state.intents.set(intent, (state.intents.get(intent) || 0) + 1);
  } catch (_) {
    // Métricas nunca podem impactar o fluxo.
  }
}

/**
 * Snapshot agregado das métricas. Apenas contadores — sem perguntas reais.
 * @param {{topIntentsLimit?:number}} [options]
 */
function snapshot({ topIntentsLimit = 10 } = {}) {
  const topIntents = [...state.intents.entries()]
    .map(([intent, count]) => ({ intent, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topIntentsLimit);

  return {
    totalClassifications: state.totalClassifications,
    sinceMs: Date.now() - state.startedAt,
    byRecommendedPath: { ...state.byRecommendedPath },
    wouldCallClaude: { ...state.wouldCallClaude },
    wouldUseTemplate: { ...state.wouldUseTemplate },
    wouldUseSemanticCache: { ...state.wouldUseSemanticCache },
    topIntents
  };
}

function resetHilMetrics() {
  state = createState();
}

module.exports = {
  recordDecision,
  snapshot,
  resetHilMetrics
};
