'use strict';

const TRAINING_PROGRESS_SUMMARY_QUERY = 'training_progress_summary';

function normalizeRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === 'object' && !Array.isArray(row))
    .map((row) => ({
      user_id: String(row.user_id || 'unknown'),
      module_id: String(row.module_id || 'unknown'),
      progress_percent: Math.max(0, Math.min(100, Number.isFinite(Number(row.progress_percent)) ? Number(row.progress_percent) : 0))
    }));
}

function buildTrainingProgressSummary({ workspace_type, tenant_id, query_type, rows } = {}) {
  const base = {
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    write_allowed: false,
    action_allowed: false,
    sensitivity_level: 'medium'
  };

  if (workspace_type !== 'grupo_erick' || tenant_id !== 'grupo_erick') {
    return { ...base, status: 'business_api_tenant_scope_blocked', summary: null };
  }
  if (query_type !== TRAINING_PROGRESS_SUMMARY_QUERY) {
    return { ...base, status: 'business_api_not_supported', summary: null };
  }

  const safeRows = normalizeRows(rows);
  const users = new Set(safeRows.map((row) => row.user_id));
  const modules = new Set(safeRows.map((row) => row.module_id));
  const completed = safeRows.filter((row) => row.progress_percent === 100).length;
  const average = safeRows.length
    ? safeRows.reduce((sum, row) => sum + row.progress_percent, 0) / safeRows.length
    : 0;

  return {
    ...base,
    status: 'business_api_mock_success',
    safe_summary: 'Synthetic training progress summary candidate.',
    summary: {
      learner_count: users.size,
      module_count: modules.size,
      progress_record_count: safeRows.length,
      completed_record_count: completed,
      average_progress_percent: Number(average.toFixed(2))
    }
  };
}

module.exports = { TRAINING_PROGRESS_SUMMARY_QUERY, buildTrainingProgressSummary };
