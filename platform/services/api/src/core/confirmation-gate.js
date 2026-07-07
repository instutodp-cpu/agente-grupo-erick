'use strict';

const CONFIRMATION_REQUIRED_DOMAINS = new Set([
  'compras',
  'financeiro',
  'treinamento',
  'marketing',
  'desenvolvimento'
]);

function evaluateConfirmationGate({ domain, capability }) {
  const hasExecutableFutureCapability = Boolean(capability && capability.domain !== 'desconhecido');

  return {
    confirmationRequired: hasExecutableFutureCapability && CONFIRMATION_REQUIRED_DOMAINS.has(domain)
  };
}

module.exports = { evaluateConfirmationGate };
