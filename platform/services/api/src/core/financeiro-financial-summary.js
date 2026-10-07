'use strict';

const FINANCIAL_SUMMARY_QUERY = 'financial_summary';

function normalizeRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row && typeof row === 'object' && !Array.isArray(row)).map((row) => ({
    category: String(row.category || 'uncategorized'),
    amount: Number.isFinite(Number(row.amount)) ? Number(row.amount) : 0
  }));
}

function buildFinancialSummary({ workspace_type, tenant_id, query_type, authorized_role, rows } = {}) {
  const base = {
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    write_allowed: false,
    action_allowed: false,
    sensitivity_level: 'high'
  };

  if (workspace_type !== 'grupo_erick' || tenant_id !== 'grupo_erick') {
    return { ...base, status: 'business_api_tenant_scope_blocked', blocked_reason: 'financial_summary_tenant_scope_blocked', review_candidate: null };
  }

  if (query_type !== FINANCIAL_SUMMARY_QUERY) {
    return { ...base, status: 'business_api_not_supported', blocked_reason: 'financial_summary_query_not_supported', review_candidate: null };
  }

  if (authorized_role !== true) {
    return { ...base, status: 'business_api_role_blocked', blocked_reason: 'financial_summary_authorized_role_required', review_candidate: null };
  }

  const safeRows = normalizeRows(rows);
  const byCategory = new Map();
  let total = 0;
  for (const row of safeRows) {
    total += row.amount;
    byCategory.set(row.category, (byCategory.get(row.category) || 0) + row.amount);
  }

  return {
    ...base,
    status: 'business_api_requires_human_review',
    safe_summary: 'Synthetic finance summary candidate requiring review.',
    human_review_required: true,
    review_candidate: {
      total_amount: Number(total.toFixed(2)),
      by_category: [...byCategory.entries()]
        .map(([category, amount]) => ({ category, amount: Number(amount.toFixed(2)) }))
        .sort((a, b) => a.category.localeCompare(b.category))
    }
  };
}

module.exports = { FINANCIAL_SUMMARY_QUERY, buildFinancialSummary };
