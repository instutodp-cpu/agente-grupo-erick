'use strict';

const PURCHASE_SUMMARY_QUERY = 'purchase_summary';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter(isPlainObject).map((row) => ({
    supplier_id: String(row.supplier_id || 'unknown'),
    supplier_name: String(row.supplier_name || 'Unknown supplier'),
    store_id: String(row.store_id || 'unknown'),
    total_value: Number.isFinite(Number(row.total_value)) ? Number(row.total_value) : 0,
    order_count: Number.isInteger(Number(row.order_count)) ? Number(row.order_count) : 0
  }));
}

function buildPurchaseSummary({ workspace_type, tenant_id, query_type, rows } = {}) {
  if (workspace_type !== 'grupo_erick' || tenant_id !== 'grupo_erick') {
    return {
      status: 'business_api_tenant_scope_blocked',
      blocked_reason: 'purchase_summary_tenant_scope_blocked',
      simulated: true,
      executed: false,
      real_provider_called: false,
      can_trigger_real_execution: false,
      write_allowed: false,
      action_allowed: false,
      purchase_summary: null
    };
  }

  if (query_type !== PURCHASE_SUMMARY_QUERY) {
    return {
      status: 'business_api_not_supported',
      blocked_reason: 'purchase_summary_query_not_supported',
      simulated: true,
      executed: false,
      real_provider_called: false,
      can_trigger_real_execution: false,
      write_allowed: false,
      action_allowed: false,
      purchase_summary: null
    };
  }

  const safeRows = normalizeRows(rows);
  const suppliers = new Map();
  let totalValue = 0;
  let orderCount = 0;

  for (const row of safeRows) {
    totalValue += row.total_value;
    orderCount += row.order_count;
    const current = suppliers.get(row.supplier_id) || {
      supplier_id: row.supplier_id,
      supplier_name: row.supplier_name,
      total_value: 0,
      order_count: 0
    };
    current.total_value += row.total_value;
    current.order_count += row.order_count;
    suppliers.set(row.supplier_id, current);
  }

  const bySupplier = [...suppliers.values()]
    .map((item) => ({
      ...item,
      total_value: Number(item.total_value.toFixed(2))
    }))
    .sort((a, b) => b.total_value - a.total_value || a.supplier_id.localeCompare(b.supplier_id));

  return {
    status: 'business_api_mock_success',
    safe_summary: 'Synthetic purchase summary generated from tenant-scoped simulation rows.',
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    write_allowed: false,
    action_allowed: false,
    purchase_summary: {
      supplier_count: bySupplier.length,
      order_count: orderCount,
      total_value: Number(totalValue.toFixed(2)),
      by_supplier: bySupplier
    }
  };
}

module.exports = {
  PURCHASE_SUMMARY_QUERY,
  buildPurchaseSummary
};
