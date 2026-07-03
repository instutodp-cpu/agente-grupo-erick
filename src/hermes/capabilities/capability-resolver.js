'use strict';

// ── Hermes — Capability Resolver ─────────────────────────────────────────────
//
// Descobre QUAL Capability atenderia uma pergunta. NÃO executa nada, não chama
// handlers, não altera o chat/SQL/cache/Claude. Apenas resolve.
//
// Pipeline: HIL (contexto) → intent (mapas de domínio) → Capability Registry.
//
// Observação honesta: o classificador da HIL ainda não conhece os intents dos
// domínios (ex.: finance.daily_revenue), então sua confiança é baixa para
// perguntas financeiras. Por isso a confiança do resolver vem do match
// DETERMINÍSTICO do mapa de domínio; a HIL é usada para enriquecer o `reason`.

const { classify } = require('../intelligence/intent-classifier');
const { classifyFinancialIntent } = require('../finance/financial-intent-map');
const { findCapabilitiesByIntent } = require('./capability-registry');

// Detectores de intent por domínio. À medida que novos domínios entrarem
// (compras, rh, …), seus mapas são adicionados aqui.
const INTENT_DETECTORS = [
  question => {
    const fin = classifyFinancialIntent(question);
    return fin ? { intent: fin.capability, domain: 'finance' } : null;
  }
];

function safeClassify(question) {
  try {
    return classify(question);
  } catch (_) {
    return null;
  }
}

function detectIntent(question) {
  for (const detect of INTENT_DETECTORS) {
    const hit = detect(question);
    if (hit && hit.intent) return hit;
  }
  return null;
}

/**
 * Resolve qual Capability seria escolhida para a pergunta.
 * @param {string} question
 * @returns {{capabilityId:string, confidence:number, reason:string, domain:string, status:string}|null}
 */
function resolveCapability(question) {
  if (typeof question !== 'string' || !question.trim()) return null;

  const detected = detectIntent(question);
  if (!detected) return null;

  const capabilities = findCapabilitiesByIntent(detected.intent);
  if (capabilities.length === 0) return null; // intent conhecido, mas sem capability registrada

  const capability = capabilities[0];
  const hil = safeClassify(question);
  const hilPath = hil && hil.recommendedPath ? hil.recommendedPath : 'unknown';

  return {
    capabilityId: capability.id,
    // Match determinístico do mapa de domínio → confiança alta.
    confidence: 0.9,
    reason: `intent "${detected.intent}" → capability "${capability.id}" (HIL: ${hilPath})`,
    domain: capability.domain,
    status: capability.status
  };
}

module.exports = {
  resolveCapability,
  detectIntent
};
