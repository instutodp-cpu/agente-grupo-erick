'use strict';

// ── Hermes — Registro central de capacidades ─────────────────────────────────
//
// Registro único e padronizado das capacidades do Hermes, para evitar
// duplicação à medida que novos domínios entram (Financeiro, Compras, RH,
// Marketing, Diretoria, Auditoria, Base44 Hub, …). Define o CONTRATO de uma
// capacidade e as funções para registrar, descobrir e (futuramente) executar.
//
// Esta PR NÃO altera o fluxo do `/api/chat`, SQL, cache, Claude ou frontend.
// O registry apenas guarda metadados e referências (handler/responseBuilder);
// a execução via registry será ligada em PRs seguintes.

const { buildFinanceExecution } = require('../finance/finance-execution');
const { buildFinancialResponse } = require('../finance/financial-response-builder');

const VALID_STATUS = Object.freeze(['integrated', 'available', 'partial', 'planned']);
const VALID_RISK = Object.freeze(['low', 'medium', 'high']);

// Contrato padrão. Campos obrigatórios validados no registro; os demais têm
// default para manter a forma estável em todo o registry.
const DEFAULTS = Object.freeze({
  description: '',
  riskLevel: 'low',
  requiresApproval: false,
  templateName: null,
  cacheProfile: null,
  permissions: [],
  handler: null,
  responseBuilder: null
});

const registry = new Map();

function assert(condition, message) {
  if (!condition) throw new Error(`[capability-registry] ${message}`);
}

function validateCapability(capability) {
  assert(capability && typeof capability === 'object', 'capability deve ser um objeto');
  assert(typeof capability.id === 'string' && capability.id.trim().length > 0, 'campo obrigatório: id');
  assert(typeof capability.domain === 'string' && capability.domain.trim().length > 0, `campo obrigatório: domain (${capability.id})`);
  assert(typeof capability.title === 'string' && capability.title.trim().length > 0, `campo obrigatório: title (${capability.id})`);
  assert(Array.isArray(capability.intents) && capability.intents.length > 0, `campo obrigatório: intents[] não vazio (${capability.id})`);
  assert(capability.intents.every(i => typeof i === 'string' && i.length > 0), `intents devem ser strings (${capability.id})`);
  assert(VALID_STATUS.includes(capability.status), `status inválido: ${capability.status} (${capability.id}); use ${VALID_STATUS.join('|')}`);

  if (capability.riskLevel !== undefined) {
    assert(VALID_RISK.includes(capability.riskLevel), `riskLevel inválido: ${capability.riskLevel} (${capability.id})`);
  }
  if (capability.requiresApproval !== undefined) {
    assert(typeof capability.requiresApproval === 'boolean', `requiresApproval deve ser boolean (${capability.id})`);
  }
  if (capability.permissions !== undefined) {
    assert(Array.isArray(capability.permissions), `permissions deve ser array (${capability.id})`);
  }
  if (capability.handler !== undefined && capability.handler !== null) {
    assert(typeof capability.handler === 'function', `handler deve ser função (${capability.id})`);
  }
  if (capability.responseBuilder !== undefined && capability.responseBuilder !== null) {
    assert(typeof capability.responseBuilder === 'function', `responseBuilder deve ser função (${capability.id})`);
  }
}

/**
 * Registra uma capacidade. Valida o contrato e impede ids duplicados.
 * @returns {object} a capacidade normalizada (com defaults aplicados).
 */
function registerCapability(capability) {
  validateCapability(capability);
  assert(!registry.has(capability.id), `id duplicado: ${capability.id}`);

  const normalized = {
    ...DEFAULTS,
    ...capability,
    intents: [...capability.intents],
    permissions: [...(capability.permissions || DEFAULTS.permissions)]
  };
  registry.set(normalized.id, normalized);
  return normalized;
}

function getCapability(id) {
  return registry.get(id) || null;
}

function listCapabilities() {
  return [...registry.values()];
}

function findCapabilitiesByDomain(domain) {
  return listCapabilities().filter(cap => cap.domain === domain);
}

function findCapabilitiesByIntent(intent) {
  return listCapabilities().filter(cap => cap.intents.includes(intent));
}

// ── Capacidades embutidas ────────────────────────────────────────────────────
// Registra as capacidades já existentes. finance.daily_revenue é a primeira.
function registerBuiltInCapabilities() {
  registerCapability({
    id: 'finance.daily_revenue',
    domain: 'finance',
    title: 'Faturamento do dia',
    description: 'Faturamento de hoje por loja (Hermes Financeiro).',
    intents: ['daily_revenue'],
    status: 'integrated',
    riskLevel: 'low',
    requiresApproval: false,
    templateName: 'finance_daily_revenue',
    cacheProfile: 'current_day',
    permissions: ['finance:read'],
    handler: buildFinanceExecution,
    responseBuilder: buildFinancialResponse
  });
}

// Restaura o registry ao estado inicial (útil em testes).
function resetRegistry() {
  registry.clear();
  registerBuiltInCapabilities();
}

registerBuiltInCapabilities();

module.exports = {
  registerCapability,
  getCapability,
  listCapabilities,
  findCapabilitiesByDomain,
  findCapabilitiesByIntent,
  resetRegistry,
  VALID_STATUS,
  VALID_RISK
};
