const MONTHS = {
  janeiro: 0,
  fevereiro: 1,
  marco: 2,
  março: 2,
  abril: 3,
  maio: 4,
  junho: 5,
  julho: 6,
  agosto: 7,
  setembro: 8,
  outubro: 9,
  novembro: 10,
  dezembro: 11
};

function normalizeText(text = '') {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function toDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function parseMonthYear(text, fallbackMonth, fallbackYear) {
  const normalized = normalizeText(text);
  const monthEntry = Object.entries(MONTHS).find(([name]) => normalized.includes(normalizeText(name)));
  const yearMatch = normalized.match(/\b(20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : fallbackYear;
  const month = monthEntry ? monthEntry[1] : fallbackMonth;
  return { month, year, hasMonth: Boolean(monthEntry), hasYear: Boolean(yearMatch) };
}

function makeMonthStart(year, month) {
  return `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('pt-BR');
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function markdownTable(headers, rows) {
  const headerLine = `| ${headers.join(' | ')} |`;
  const separatorLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map(row => `| ${row.join(' | ')} |`).join('\n');
  return [headerLine, separatorLine, body].filter(Boolean).join('\n');
}

const templates = {
  monthly_revenue_by_store: {
    name: 'monthly_revenue_by_store',
    version: 'v1',
    cacheTtlMs: 24 * 60 * 60 * 1000,
    cacheProfile: 'historical',
    description: 'Faturamento por loja em um mês específico.',
    buildParams(question) {
      const { month, year } = parseMonthYear(question, 5, 2026);
      return { monthStart: makeMonthStart(year, month), label: `${String(month + 1).padStart(2, '0')}/${year}` };
    },
    sql: `
      SELECT
        loja,
        SUM(qtd_vendas)::int AS qtd_vendas,
        SUM(faturamento_bruto)::numeric AS faturamento_bruto,
        SUM(total_desconto)::numeric AS total_desconto,
        SUM(faturamento_liquido)::numeric AS faturamento_liquido,
        CASE WHEN SUM(qtd_vendas) = 0 THEN 0
             ELSE SUM(faturamento_liquido)::numeric / SUM(qtd_vendas)::numeric
        END AS ticket_medio
      FROM public.vw_faturamento_mensal
      WHERE mes::date >= $1::date
        AND mes::date < ($1::date + interval '1 month')
        AND loja NOT LIKE '%DESATIVADO%'
      GROUP BY loja
      ORDER BY faturamento_liquido DESC;
    `,
    values(params) {
      return [params.monthStart];
    },
    format(rows, params) {
      if (!rows.length) return `Não encontrei faturamento por loja no período ${params.label}.`;
      const total = rows.reduce((sum, row) => sum + Number(row.faturamento_liquido || 0), 0);
      return [
        `### Faturamento por loja — ${params.label}`,
        markdownTable(
          ['Loja', 'Vendas', 'Faturamento bruto', 'Descontos', 'Faturamento líquido', 'Ticket médio'],
          rows.map(row => [
            row.loja,
            formatNumber(row.qtd_vendas),
            formatCurrency(row.faturamento_bruto),
            formatCurrency(row.total_desconto),
            formatCurrency(row.faturamento_liquido),
            formatCurrency(row.ticket_medio)
          ])
        ),
        `**Total líquido:** ${formatCurrency(total)}`,
        `_Período consultado: ${params.label}. Fonte: public.vw_faturamento_mensal._`
      ].join('\n\n');
    }
  },

  recoverable_delinquency_by_store: {
    name: 'recoverable_delinquency_by_store',
    version: 'v1',
    cacheTtlMs: 10 * 60 * 1000,
    cacheProfile: 'current_day',
    description: 'Inadimplência recuperável por loja.',
    buildParams() {
      return { label: 'posição atual da view de inadimplência' };
    },
    sql: `
      SELECT
        loja,
        SUM(qtd_parcelas)::int AS qtd_parcelas,
        SUM(valor_em_aberto)::numeric AS valor_em_aberto,
        AVG(media_dias_atraso)::numeric AS media_dias_atraso,
        MIN(vencimento_mais_antigo)::date AS vencimento_mais_antigo,
        MAX(vencimento_mais_recente)::date AS vencimento_mais_recente
      FROM public.vw_inadimplencia_por_faixa
      WHERE classificacao = 'RECUPERAVEL'
        AND loja NOT LIKE '%DESATIVADO%'
      GROUP BY loja
      ORDER BY valor_em_aberto DESC;
    `,
    values() {
      return [];
    },
    format(rows, params) {
      if (!rows.length) return 'Não encontrei inadimplência recuperável na posição atual.';
      const total = rows.reduce((sum, row) => sum + Number(row.valor_em_aberto || 0), 0);
      return [
        '### Inadimplência recuperável por loja',
        markdownTable(
          ['Loja', 'Parcelas', 'Valor em aberto', 'Média de atraso', 'Vencimento mais antigo', 'Vencimento mais recente'],
          rows.map(row => [
            row.loja,
            formatNumber(row.qtd_parcelas),
            formatCurrency(row.valor_em_aberto),
            `${Number(row.media_dias_atraso || 0).toFixed(1)} dias`,
            row.vencimento_mais_antigo || '—',
            row.vencimento_mais_recente || '—'
          ])
        ),
        `**Total recuperável:** ${formatCurrency(total)}`,
        `_Período consultado: ${params.label}. Fonte: public.vw_inadimplencia_por_faixa._`
      ].join('\n\n');
    }
  },

  revenue_year_comparison_by_store: {
    name: 'revenue_year_comparison_by_store',
    version: 'v1',
    cacheTtlMs: 7 * 24 * 60 * 60 * 1000,
    cacheProfile: 'historical',
    description: 'Comparativo de faturamento entre dois anos por loja.',
    buildParams(question) {
      const years = [...normalizeText(question).matchAll(/\b(20\d{2})\b/g)].map(match => Number(match[1]));
      const [yearA, yearB] = years.length >= 2 ? years : [2025, 2024];
      const startYear = Math.min(yearA, yearB);
      const endYear = Math.max(yearA, yearB);
      return { yearA, yearB, startDate: `${startYear}-01-01`, endDate: `${endYear + 1}-01-01` };
    },
    sql: `
      SELECT
        loja,
        SUM(CASE WHEN EXTRACT(YEAR FROM mes::date) = $1::int THEN faturamento_liquido ELSE 0 END)::numeric AS faturamento_ano_a,
        SUM(CASE WHEN EXTRACT(YEAR FROM mes::date) = $2::int THEN faturamento_liquido ELSE 0 END)::numeric AS faturamento_ano_b,
        (
          SUM(CASE WHEN EXTRACT(YEAR FROM mes::date) = $1::int THEN faturamento_liquido ELSE 0 END) -
          SUM(CASE WHEN EXTRACT(YEAR FROM mes::date) = $2::int THEN faturamento_liquido ELSE 0 END)
        )::numeric AS diferenca,
        CASE
          WHEN SUM(CASE WHEN EXTRACT(YEAR FROM mes::date) = $2::int THEN faturamento_liquido ELSE 0 END) = 0 THEN NULL
          ELSE (
            (
              SUM(CASE WHEN EXTRACT(YEAR FROM mes::date) = $1::int THEN faturamento_liquido ELSE 0 END) -
              SUM(CASE WHEN EXTRACT(YEAR FROM mes::date) = $2::int THEN faturamento_liquido ELSE 0 END)
            ) / SUM(CASE WHEN EXTRACT(YEAR FROM mes::date) = $2::int THEN faturamento_liquido ELSE 0 END)
          ) * 100
        END AS variacao_percentual
      FROM public.vw_faturamento_mensal
      WHERE mes::date >= $3::date
        AND mes::date < $4::date
        AND loja NOT LIKE '%DESATIVADO%'
      GROUP BY loja
      ORDER BY faturamento_ano_a DESC;
    `,
    values(params) {
      return [params.yearA, params.yearB, params.startDate, params.endDate];
    },
    format(rows, params) {
      if (!rows.length) return `Não encontrei faturamento para comparar ${params.yearA} vs ${params.yearB}.`;
      return [
        `### Comparativo de faturamento — ${params.yearA} vs ${params.yearB}`,
        markdownTable(
          ['Loja', String(params.yearA), String(params.yearB), 'Diferença', 'Variação'],
          rows.map(row => [
            row.loja,
            formatCurrency(row.faturamento_ano_a),
            formatCurrency(row.faturamento_ano_b),
            formatCurrency(row.diferenca),
            formatPercent(row.variacao_percentual)
          ])
        ),
        `_Período consultado: anos fechados ${params.yearA} e ${params.yearB}. Fonte: public.vw_faturamento_mensal._`
      ].join('\n\n');
    }
  },

  top_products_last_six_months: {
    name: 'top_products_last_six_months',
    version: 'v1',
    cacheTtlMs: 60 * 60 * 1000,
    cacheProfile: 'heavy_report',
    description: 'Top 10 produtos mais vendidos nos últimos 6 meses.',
    buildParams() {
      const endDate = new Date();
      const startDate = new Date(endDate);
      startDate.setMonth(startDate.getMonth() - 6);
      return { startDate: toDateOnly(startDate), endDate: toDateOnly(endDate), limit: 10 };
    },
    sql: `
      SELECT
        codigo_produto,
        produto,
        SUM(quantidade)::numeric AS quantidade,
        SUM(valor_total)::numeric AS valor_total
      FROM public.vw_itens_vendidos
      WHERE data_venda::date >= $1::date
        AND data_venda::date <= $2::date
        AND loja NOT LIKE '%DESATIVADO%'
        AND (itemdevolvido IS NULL OR itemdevolvido::text <> 'True')
      GROUP BY codigo_produto, produto
      ORDER BY quantidade DESC, valor_total DESC
      LIMIT $3;
    `,
    values(params) {
      return [params.startDate, params.endDate, params.limit];
    },
    format(rows, params) {
      if (!rows.length) return `Não encontrei produtos vendidos entre ${params.startDate} e ${params.endDate}.`;
      return [
        '### 10 produtos mais vendidos nos últimos 6 meses',
        markdownTable(
          ['#', 'Código', 'Produto', 'Quantidade', 'Valor total'],
          rows.map((row, index) => [
            String(index + 1),
            row.codigo_produto || '—',
            row.produto || '—',
            formatNumber(row.quantidade),
            formatCurrency(row.valor_total)
          ])
        ),
        `_Período consultado: ${params.startDate} a ${params.endDate}. Fonte: public.vw_itens_vendidos._`
      ].join('\n\n');
    }
  },

  top_salespeople_by_year: {
    name: 'top_salespeople_by_year',
    version: 'v1',
    cacheTtlMs: 24 * 60 * 60 * 1000,
    cacheProfile: 'heavy_report',
    description: 'Melhores vendedores por faturamento em um ano.',
    buildParams(question) {
      const yearMatch = normalizeText(question).match(/\b(20\d{2})\b/);
      const year = yearMatch ? Number(yearMatch[1]) : 2025;
      return { year, startDate: `${year}-01-01`, endDate: `${year + 1}-01-01`, limit: 15 };
    },
    sql: `
      SELECT
        loja,
        vendedor,
        COUNT(DISTINCT codigo_da_venda) AS qtd_vendas,
        SUM(quantidade)::numeric AS itens_vendidos,
        SUM(valor_total)::numeric AS faturamento
      FROM public.vw_itens_vendidos
      WHERE data_venda::date >= $1::date
        AND data_venda::date < $2::date
        AND loja NOT LIKE '%DESATIVADO%'
        AND vendedor IS NOT NULL
        AND vendedor <> ''
        AND (itemdevolvido IS NULL OR itemdevolvido::text <> 'True')
      GROUP BY loja, vendedor
      ORDER BY faturamento DESC
      LIMIT $3;
    `,
    values(params) {
      return [params.startDate, params.endDate, params.limit];
    },
    format(rows, params) {
      if (!rows.length) return `Não encontrei vendas por vendedor em ${params.year}.`;
      return [
        `### Melhores vendedores — ${params.year}`,
        markdownTable(
          ['#', 'Loja', 'Vendedor', 'Vendas', 'Itens', 'Faturamento'],
          rows.map((row, index) => [
            String(index + 1),
            row.loja,
            row.vendedor,
            formatNumber(row.qtd_vendas),
            formatNumber(row.itens_vendidos),
            formatCurrency(row.faturamento)
          ])
        ),
        `_Período consultado: ${params.startDate} a ${params.endDate}. Fonte: public.vw_itens_vendidos._`
      ].join('\n\n');
    }
  },

  average_ticket_last_three_months: {
    name: 'average_ticket_last_three_months',
    version: 'v1',
    cacheTtlMs: 15 * 60 * 1000,
    cacheProfile: 'current_day',
    description: 'Ticket médio por loja nos últimos 3 meses.',
    buildParams() {
      const endDate = new Date();
      const startDate = new Date(endDate);
      startDate.setMonth(startDate.getMonth() - 3);
      return { startDate: toDateOnly(startDate), endDate: toDateOnly(endDate) };
    },
    sql: `
      SELECT
        loja,
        SUM(qtd_vendas)::int AS qtd_vendas,
        SUM(faturamento_liquido)::numeric AS faturamento_liquido,
        CASE WHEN SUM(qtd_vendas) = 0 THEN 0
             ELSE SUM(faturamento_liquido)::numeric / SUM(qtd_vendas)::numeric
        END AS ticket_medio
      FROM public.vw_faturamento_mensal
      WHERE mes::date >= $1::date
        AND mes::date <= $2::date
        AND loja NOT LIKE '%DESATIVADO%'
      GROUP BY loja
      ORDER BY ticket_medio DESC;
    `,
    values(params) {
      return [params.startDate, params.endDate];
    },
    format(rows, params) {
      if (!rows.length) return `Não encontrei ticket médio entre ${params.startDate} e ${params.endDate}.`;
      return [
        '### Ticket médio por loja — últimos 3 meses',
        markdownTable(
          ['Loja', 'Vendas', 'Faturamento líquido', 'Ticket médio'],
          rows.map(row => [
            row.loja,
            formatNumber(row.qtd_vendas),
            formatCurrency(row.faturamento_liquido),
            formatCurrency(row.ticket_medio)
          ])
        ),
        `_Período consultado: ${params.startDate} a ${params.endDate}. Fonte: public.vw_faturamento_mensal._`
      ].join('\n\n');
    }
  }
};

