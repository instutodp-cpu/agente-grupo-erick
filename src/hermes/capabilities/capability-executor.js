const { createCacheKey, getCacheEntry, setCacheEntry } = require('../cache');

const CAPABILITIES = {
  'finance.daily_revenue': {
    id: 'finance.daily_revenue',
    version: 'v1',
    status: 'available',
    requiresApproval: false,
    riskLevel: 'low',
    cacheProfile: 'current_day',
    cacheTtlMs: 10 * 60 * 1000,
    sql: `
      SELECT
        loja,
        COUNT(DISTINCT codigo_da_venda) AS qtd_vendas,
        SUM(quantidade)::numeric AS itens_vendidos,
        SUM(valor_total)::numeric AS faturamento
      FROM public.vw_itens_vendidos
      WHERE (data_venda::timestamptz AT TIME ZONE $2)::date = $1::date
        AND loja NOT LIKE '%DESATIVADO%'
        AND (itemdevolvido IS NULL OR itemdevolvido::text <> 'True')
      GROUP BY loja
      ORDER BY faturamento DESC
      LIMIT 50;
    `
  }
};

function formatCurrency(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('pt-BR');
}

function markdownTable(headers, rows) {
  const headerLine = `| ${headers.join(' | ')} |`;
  const separatorLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map(row => `| ${row.join(' | ')} |`).join('\n');
  return [headerLine, separatorLine, body].filter(Boolean).join('\n');
}

function assertCapabilityCanExecute(capability) {
  if (!capability) return { ok: false, reason: 'capability_not_found' };
  if (capability.status !== 'available') return { ok: false, reason: 'capability_not_available' };
  if (capability.requiresApproval) return { ok: false, reason: 'capability_requires_approval' };
  if (capability.riskLevel !== 'low') return { ok: false, reason: 'capability_risk_not_low' };
  return { ok: true };
}

function buildDailyRevenueResponse(rows, params) {
  if (!rows.length) {
    return [
      `### Faturamento diário — ${params.dateLabel}`,
      'Não encontrei vendas registradas para esse dia.',
      `_Período consultado: ${params.dateLabel}. Fonte: public.vw_itens_vendidos._`
    ].join('\n\n');
  }

  const total = rows.reduce((sum, row) => sum + Number(row.faturamento || 0), 0);
  return [
    `### Faturamento diário — ${params.dateLabel}`,
    markdownTable(
      ['Loja', 'Vendas', 'Itens', 'Faturamento'],
      rows.map(row => [
        row.loja,
        formatNumber(row.qtd_vendas),
        formatNumber(row.itens_vendidos),
        formatCurrency(row.faturamento)
      ])
    ),
    `**Total:** ${formatCurrency(total)}`,
    `_Período consultado: ${params.dateLabel}. Fonte: public.vw_itens_vendidos._`
  ].join('\n\n');
}

async function executeDailyRevenue(capability, context) {
  const log = typeof context.log === 'function' ? context.log : () => {};
  const params = context.params || {};
  if (!params.date) {
    return { success: false, fallback: true, reason: 'missing_date' };
  }
  const timeZone = context.timeZone || params.timeZone || 'America/Recife';
  const executionParams = { ...params, timeZone };

  const cacheKey = createCacheKey({
    templateName: capability.id,
    templateVersion: capability.version,
    params: executionParams
  });
  const cacheLookup = getCacheEntry(cacheKey);

  if (cacheLookup.status === 'hit') {
    log('info', 'cache_hit', {
      requestId: context.requestId,
      capabilityId: capability.id,
      capabilityVersion: capability.version,
      cacheProfile: capability.cacheProfile,
      cacheKey,
      ageMs: Date.now() - cacheLookup.entry.createdAt,
      ttlMs: cacheLookup.entry.ttlMs,
      rowCount: cacheLookup.entry.metadata.rowCount
    });
    return { success: true, text: cacheLookup.entry.value, cacheStatus: 'hit', rowCount: cacheLookup.entry.metadata.rowCount };
  }

  log('info', cacheLookup.status === 'expired' ? 'cache_expired' : 'cache_miss', {
    requestId: context.requestId,
    capabilityId: capability.id,
    capabilityVersion: capability.version,
    cacheProfile: capability.cacheProfile,
    cacheKey
  });

  const result = await context.queryDatabase(capability.sql, [params.date, timeZone], {
    statementTimeoutMs: context.queryTimeoutMs
  });
  const text = buildDailyRevenueResponse(result.rows, executionParams);

  setCacheEntry(cacheKey, text, capability.cacheTtlMs, {
    capabilityId: capability.id,
    capabilityVersion: capability.version,
    cacheProfile: capability.cacheProfile,
    rowCount: result.rowCount
  });
  log('info', 'cache_write', {
    requestId: context.requestId,
    capabilityId: capability.id,
    capabilityVersion: capability.version,
    cacheProfile: capability.cacheProfile,
    cacheKey,
    ttlMs: capability.cacheTtlMs,
    rowCount: result.rowCount
  });

  return { success: true, text, cacheStatus: 'miss', rowCount: result.rowCount };
}

async function executeCapability(capabilityId, context) {
  const capability = CAPABILITIES[capabilityId];
  const safety = assertCapabilityCanExecute(capability);
  if (!safety.ok) return { success: false, fallback: true, reason: safety.reason };

  if (capabilityId === 'finance.daily_revenue') {
    return executeDailyRevenue(capability, context);
  }

  return { success: false, fallback: true, reason: 'capability_not_implemented' };
}

module.exports = {
  CAPABILITIES,
  executeCapability
};
