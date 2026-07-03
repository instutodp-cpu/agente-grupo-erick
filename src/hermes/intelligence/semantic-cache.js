'use strict';

// ── Hermes Intelligence Layer (HIL) — Semantic Cache (fundação) ──────────────
//
// FUNDAÇÃO (Fase 2). Base do cache semântico: reutilizar respostas equivalentes
// mesmo quando o TEXTO da pergunta muda ("faturamento de cada loja em junho de
// 2026" ≈ "quanto cada loja faturou em junho/2026").
//
// Esta PR cria APENAS a fundação. Nada está integrado ao `/api/chat`, não há
// embeddings ainda e o comportamento atual não muda. `findSemanticCacheEntry` e
// `saveSemanticCacheEntry` são no-ops. A chave semântica desta fundação é
// LÉXICA (intenção + parâmetros, ou tokens canônicos da pergunta) — os
// embeddings entram numa fase seguinte, substituindo/complementando a chave.
//
// A tabela correspondente está documentada em
// `docs/sql/SEMANTIC_CACHE.sql` (não aplicada automaticamente).

const crypto = require('crypto');
const { stableStringify } = require('../cache');

// Stopwords comuns em PT-BR — removidas ao canonicalizar perguntas livres, para
// que variações de texto sem valor semântico não gerem chaves diferentes.
const STOPWORDS = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das',
  'em', 'no', 'na', 'nos', 'nas', 'por', 'para', 'pra', 'com', 'sem', 'e', 'ou',
  'que', 'qual', 'quais', 'quanto', 'quanta', 'quantos', 'quantas', 'como', 'me',
  'foi', 'e', 'ao', 'aos', 'the', 'of'
]);

/**
 * Normaliza a pergunta para uso semântico: minúsculas, sem acentos, sem
 * pontuação, espaços colapsados. NÃO remove stopwords (isso é feito na
 * canonicalização de tokens).
 * @param {string} question
 * @returns {string}
 */
function normalizeSemanticQuestion(question) {
  return String(question == null ? '' : question)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Reduz a pergunta a um conjunto canônico de tokens: normaliza, remove
// stopwords e ordena os tokens únicos. Assim, reordenar palavras ou adicionar
// palavras de ligação produz a mesma assinatura.
function canonicalTokenSignature(question) {
  const normalized = normalizeSemanticQuestion(question);
  if (!normalized) return '';
  const tokens = normalized
    .split(' ')
    .filter(token => token && !STOPWORDS.has(token));
  return [...new Set(tokens)].sort().join(' ');
}

// Assinatura estável de parâmetros (independe da ordem das chaves).
function parameterSignature(parameters) {
  if (!parameters || typeof parameters !== 'object') return '';
  return stableStringify(parameters);
}

/**
 * Constrói a chave semântica a partir da classificação e dos parâmetros.
 *
 * - Se a intenção é conhecida, a chave agrupa por `intent + parâmetros`: todas
 *   as formas de perguntar a mesma coisa (mesma intenção e parâmetros) colidem.
 * - Se a intenção é desconhecida, cai para os tokens canônicos da pergunta, de
 *   modo que reordenações/variações triviais ainda colidam.
 *
 * @param {{intent?:string, normalizedQuestion?:string, question?:string}} [classification]
 * @param {object} [parameters]
 * @returns {string} hash sha256 hex estável.
 */
function buildSemanticKey(classification = {}, parameters = {}) {
  const intent = classification && typeof classification.intent === 'string'
    ? classification.intent
    : 'unknown';
  const hasKnownIntent = intent && intent !== 'unknown' && intent !== 'empty';

  const questionText = classification && (classification.normalizedQuestion || classification.question || '');
  const basis = hasKnownIntent
    ? { intent, params: parameterSignature(parameters) }
    : { intent: 'unknown', tokens: canonicalTokenSignature(questionText), params: parameterSignature(parameters) };

  return crypto.createHash('sha256').update(stableStringify(basis)).digest('hex');
}

/**
 * Procura uma entrada de cache semântico equivalente.
 * INTERFACE APENAS — sempre retorna `null` (miss). Não toca em banco.
 * @returns {Promise<null|object>}
 */
async function findSemanticCacheEntry(query = {}) {
  void query;
  return null;
}

/**
 * Salva uma entrada de cache semântico.
 * INTERFACE APENAS — no-op, retorna `false` (nada gravado). Não toca em banco.
 * @returns {Promise<boolean>}
 */
async function saveSemanticCacheEntry(entry = {}) {
  void entry;
  return false;
}

// Colunas previstas para a tabela `semantic_cache` (referência da interface).
const SEMANTIC_CACHE_COLUMNS = Object.freeze([
  'id',
  'semantic_key',
  'intent',
  'normalized_question',
  'parameter_signature',
  'embedding',
  'response',
  'model',
  'version',
  'quality_score',
  'usage_count',
  'hit_count',
  'expires_at',
  'created_at',
  'updated_at'
]);

module.exports = {
  normalizeSemanticQuestion,
  canonicalTokenSignature,
  parameterSignature,
  buildSemanticKey,
  findSemanticCacheEntry,
  saveSemanticCacheEntry,
  SEMANTIC_CACHE_COLUMNS
};
