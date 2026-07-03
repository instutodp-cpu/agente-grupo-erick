'use strict';

// ── Hermes Financeiro — Construtor de resposta (interface) ───────────────────
//
// FUNDAÇÃO (Sprint 1). INTERFACE APENAS. Define o contrato de como uma resposta
// financeira será formatada a partir de dados, mas ainda NÃO formata de fato
// (sem regra de negócio nova). Não está integrado ao chat.
//
// Contrato: buildFinancialResponse(capability, data, options) → objeto seguro
// com `text` (a resposta ao usuário, quando implementada) e metadados.

const { getCapability, isCapability } = require('./finance-capabilities');

/**
 * Constrói (no futuro) a resposta formatada de uma capacidade financeira.
 *
 * INTERFACE APENAS: não formata dados reais ainda. Retorna um objeto seguro,
 * nunca lança, indicando `implemented: false`.
 *
 * @param {string} capability Id da capacidade (ver finance-capabilities).
 * @param {object|Array} [data] Dados já consultados (linhas/agregados).
 * @param {object} [options]
 * @returns {{capability:(string|null), implemented:boolean, text:(string|null), meta:object}}
 */
function buildFinancialResponse(capability, data = null, options = {}) {
  void data;
  void options;

  if (!isCapability(capability)) {
    return {
      capability: null,
      implemented: false,
      text: null,
      meta: { error: 'unknown_capability' }
    };
  }

  const info = getCapability(capability);
  return {
    capability,
    implemented: false,
    text: null,
    meta: {
      title: info.title,
      status: info.status,
      note: 'Interface do Hermes Financeiro — formatação ainda não implementada.'
    }
  };
}

module.exports = {
  buildFinancialResponse
};
