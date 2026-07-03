'use strict';

// ── Hermes Financeiro — Catálogo de capacidades ──────────────────────────────
//
// FUNDAÇÃO (Sprint 1). Este catálogo apenas DESCREVE as capacidades financeiras
// que o Hermes Financeiro terá. Nada aqui executa consulta, altera o chat, os
// SQL Templates, o cache ou o frontend. É a base de negócio sobre a qual as
// próximas PRs vão construir.
//
// `status`:
//   - 'available'  → há fonte de dados documentada para atender.
//   - 'partial'    → dado existe mas com limitações conhecidas.
//   - 'planned'    → depende de dados/infra ainda não disponíveis.

const CAPABILITIES = Object.freeze({
  daily_revenue: {
    id: 'daily_revenue',
    title: 'Faturamento do dia',
    description: 'Quanto o grupo (ou uma loja) vendeu hoje ou em um dia específico.',
    sources: ['public.vw_itens_vendidos', 'public.vw_faturamento_mensal'],
    status: 'available'
  },
  monthly_revenue: {
    id: 'monthly_revenue',
    title: 'Faturamento mensal',
    description: 'Faturamento por loja e mês (bruto, líquido, descontos, ticket médio).',
    sources: ['public.vw_faturamento_mensal'],
    status: 'available'
  },
  accounts_receivable: {
    id: 'accounts_receivable',
    title: 'Contas a receber / inadimplência',
    description: 'Parcelas em aberto, vencidas e recuperáveis por loja e faixa de atraso.',
    sources: ['public.vw_contas_a_receber', 'public.vw_inadimplencia_por_faixa'],
    status: 'available'
  },
  accounts_payable: {
    id: 'accounts_payable',
    title: 'Contas a pagar',
    description: 'Obrigações a pagar do grupo.',
    sources: ['softcom_import.financeiro_movimentacoes'],
    status: 'planned'
  },
  cash_flow: {
    id: 'cash_flow',
    title: 'Fluxo de caixa',
    description: 'Entradas e saídas ao longo do tempo.',
    sources: ['softcom_import.financeiro_movimentacoes'],
    status: 'planned'
  },
  top_customers: {
    id: 'top_customers',
    title: 'Melhores clientes',
    description: 'Clientes que mais compram por valor/volume.',
    sources: ['public.vw_itens_vendidos', 'softcom_import.cadastro_clientes'],
    status: 'partial'
  },
  store_comparison: {
    id: 'store_comparison',
    title: 'Comparação entre lojas',
    description: 'Ranking/comparativo de faturamento e desempenho entre lojas.',
    sources: ['public.vw_faturamento_mensal'],
    status: 'available'
  },
  ticket_average: {
    id: 'ticket_average',
    title: 'Ticket médio',
    description: 'Ticket médio por loja e período.',
    sources: ['public.vw_faturamento_mensal'],
    status: 'available'
  },
  payment_methods: {
    id: 'payment_methods',
    title: 'Formas de pagamento',
    description: 'Distribuição de vendas/recebimentos por forma de pagamento.',
    sources: ['public.vw_contas_a_receber'],
    status: 'partial'
  },
  financial_summary: {
    id: 'financial_summary',
    title: 'Resumo financeiro',
    description: 'Panorama consolidado: faturamento, recebíveis, inadimplência e ticket médio.',
    sources: ['public.vw_faturamento_mensal', 'public.vw_inadimplencia_por_faixa'],
    status: 'available'
  }
});

const CAPABILITY_IDS = Object.freeze(Object.keys(CAPABILITIES));

function getCapability(id) {
  return CAPABILITIES[id] || null;
}

function isCapability(id) {
  return Object.prototype.hasOwnProperty.call(CAPABILITIES, id);
}

function listCapabilities() {
  return CAPABILITY_IDS.map(id => CAPABILITIES[id]);
}

module.exports = {
  CAPABILITIES,
  CAPABILITY_IDS,
  getCapability,
  isCapability,
  listCapabilities
};
