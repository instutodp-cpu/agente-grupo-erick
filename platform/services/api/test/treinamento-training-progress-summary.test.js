'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTrainingProgressSummary } = require('../src/core/treinamento-training-progress-summary');

const rows = [
  { user_id: 'u1', module_id: 'm1', progress_percent: 100 },
  { user_id: 'u1', module_id: 'm2', progress_percent: 50 },
  { user_id: 'u2', module_id: 'm1', progress_percent: 25 },
  { user_id: 'u2', module_id: 'm2', progress_percent: 125 }
];

test('training progress summary aggregates deterministic simulation rows without mutation', () => {
  const result = buildTrainingProgressSummary({ workspace_type: 'grupo_erick', tenant_id: 'grupo_erick', query_type: 'training_progress_summary', rows });
  assert.equal(result.status, 'business_api_mock_success');
  assert.equal(result.sensitivity_level, 'medium');
  assert.equal(result.executed, false);
  assert.equal(result.real_provider_called, false);
  assert.equal(result.write_allowed, false);
  assert.equal(result.action_allowed, false);
  assert.deepEqual(result.summary, {
    learner_count: 2,
    module_count: 2,
    progress_record_count: 4,
    completed_record_count: 2,
    average_progress_percent: 68.75
  });
});

test('training progress summary fails closed outside Grupo Erick tenant scope', () => {
  const result = buildTrainingProgressSummary({ workspace_type: 'external_client', tenant_id: 'client::demo', query_type: 'training_progress_summary', rows });
  assert.equal(result.status, 'business_api_tenant_scope_blocked');
  assert.equal(result.summary, null);
  assert.equal(result.executed, false);
});

test('training progress summary rejects enrollment or progress mutation queries', () => {
  const result = buildTrainingProgressSummary({ workspace_type: 'grupo_erick', tenant_id: 'grupo_erick', query_type: 'update_training_progress', rows });
  assert.equal(result.status, 'business_api_not_supported');
  assert.equal(result.summary, null);
  assert.equal(result.write_allowed, false);
  assert.equal(result.action_allowed, false);
});
