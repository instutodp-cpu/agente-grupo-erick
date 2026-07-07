'use strict';

const DOMAIN_MOCK_ADAPTERS = {
  compras: {
    adapter_id: 'mock-compras',
    adapter_mode: 'mock',
    domain: 'compras'
  },
  financeiro: {
    adapter_id: 'mock-financeiro',
    adapter_mode: 'mock',
    domain: 'financeiro'
  },
  treinamento: {
    adapter_id: 'mock-treinamento',
    adapter_mode: 'mock',
    domain: 'treinamento'
  },
  marketing: {
    adapter_id: 'mock-marketing',
    adapter_mode: 'mock',
    domain: 'marketing'
  },
  desenvolvimento: {
    adapter_id: 'mock-desenvolvimento',
    adapter_mode: 'mock',
    domain: 'desenvolvimento'
  }
};

function cloneAdapter(adapter) {
  return adapter ? { ...adapter } : null;
}

function getDomainMockAdapter(domain) {
  return cloneAdapter(DOMAIN_MOCK_ADAPTERS[domain] || null);
}

function listDomainMockAdapters() {
  return Object.values(DOMAIN_MOCK_ADAPTERS).map(cloneAdapter);
}

module.exports = {
  DOMAIN_MOCK_ADAPTERS,
  getDomainMockAdapter,
  listDomainMockAdapters
};
