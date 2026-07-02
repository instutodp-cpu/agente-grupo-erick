'use strict';

// ── Guardrails para SQL livre gerado pela IA (fallback Claude) ────────────────
// Este módulo NÃO altera regra de negócio. Ele apenas valida, de forma
// defensiva (defense-in-depth), qualquer SQL que o modelo gere via a tool
// `query_database` antes de executá-lo no Supabase. Só consultas de leitura
// (SELECT) em relações explicitamente permitidas passam.

function getPositiveIntegerEnv(name, defaultValue) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : defaultValue;
}

// LIMIT padrão aplicado quando a consulta não traz nenhum LIMIT.
const DEFAULT_LIMIT = getPositiveIntegerEnv('SQL_GUARDRAIL_DEFAULT_LIMIT', 1000);
// Timeout específico (ms) para a execução da consulta livre no Postgres.
const QUERY_TIMEOUT_MS = getPositiveIntegerEnv('SQL_GUARDRAIL_QUERY_TIMEOUT_MS', 15000);

// Allowlist de schemas permitidos.
const ALLOWED_SCHEMAS = new Set(['public', 'softcom_import']);

// Allowlist de views (schema public) e tabelas brutas (schema softcom_import),
// derivada do system prompt do agente. Nomes em minúsculas.
const ALLOWED_RELATIONS = new Set([
  // Views (public)
  'vw_faturamento_mensal',
  'vw_itens_vendidos',
  'vw_contas_a_receber',
  'vw_inadimplencia_por_faixa',
  'vw_produtos_catalogo',
  // Tabelas brutas (softcom_import)
  'cadastro_de_vendas',
  'vendas_efetuadas',
  'contas_a_receber',
  'compras_efetuadas',
  'cadastro_de_mercadorias',
  'cadastro_clientes',
  'bloquetes',
  'financeiro_movimentacoes'
]);

// Comandos que modificam dados/estrutura ou alteram permissões: sempre bloqueados.
const BLOCKED_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'TRUNCATE',
  'CREATE',
  'GRANT',
  'REVOKE',
  // Extras de alto risco, coerentes com "apenas leitura".
  'MERGE',
  'REPLACE',
  'CALL',
  'EXECUTE',
  'EXEC',
  'COPY',
  'VACUUM',
  'REINDEX',
  'COMMENT',
  'DO',
  'INTO' // bloqueia SELECT ... INTO (cria tabela/variável)
];

function makeBlock(reason, detail) {
  return {
    ok: false,
    reason,
    detail: detail || null,
    message:
      'Por segurança, só posso executar consultas de leitura (SELECT) em ' +
      'relatórios e tabelas autorizados. Posso te trazer esses dados de outra ' +
      'forma — reformule a pergunta que eu tento novamente.'
  };
}

// Coleta nomes de CTEs (WITH nome AS (...)) para não confundir com tabelas.
function collectCteNames(sql) {
  const names = new Set();
  const cteRegex = /(?:\bwith\b|,)\s+([a-z_][a-z0-9_$]*)\s+as\s*\(/gi;
  let match;
  while ((match = cteRegex.exec(sql)) !== null) {
    names.add(match[1].toLowerCase());
  }
  return names;
}

// Extrai as relações referenciadas após FROM/JOIN. Subqueries (FROM ( ... ))
// não casam porque o próximo token é "(", e o FROM interno é avaliado à parte.
function extractRelations(sql) {
  const relations = [];
  const relationRegex = /\b(?:from|join)\s+([a-z_][a-z0-9_$."]*)/gi;
  let match;
  while ((match = relationRegex.exec(sql)) !== null) {
    const raw = match[1].replace(/"/g, '').replace(/[.,;]+$/, '');
    relations.push(raw.toLowerCase());
  }
  return relations;
}

function validateRelation(relation, cteNames) {
  // CTE definida na própria consulta é permitida.
  if (cteNames.has(relation)) return null;

  const parts = relation.split('.');

  if (parts.length === 1) {
    const [name] = parts;
    if (!ALLOWED_RELATIONS.has(name)) {
      return makeBlock('disallowed_relation', relation);
    }
    return null;
  }

  if (parts.length === 2) {
    const [schema, name] = parts;
    if (!ALLOWED_SCHEMAS.has(schema)) {
      return makeBlock('disallowed_schema', relation);
    }
    if (!ALLOWED_RELATIONS.has(name)) {
      return makeBlock('disallowed_relation', relation);
    }
    return null;
  }

  // 3+ partes (ex.: banco.schema.tabela) não é permitido.
  return makeBlock('disallowed_relation', relation);
}

function hasLimitClause(sql) {
  return /\blimit\b/i.test(sql);
}

/**
 * Valida e normaliza um SQL livre gerado pela IA.
 * @returns {{ok:true, sql:string, appliedLimit:boolean}|{ok:false, reason:string, detail:string|null, message:string}}
 */
function validateSql(rawSql) {
  if (typeof rawSql !== 'string') {
    return makeBlock('not_a_string');
  }

  const trimmed = rawSql.trim();
  if (!trimmed) {
    return makeBlock('empty_sql');
  }

  // Bloqueia comentários (vetor comum de injeção/ocultação).
  if (trimmed.includes('--') || trimmed.includes('/*') || trimmed.includes('*/')) {
    return makeBlock('comment_detected');
  }

  // Remove um único ";" final opcional; qualquer outro ";" indica múltiplas
  // statements e é bloqueado.
  const withoutTrailing = trimmed.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) {
    return makeBlock('multiple_statements');
  }

  const normalized = withoutTrailing;

  // Deve começar com SELECT ou WITH (CTE de leitura).
  if (!/^\s*(select|with)\b/i.test(normalized)) {
    return makeBlock('not_select');
  }

  // Bloqueia comandos perigosos por palavra-chave.
  for (const keyword of BLOCKED_KEYWORDS) {
    const keywordRegex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (keywordRegex.test(normalized)) {
      return makeBlock('blocked_keyword', keyword);
    }
  }

  // Valida cada relação referenciada contra a allowlist.
  const cteNames = collectCteNames(normalized);
  const relations = extractRelations(normalized);
  for (const relation of relations) {
    const block = validateRelation(relation, cteNames);
    if (block) return block;
  }

  // Aplica LIMIT padrão quando não houver nenhum LIMIT.
  let finalSql = normalized;
  let appliedLimit = false;
  if (!hasLimitClause(normalized)) {
    finalSql = `${normalized} LIMIT ${DEFAULT_LIMIT}`;
    appliedLimit = true;
  }

  return { ok: true, sql: finalSql, appliedLimit };
}

module.exports = {
  validateSql,
  DEFAULT_LIMIT,
  QUERY_TIMEOUT_MS,
  ALLOWED_SCHEMAS,
  ALLOWED_RELATIONS,
  BLOCKED_KEYWORDS
};
