'use strict';

// Roteador de intenção — classificação simples por palavras-chave.
// Sem dependências externas: normaliza caixa/acentos e casa contra listas fixas.
// Lógica de domínio pura (sem I/O), pronta para evoluir para um resolver mais
// sofisticado sem mudar o contrato de `classifyIntent` ({ domain, intent }).

const DOMAIN_MARKETING = 'marketing';
const DOMAIN_DESENVOLVIMENTO = 'desenvolvimento';
const DOMAIN_COMPRAS = 'compras';
const DOMAIN_FINANCEIRO = 'financeiro';
const DOMAIN_TREINAMENTO = 'treinamento';
const DOMAIN_UNKNOWN = 'desconhecido';

const INTENT_PLANEJAR_MARKETING = 'planejar_marketing';
const INTENT_DESENVOLVIMENTO = 'desenvolvimento';
const INTENT_CONSULTAR_COMPRAS = 'consultar_compras';
const INTENT_CONSULTAR_VENCIMENTOS = 'consultar_vencimentos';
const INTENT_CONSULTAR_FINANCEIRO = 'consultar_financeiro';
const INTENT_CONSULTAR_TREINAMENTO = 'consultar_treinamento';
const INTENT_UNKNOWN = 'desconhecido';

const MARKETING_KEYWORDS = [
  'marketing', 'campanha', 'campanhas', 'anuncio', 'anuncios', 'propaganda',
  'publicidade', 'venda', 'vendas', 'promocao', 'promocoes', 'divulgacao'
];

const DESENVOLVIMENTO_KEYWORDS = [
  'bug', 'deploy', 'codigo', 'api', 'erro', 'feature', 'commit', 'merge',
  'build', 'release', 'refactor', 'pull request', 'repositorio', 'servidor'
];

const COMPRAS_KEYWORDS = [
  'compra', 'compras', 'comprar', 'pedido', 'fornecedor', 'cotacao',
  'orcamento', 'nota fiscal', 'fatura', 'invoice', 'purchase order'
];

// Subconjunto de COMPRAS que indica uma consulta de vencimentos/prazos.
const VENCIMENTOS_KEYWORDS = [
  'vencimento', 'vencimentos', 'duplicata', 'duplicatas', 'prazo', 'boleto', 'nota fiscal'
];

const FINANCEIRO_KEYWORDS = [
  'financeiro', 'caixa', 'faturamento', 'lucro', 'despesa', 'despesas', 'dre',
  'sangria', 'contas', 'pagamento'
];

const TREINAMENTO_KEYWORDS = [
  'treinamento', 'curso', 'cursos', 'modulo', 'modulos', 'certificado', 'quiz',
  'capacitai', 'colaborador'
];

const DIACRITICS_PATTERN = /[̀-ͯ]/g;

function normalize(text) {
  return text
    .normalize('NFD')
    .replace(DIACRITICS_PATTERN, '')
    .toLowerCase();
}

function matchesAny(normalizedText, keywords) {
  return keywords.some((keyword) => normalizedText.includes(keyword));
}

function classifyIntent(message) {
  const normalized = normalize(message);

  if (matchesAny(normalized, MARKETING_KEYWORDS)) {
    return { domain: DOMAIN_MARKETING, intent: INTENT_PLANEJAR_MARKETING };
  }

  if (matchesAny(normalized, DESENVOLVIMENTO_KEYWORDS)) {
    return { domain: DOMAIN_DESENVOLVIMENTO, intent: INTENT_DESENVOLVIMENTO };
  }

  if (matchesAny(normalized, FINANCEIRO_KEYWORDS)) {
    return { domain: DOMAIN_FINANCEIRO, intent: INTENT_CONSULTAR_FINANCEIRO };
  }

  if (matchesAny(normalized, TREINAMENTO_KEYWORDS)) {
    return { domain: DOMAIN_TREINAMENTO, intent: INTENT_CONSULTAR_TREINAMENTO };
  }

  const isVencimentos = matchesAny(normalized, VENCIMENTOS_KEYWORDS);
  if (isVencimentos || matchesAny(normalized, COMPRAS_KEYWORDS)) {
    const intent = isVencimentos ? INTENT_CONSULTAR_VENCIMENTOS : INTENT_CONSULTAR_COMPRAS;
    return { domain: DOMAIN_COMPRAS, intent };
  }

  return { domain: DOMAIN_UNKNOWN, intent: INTENT_UNKNOWN };
}

module.exports = {
  classifyIntent,
  DOMAIN_MARKETING,
  DOMAIN_DESENVOLVIMENTO,
  DOMAIN_COMPRAS,
  DOMAIN_FINANCEIRO,
  DOMAIN_TREINAMENTO,
  DOMAIN_UNKNOWN,
  INTENT_PLANEJAR_MARKETING,
  INTENT_DESENVOLVIMENTO,
  INTENT_CONSULTAR_COMPRAS,
  INTENT_CONSULTAR_VENCIMENTOS,
  INTENT_CONSULTAR_FINANCEIRO,
  INTENT_CONSULTAR_TREINAMENTO,
  INTENT_UNKNOWN
};
