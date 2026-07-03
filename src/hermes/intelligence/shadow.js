'use strict';

// ── Hermes Intelligence Layer (HIL) — Shadow Mode ────────────────────────────
//
// Shadow Mode: a HIL toma uma DECISÃO em paralelo ao fluxo atual, apenas para
// registrar qual caminho ela ESCOLHERIA — sem alterar nada. O usuário continua
// recebendo exatamente a mesma resposta de hoje.
//
// `simulateDecision()` é uma função PURA. Não chama Claude, não integra o
// Semantic Cache nem a Response Library, não muda o fluxo. Só transforma a
// classificação (+ contexto) numa decisão explicável e em flags booleanas.

const { PATHS } = require('./intent-classifier');
const { shouldCallClaude } = require('./should-call-claude');

const REASONS = Object.freeze({
  response_library: 'resposta pronta na Response Library (mais barato)',
  semantic_cache: 'resposta equivalente reutilizável no Semantic Cache',
  sql_template: 'pergunta casa com um SQL Template determinístico',
  workflow: 'pedido de ação/rotina (workflow)',
  knowledge: 'consulta a conhecimento curado',
  claude: 'sem caminho determinístico — raciocínio do Claude (última opção)'
});

/**
 * Simula a decisão de roteamento da HIL, sem executá-la.
 * @param {object} classification Resultado de `classify()`.
 * @param {string} [question] Pergunta original (para contexto/log).
 * @param {object} [context] Contexto disponível (ex.: { hasTemplateMatch }).
 * @returns {{recommendedPath:string, confidence:number, reason:string,
 *   wouldCallClaude:boolean, wouldUseTemplate:boolean, wouldUseSemanticCache:boolean,
 *   wouldUseResponseLibrary:boolean, wouldUseKnowledge:boolean}}
 */
function simulateDecision(classification = {}, question = '', context = {}) {
  void question;
  void context;

  const recommendedPath = (classification && classification.recommendedPath) || PATHS.CLAUDE;
  const confidence = (classification && typeof classification.confidence === 'number')
    ? classification.confidence
    : 0;

  return {
    recommendedPath,
    confidence,
    reason: REASONS[recommendedPath] || REASONS.claude,
    // Decide sobre a decisão já normalizada, para consistência mesmo quando a
    // classificação vem vazia/parcial.
    wouldCallClaude: shouldCallClaude({ recommendedPath, confidence }),
    wouldUseTemplate: recommendedPath === PATHS.SQL_TEMPLATE,
    wouldUseSemanticCache: recommendedPath === PATHS.SEMANTIC_CACHE,
    wouldUseResponseLibrary: recommendedPath === PATHS.RESPONSE_LIBRARY,
    wouldUseKnowledge: recommendedPath === PATHS.KNOWLEDGE
  };
}

module.exports = {
  simulateDecision,
  REASONS
};
