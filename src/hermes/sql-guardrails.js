const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;

const ALLOWED_RELATIONS = new Set([
  'public.vw_faturamento_mensal',
  'public.vw_itens_vendidos',
  'public.vw_contas_a_receber',
  'public.vw_inadimplencia_por_faixa',
  'public.vw_produtos_catalogo',
  'softcom_import.cadastro_de_vendas',
  'softcom_import.vendas_efetuadas',
  'softcom_import.contas_a_receber',
  'softcom_import.compras_efetuadas',
  'softcom_import.cadastro_de_mercadorias',
  'softcom_import.cadastro_clientes',
  'softcom_import.bloquetes',
  'softcom_import.financeiro_movimentacoes'
]);

const DEFAULT_SCHEMA_BY_RELATION = new Map([
  ['vw_faturamento_mensal', 'public'],
  ['vw_itens_vendidos', 'public'],
  ['vw_contas_a_receber', 'public'],
  ['vw_inadimplencia_por_faixa', 'public'],
  ['vw_produtos_catalogo', 'public'],
  ['cadastro_de_vendas', 'softcom_import'],
  ['vendas_efetuadas', 'softcom_import'],
  ['contas_a_receber', 'softcom_import'],
  ['compras_efetuadas', 'softcom_import'],
  ['cadastro_de_mercadorias', 'softcom_import'],
  ['cadastro_clientes', 'softcom_import'],
  ['bloquetes', 'softcom_import'],
  ['financeiro_movimentacoes', 'softcom_import']
]);

const BLOCKED_KEYWORDS = [
  'insert', 'update', 'delete', 'drop', 'alter', 'truncate', 'create',
  'grant', 'revoke', 'copy', 'execute', 'call', 'merge', 'replace',
  'vacuum', 'analyze', 'refresh', 'reindex', 'listen', 'notify', 'prepare'
];

const BLOCKED_FUNCTIONS = [
  'pg_sleep', 'dblink', 'postgres_fdw', 'lo_import', 'lo_export',
  'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'pg_stat_file',
  'pg_reload_conf', 'pg_terminate_backend', 'pg_cancel_backend',
  'set_config', 'current_setting'
];

function normalizeSql(sql = '') {
  return String(sql).trim().replace(/;\s*$/, '').trim();
}

function hasMultipleStatements(sql) {
  const withoutTrailing = String(sql).trim().replace(/;\s*$/, '');
  return withoutTrailing.includes(';');
}

function hasSuspiciousComments(sql) {
  return /--|\/\*|\*\//.test(sql);
}

function startsWithSelect(sql) {
  return /^select\b/i.test(sql.trim());
}

function containsBlockedKeyword(sql) {
  const lowered = sql.toLowerCase();
  return BLOCKED_KEYWORDS.find(keyword => new RegExp(`\\b${keyword}\\b`, 'i').test(lowered));
}

function containsBlockedFunction(sql) {
  const lowered = sql.toLowerCase();
  return BLOCKED_FUNCTIONS.find(fn => new RegExp(`\\b${fn}\\s*\\(`, 'i').test(lowered));
}

function extractRelations(sql) {
  const relations = [];
  const relationPattern = /\b(?:from|join)\s+([a-zA-Z_][\w$]*(?:\.[a-zA-Z_][\w$]*)?)/gi;
  let match;

  while ((match = relationPattern.exec(sql)) !== null) {
    const raw = match[1].replace(/"/g, '').toLowerCase();
    if (raw.startsWith('select')) continue;
    relations.push(raw);
  }

  return relations;
}

function normalizeRelation(relation) {
  if (relation.includes('.')) return relation;
  const schema = DEFAULT_SCHEMA_BY_RELATION.get(relation);
  return schema ? `${schema}.${relation}` : relation;
}

function findDisallowedRelation(relations) {
  for (const relation of relations) {
    const normalized = normalizeRelation(relation);
    if (!ALLOWED_RELATIONS.has(normalized)) return normalized;
  }
  return null;
}

function hasLimit(sql) {
  return /\blimit\s+\d+\b/i.test(sql);
}

function enforceLimit(sql, defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT) {
  if (!hasLimit(sql)) return `${sql}\nLIMIT ${defaultLimit}`;

  return sql.replace(/\blimit\s+(\d+)\b/i, (match, value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= maxLimit) return match;
    return `LIMIT ${maxLimit}`;
  });
}

function validateFreeformSql(sql, options = {}) {
  const startedAt = Date.now();
  const defaultLimit = options.defaultLimit || DEFAULT_LIMIT;
  const maxLimit = options.maxLimit || MAX_LIMIT;
  const originalLength = String(sql || '').length;
  const normalizedSql = normalizeSql(sql);

  if (!normalizedSql) {
    return { allowed: false, reason: 'empty_sql', durationMs: Date.now() - startedAt, originalLength };
  }

  if (hasSuspiciousComments(normalizedSql)) {
    return { allowed: false, reason: 'suspicious_comment', durationMs: Date.now() - startedAt, originalLength };
  }

  if (hasMultipleStatements(sql)) {
    return { allowed: false, reason: 'multiple_statements', durationMs: Date.now() - startedAt, originalLength };
  }

  if (!startsWithSelect(normalizedSql)) {
    return { allowed: false, reason: 'only_select_allowed', durationMs: Date.now() - startedAt, originalLength };
  }

  const blockedKeyword = containsBlockedKeyword(normalizedSql);
  if (blockedKeyword) {
    return { allowed: false, reason: `blocked_keyword:${blockedKeyword}`, durationMs: Date.now() - startedAt, originalLength };
  }

  const blockedFunction = containsBlockedFunction(normalizedSql);
  if (blockedFunction) {
    return { allowed: false, reason: `blocked_function:${blockedFunction}`, durationMs: Date.now() - startedAt, originalLength };
  }

  const relations = extractRelations(normalizedSql);
  if (!relations.length) {
    return { allowed: false, reason: 'no_relation_found', durationMs: Date.now() - startedAt, originalLength };
  }

  const disallowedRelation = findDisallowedRelation(relations);
  if (disallowedRelation) {
    return {
      allowed: false,
      reason: 'relation_not_allowed',
      relation: disallowedRelation,
      durationMs: Date.now() - startedAt,
      originalLength
    };
  }

  const safeSql = enforceLimit(normalizedSql, defaultLimit, maxLimit);
  return {
    allowed: true,
    sql: safeSql,
    relations: relations.map(normalizeRelation),
    defaultLimitApplied: !hasLimit(normalizedSql),
    durationMs: Date.now() - startedAt,
    originalLength
  };
}

module.exports = {
  ALLOWED_RELATIONS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  validateFreeformSql
};
