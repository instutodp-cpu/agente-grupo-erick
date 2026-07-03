'use strict';

// ── Hermes Intelligence Layer (HIL) — Response Library (interface) ───────────
//
// FUNDAÇÃO (Fase 2). Esta é a INTERFACE da Response Library — a camada mais
// barata da HIL, que guarda respostas já geradas e aprovadas para perguntas
// recorrentes, evitando refazer trabalho (SQL/IA) quando a mesma pergunta
// (mesma intenção + mesmos parâmetros) reaparece.
//
// NADA aqui está implementado ou integrado ainda. `findReusableResponse` apenas
// define o contrato e sempre retorna `null` (miss), preservando o comportamento
// atual. A tabela correspondente está documentada em
// `docs/sql/RESPONSE_LIBRARY.sql` (não aplicada automaticamente).

// Colunas previstas para a tabela `response_library` (referência da interface).
const RESPONSE_LIBRARY_COLUMNS = Object.freeze([
  'id',
  'intent',
  'normalized_question',
  'parameter_signature',
  'response',
  'version',
  'quality_score',
  'usage_count',
  'estimated_cost',
  'last_generated_at',
  'expires_at',
  'created_at',
  'updated_at'
]);

/**
 * Procura uma resposta reutilizável para a intenção/pergunta/parâmetros dados.
 *
 * INTERFACE APENAS — não implementada nesta PR. Retorna sempre `null` (miss),
 * o que faz o fluxo seguir normalmente para os próximos caminhos da HIL.
 *
 * @param {object} [query]
 * @param {string} [query.intent] Intenção classificada.
 * @param {string} [query.normalizedQuestion] Pergunta normalizada.
 * @param {string} [query.parameterSignature] Assinatura estável dos parâmetros.
 * @returns {Promise<null|{response:string, version:string, qualityScore:number}>}
 */
async function findReusableResponse(query = {}) {
  // Fundação: sem armazenamento nem lookup real. Sempre miss.
  void query;
  return null;
}

module.exports = {
  findReusableResponse,
  RESPONSE_LIBRARY_COLUMNS
};
