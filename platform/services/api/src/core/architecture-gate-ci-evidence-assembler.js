'use strict';

const { isPlainObject } = require('./read-only-adapter-contract');
const {
  buildArchitectureGateEvidenceReference,
  buildGateResult,
  HEX_SHA_PATTERN
} = require('./architecture-gate-evidence-reference');

function fail(code) { throw new Error('architecture_gate_ci_evidence_invalid::' + code); }
function requireString(value, code) { if (typeof value !== 'string' || value.length === 0) fail(code); return value; }

function assembleArchitectureGateEvidenceFromCi(input = {}) {
  if (!isPlainObject(input)) fail('input_must_be_object');
  const headSha = requireString(input.head_commit_sha, 'head_commit_sha_missing');
  const baseSha = requireString(input.base_commit_sha, 'base_commit_sha_missing');
  if (!HEX_SHA_PATTERN.test(headSha)) fail('head_commit_sha_invalid');
  if (!HEX_SHA_PATTERN.test(baseSha)) fail('base_commit_sha_invalid');
  if (input.commit_sha !== headSha) fail('commit_sha_head_mismatch');
  if (input.workflow_run_status !== 'COMPLETED') fail('workflow_run_not_completed');
  if (input.workflow_run_conclusion !== 'SUCCESS') fail('workflow_run_not_successful');
  if (!Array.isArray(input.gates) || input.gates.length === 0) fail('gates_missing');
  if (input.gates.some((gate) => !isPlainObject(gate) || gate.required !== true || gate.status !== 'PASSED')) {
    fail('required_gate_not_passed');
  }

  const gateResults = input.gates.map((gate, index) => buildGateResult({
    gate_result_id: requireString(gate.gate_result_id || 'ci-gate-' + index, 'gate_result_id_missing'),
    gate_id: requireString(gate.gate_id, 'gate_id_missing'),
    gate_version: requireString(gate.gate_version, 'gate_version_missing'),
    gate_status: gate.status,
    severity: gate.severity || 'CRITICAL',
    required: true,
    finding_code_references: []
  }));

  const evidence = buildArchitectureGateEvidenceReference({
    architecture_gate_evidence_reference_id: requireString(input.architecture_gate_evidence_reference_id, 'evidence_reference_id_missing'),
    repository_reference: {
      repository_id: requireString(input.repository_id, 'repository_id_missing'),
      repository_full_name: requireString(input.repository_full_name, 'repository_full_name_missing'),
      default_branch: requireString(input.default_branch, 'default_branch_missing')
    },
    commit_sha: input.commit_sha,
    base_commit_sha: baseSha,
    workflow_reference: {
      workflow_id: requireString(input.workflow_id, 'workflow_id_missing'),
      workflow_name: requireString(input.workflow_name, 'workflow_name_missing'),
      workflow_version: requireString(input.workflow_version, 'workflow_version_missing')
    },
    workflow_run_reference: {
      workflow_run_id: requireString(String(input.workflow_run_id || ''), 'workflow_run_id_missing'),
      workflow_run_attempt: input.workflow_run_attempt,
      workflow_run_status: input.workflow_run_status,
      workflow_run_conclusion: input.workflow_run_conclusion,
      head_commit_sha: headSha,
      base_commit_sha: baseSha,
      trigger_type: input.trigger_type
    },
    ruleset_id: requireString(input.ruleset_id, 'ruleset_id_missing'),
    ruleset_version: requireString(input.ruleset_version, 'ruleset_version_missing'),
    gate_results: gateResults,
    evidence_created_logical_sequence: input.evidence_created_logical_sequence,
    maximum_valid_sequences: input.maximum_valid_sequences,
    current_logical_sequence: input.current_logical_sequence
  });
  if (!evidence.evidence_validated || evidence.evidence_status !== 'ARCHITECTURE_GATES_PASSED_SIMULATION') {
    fail('evidence_not_validated');
  }
  return evidence;
}

module.exports = { assembleArchitectureGateEvidenceFromCi };