function classifyIntent(question) {
  const text = normalizeText(question);

  const monthYear = parseMonthYear(question, null, null);

  if (text.includes('faturamento') && text.includes('cada loja') && monthYear.hasMonth && monthYear.hasYear) {
    return { intent: 'monthly_revenue_by_store', template: templates.monthly_revenue_by_store };
  }

  if (text.includes('inadimplencia') && text.includes('recuperavel')) {
    return { intent: 'recoverable_delinquency_by_store', template: templates.recoverable_delinquency_by_store };
  }

  if (text.includes('compare') && text.includes('faturamento') && /\b20\d{2}\b.*\b20\d{2}\b/.test(text)) {
    return { intent: 'revenue_year_comparison_by_store', template: templates.revenue_year_comparison_by_store };
  }

  if ((text.includes('produtos mais vendidos') || text.includes('produto mais vendido')) && text.includes('ultimos 6 meses')) {
    return { intent: 'top_products_last_six_months', template: templates.top_products_last_six_months };
  }

  if ((text.includes('melhores vendedores') || text.includes('melhor vendedor')) && /\b20\d{2}\b/.test(text)) {
    return { intent: 'top_salespeople_by_year', template: templates.top_salespeople_by_year };
  }

  if (text.includes('ticket medio') && text.includes('cada loja') && text.includes('ultimos 3 meses')) {
    return { intent: 'average_ticket_last_three_months', template: templates.average_ticket_last_three_months };
  }

  return null;
}

function buildTemplateExecution(question) {
  const match = classifyIntent(question);
  if (!match) return null;

  const params = match.template.buildParams(question);
  return {
    intent: match.intent,
    templateName: match.template.name,
    templateVersion: match.template.version,
    cacheTtlMs: match.template.cacheTtlMs,
    cacheProfile: match.template.cacheProfile,
    description: match.template.description,
    sql: match.template.sql,
    values: match.template.values(params),
    params,
    format: rows => match.template.format(rows, params)
  };
}

module.exports = {
  buildTemplateExecution,
  classifyIntent,
  templates
};
