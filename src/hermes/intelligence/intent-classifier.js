'use strict';

// ── Hermes Intelligence Layer (HIL) — Classificador de intenção ──────────────
//
// FUNDAÇÃO (Fase 2). Este módulo NÃO está integrado ao fluxo do chat e NÃO
// altera comportamento. Ele apenas classifica uma pergunta e sugere qual
// caminho de resposta seria o mais barato/rápido capaz de respondê-la.
//
// A filosofia da HIL é REDUZIR o uso de IA: tentar responder primeiro pelos
// caminhos determinísticos e baratos e só cair no Claude como última opção.
// Ordem de preferência (mais barato → mais caro):
//   response_library → semantic_cache → sql_template → workflow → knowledge → claude
//
// As heurísticas e os números abaixo são PLACEHOLDERS da fundação. Serão
// substituídos por medições reais quando cada caminho for implementado.

const { classifyIntent } = require('../sql-templates');

// Caminhos possíveis de resposta.
const PATHS = Object.freeze({
  RESPONSE_LIBRARY: 'response_library',
  SEMANTIC_CACHE: 'semantic_cache',
  SQL_TEMPLATE: 'sql_template',
  WORKFLOW: 'workflow',
  KNOWLEDGE: 'knowledge',
  CLAUDE: 'claude'
});

// Perfil relativo estimado por caminho (custo em USD aproximado por resposta,
// latência em ms). Valores ilustrativos até termos telemetria real.
const PATH_PROFILE = Object.freeze({
  response_library: { estimatedCost: 0, estimatedLatency: 20 },
  semantic_cache: { estimatedCost: 0, estimatedLatency: 40 },
  sql_template: { estimatedCost: 0.001, estimatedLatency: 300 },
  workflow: { estimatedCost: 0.002, estimatedLatency: 800 },
  knowledge: { estimatedCost: 0.005, estimatedLatency: 600 },
  claude: { estimatedCost: 0.02, estimatedLatency: 3000 }
});

// Complexidade associada a cada caminho (rótulo, não medida).
const PATH_COMPLEXITY = Object.freeze({
  response_library: 'trivial',
  semantic_cache: 'trivial',
  sql_template: 'low',
  workflow: 'medium',
  knowledge: 'medium',
  claude: 'high'
});

function normalizeText(text = '') {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Saudações/agradecimentos curtos → candidatos a Response Library (respostas
// prontas e baratas).
const SMALLTALK_PATTERNS = [
  /^(oi|ola|opa|eai|e ai|bom dia|boa tarde|boa noite|tudo bem|obrigad[oa]|valeu|ok|blz)\b/
];

// Verbos de ação → candidatos a Workflow.
const WORKFLOW_PATTERNS = [
  /\b(gere|gerar|envie|enviar|exporte|exportar|agende|agendar|dispare|disparar|crie|criar|atualize|atualizar|notifique|notificar)\b/
];

// Perguntas conceituais/explicativas → candidatos a Knowledge.
const KNOWLEDGE_PATTERNS = [
  /\b(o que e|o que sao|como funciona|explique|explica|defina|significa|politica|regra de|procedimento|documenta[cç]ao)\b/
];

/**
 * Classifica uma pergunta e recomenda um caminho de resposta.
 * @param {string} question
 * @returns {{intent:string, confidence:number, complexity:string, estimatedCost:number, estimatedLatency:number, recommendedPath:string}}
 */
function classify(question) {
  const text = normalizeText(question);

  let intent = 'unknown';
  let confidence = 0.2;
  let recommendedPath = PATHS.CLAUDE;

  if (!text) {
    // Sem conteúdo utilizável: cai no fallback, mas com confiança mínima.
    return buildResult('empty', 0, PATHS.CLAUDE);
  }

  // 1) Pergunta frequente que já casa com um SQL Template determinístico.
  const templateMatch = classifyIntent(question);
  if (templateMatch) {
    return buildResult(templateMatch.intent, 0.9, PATHS.SQL_TEMPLATE);
  }

  // 2) Smalltalk → Response Library (resposta pronta, sem IA).
  if (SMALLTALK_PATTERNS.some(re => re.test(text))) {
    return buildResult('smalltalk', 0.8, PATHS.RESPONSE_LIBRARY);
  }

  // 3) Ação imperativa → Workflow.
  if (WORKFLOW_PATTERNS.some(re => re.test(text))) {
    return buildResult('workflow_action', 0.5, PATHS.WORKFLOW);
  }

  // 4) Pergunta conceitual → Knowledge.
  if (KNOWLEDGE_PATTERNS.some(re => re.test(text))) {
    return buildResult('knowledge_lookup', 0.5, PATHS.KNOWLEDGE);
  }

  // 5) Nada reconhecido → Claude como última opção.
  return buildResult(intent, confidence, recommendedPath);
}

function buildResult(intent, confidence, recommendedPath) {
  const profile = PATH_PROFILE[recommendedPath] || PATH_PROFILE.claude;
  return {
    intent,
    confidence,
    complexity: PATH_COMPLEXITY[recommendedPath] || 'high',
    estimatedCost: profile.estimatedCost,
    estimatedLatency: profile.estimatedLatency,
    recommendedPath
  };
}

module.exports = {
  classify,
  PATHS,
  PATH_PROFILE,
  PATH_COMPLEXITY
};
