'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const docPath = path.resolve(__dirname, '../../../docs/GOVERNANCE_CHECK_REPORT.md');
const fixturePath = path.resolve(__dirname, 'fixtures/hermes-governance-check-report.json');

const REQUIRED_CHECK_AREAS = [
  'permission_matrix',
  'golden_scenarios',
  'domain_onboarding',
  'capability_registry',
  'confirmation_gate',
  'execution_policy',
  'kill_switch',
  'mock_adapters',
  'adapter_result_contract',
  'adapter_audit_event_contract',
  'skill_candidate_registry',
  'memory_policy',
  'user_peer_memory_scopes',
  'second_brain_inbox',
  'quality_score_feedback_loop',
  'external_integration_provider_registry',
  'integration_security_boundary',
  'external_provider_permission_overlay',
  'external_provider_mock_adapter_harness',
  'external_provider_audit_cost_rate_limit',
  'tenant_workspace_isolation',
  'public_web_read_only_sandbox',
  'transcription_intake_sandbox',
  'internal_business_api_read_only',
  'forbidden_fields',
  'operator_runbook',
  'runtime_safety',
];

const REQUIRED_FINDING_TYPES = [
  'missing_contract_reference',
  'forbidden_field_detected',
  'unsafe_runtime_change',
  'missing_confirmation_gate',
  'missing_kill_switch_reference',
  'missing_permission_matrix_entry',
  'missing_golden_scenario',
  'missing_domain_onboarding',
  'adapter_not_mock_first',
  'executed_true_detected',
  'storage_added_without_contract',
  'external_service_added_without_contract',
  'sensitive_log_risk',
  'docs_regression',
  'fixture_regression',
  'test_gap',
  'duplicate_doc_section',
];

const REQUIRED_FORBIDDEN_FIELDS = [
  'token',
  'secret',
  'env',
  'headers',
  'cookies',
  'credentials',
  'payload',
  'rawPayload',
  'rawMessage',
  'userMessage',
  'requiredAdapters',
  'authorization',
  'password',
  'stackTrace',
];

test('governance check report document and fixture exist', () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
});

test('governance check report document describes the contract', () => {
  const doc = fs.readFileSync(docPath, 'utf8');

  for (const phrase of [
    'Governance Check Report',
    'Permission Matrix',
    'Golden Scenarios',
    'Domain Onboarding',
    'Capability Registry',
    'Confirmation Gate',
    'Execution Policy',
    'Kill Switch',
    'Mock Adapters',
    'Adapter Result Contract',
    'Adapter Audit Event Contract',
    'Skill Candidate Registry',
    'Memory Policy',
    'User / Peer Memory Scopes',
    'Second Brain Inbox',
    'forbidden fields',
    'executed:false',
    'LGPD',
  ]) {
    assert.match(doc, new RegExp(phrase, 'i'));
  }

  assert.match(doc, /Quality Score \+ Feedback Loop/i);
});

test('governance check report fixture is safe and contractually complete', () => {
  const report = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  const areaIds = new Set(report.check_areas.map((area) => area.id));
  const findingIds = new Set(report.finding_types.map((finding) => finding.id));

  for (const areaId of REQUIRED_CHECK_AREAS) {
    assert.equal(areaIds.has(areaId), true, areaId);
  }

  for (const area of report.check_areas) {
    assert.equal(area.can_trigger_real_execution, false);
    assert.equal(area.can_block_release, true);
  }

  for (const status of ['pass', 'warning', 'blocked', 'not_applicable', 'needs_human_review']) {
    assert.ok(report.allowed_statuses.includes(status), status);
  }

  for (const severity of ['low', 'medium', 'high', 'critical']) {
    assert.ok(report.severity_levels.includes(severity), severity);
  }

  for (const findingId of REQUIRED_FINDING_TYPES) {
    assert.equal(findingIds.has(findingId), true, findingId);
  }

  for (const finding of report.finding_types) {
    assert.equal(finding.can_trigger_real_execution, false);
    assert.ok(['low', 'medium', 'high', 'critical'].includes(finding.severity));
  }

  assert.equal(
    report.finding_types.find((finding) => finding.id === 'executed_true_detected').severity,
    'critical',
  );

  assert.ok(
    ['critical', 'high'].includes(
      report.finding_types.find((finding) => finding.id === 'forbidden_field_detected').severity,
    ),
  );

  assert.equal(report.default_rules.executed, false);
  assert.equal(report.default_rules.can_trigger_real_execution, false);
  assert.equal(report.default_rules.scanner_implemented, false);
  assert.equal(report.default_rules.ci_gate_implemented, false);
  assert.equal(report.default_rules.storage_implemented, false);
  assert.equal(report.default_rules.external_services_added, false);
  assert.equal(report.default_rules.runtime_changed, false);
  assert.equal(report.default_rules.mock_first, true);
  assert.equal(report.default_rules.human_review_required_for_blocked, true);

  for (const field of REQUIRED_FORBIDDEN_FIELDS) {
    assert.ok(report.forbidden_fields.includes(field), field);
  }
});
