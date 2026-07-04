'use strict';

// Roteador de intenção — classificação simples por palavras-chave.
// Sem dependências externas: normaliza caixa/acentos e casa contra listas fixas.
// Lógica de domínio pura (sem I/O), pronta para evoluir para um resolver mais
// sofisticado sem mudar o contrato de `classifyIntent`.

const INTENT_MARKETING = 'marketing';
const INTENT_DESENVOLVIMENTO = 'desenvolvimento';
const INTENT_UNKNOWN = 'desconhecido';

const MARKETING_KEYWORDS = [
  'marketing', 'campanha', 'campanhas', 'anuncio', 'anuncios', 'propaganda',
  'publicidade', 'venda', 'vendas', 'promocao', 'promocoes', 'divulgacao'
];

const DESENVOLVIMENTO_KEYWORDS = [
  'bug', 'deploy', 'codigo', 'api', 'erro', 'feature', 'commit', 'merge',
  'build', 'release', 'refactor', 'pull request', 'repositorio', 'servidor'
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
    return INTENT_MARKETING;
  }

  if (matchesAny(normalized, DESENVOLVIMENTO_KEYWORDS)) {
    return INTENT_DESENVOLVIMENTO;
  }

  return INTENT_UNKNOWN;
}

module.exports = {
  classifyIntent,
  INTENT_MARKETING,
  INTENT_DESENVOLVIMENTO,
  INTENT_UNKNOWN
};
