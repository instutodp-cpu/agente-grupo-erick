'use strict';

// Registro central de capacidades — mapeia cada domínio já classificado pelo
// intent-router (services/api/src/core/intent-router.js) para metadados de
// execução futura. Nenhuma capacidade está implementada ainda: todas em
// status "planned", sem adapters conectados nem ações reais.

const DEFAULT_PLANNED_MESSAGE = 'Intencao identificada; execucao ainda nao implementada.';
const FALLBACK_PLANNED_MESSAGE = 'Nao encontrei uma capacidade especifica para essa mensagem; nenhuma acao foi executada.';

const CAPABILITIES = {
  compras: {
    domain: 'compras',
    description: 'Consultas de compras e vencimentos (pedidos, fornecedores, duplicatas).',
    status: 'planned',
    publicMessage: DEFAULT_PLANNED_MESSAGE,
    requiredAdapters: ['DataStore']
  },
  financeiro: {
    domain: 'financeiro',
    description: 'Consultas financeiras (caixa, faturamento, despesas, DRE).',
    status: 'planned',
    publicMessage: DEFAULT_PLANNED_MESSAGE,
    requiredAdapters: ['DataStore']
  },
  treinamento: {
    domain: 'treinamento',
    description: 'Consultas de treinamento (cursos, módulos, certificados).',
    status: 'planned',
    publicMessage: DEFAULT_PLANNED_MESSAGE,
    requiredAdapters: ['DataStore']
  },
  marketing: {
    domain: 'marketing',
    description: 'Planejamento de campanhas e ações de marketing.',
    status: 'planned',
    publicMessage: DEFAULT_PLANNED_MESSAGE,
    requiredAdapters: ['ModelProvider']
  },
  desenvolvimento: {
    domain: 'desenvolvimento',
    description: 'Ações de desenvolvimento (bugs, deploys, código) via MCP Gateway.',
    status: 'planned',
    publicMessage: DEFAULT_PLANNED_MESSAGE,
    requiredAdapters: ['McpGateway']
  },
  desconhecido: {
    domain: 'desconhecido',
    description: 'Fallback — nenhuma capacidade associada.',
    status: 'planned',
    publicMessage: FALLBACK_PLANNED_MESSAGE,
    requiredAdapters: []
  }
};

function getCapability(domain) {
  return CAPABILITIES[domain] || null;
}

function listCapabilities() {
  return Object.values(CAPABILITIES);
}

module.exports = { CAPABILITIES, getCapability, listCapabilities };
