'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');

// pr102: transports a declarative evidence that a specific set of architecture gates was executed
// externally (in CI) for a specific commit and ruleset -- never executes a gate, never queries
// GitHub, never proves cryptographic identity of the emitter. See docs "Limitação obrigatória".
const ARCHITECTURE_GATE_EVIDENCE_REFERENCE_VALIDATOR_VERSION = 'architecture_gate_evidence_reference_validator_v1';

const HEX_SHA_PATTERN = /^[0-9a-f]{40}$/;

const REPOSITORY_REFERENCE_FIELDS = Object.freeze([
  'repository_id', 'repository_full_name', 'default_branch', 'repository_fingerprint', 'validator_version'
]);
const WORKFLOW_REFERENCE_FIELDS = Object.freeze([
  'workflow_id', 'workflow_name', 'workflow_version', 'workflow_fingerprint', 'validator_version'
]);
const WORKFLOW_RUN_REFERENCE_FIELDS = Object.freeze([
  'workflow_run_id', 'workflow_run_attempt', 'workflow_run_status', 'workflow_run_conclusion',
  'head_commit_sha', 'base_commit_sha', 'trigger_type', 'workflow_run_fingerprint', 'validator_version'
]);
const GATE_RESULT_FIELDS = Object.freeze([
  'gate_result_id', 'gate_id', 'gate_version', 'gate_status', 'severity', 'required', 'finding_count',
  'finding_code_references', 'evaluated', 'gate_result_fingerprint', 'validator_version'
]);

const ARCHITECTURE_GATE_EVIDENCE_REFERENCE_FIELDS = Object.freeze([
  'architecture_gate_evidence_reference_id', 'architecture_gate_evidence_reference_version', 'repository_reference',
  'commit_sha', 'base_commit_sha', 'workflow_reference', 'workflow_run_reference', 'ruleset_id', 'ruleset_version',
  'gate_result_ids', 'gate_results', 'gate_count', 'passed_gate_count', 'failed_gate_count', 'warning_gate_count',
  'all_required_gates_passed', 'evidence_status', 'evidence_created_logical_sequence', 'maximum_valid_sequences',
  'current_logical_sequence', 'expired_logically', 'evidence_fingerprint', 'evidence_digest', 'evidence_validated',
  'evidence_applied', 'simulation', 'production_blocked', 'validator_version'
]);

const WORKFLOW_RUN_STATUSES = Object.freeze(['COMPLETED', 'IN_PROGRESS', 'QUEUED']);
const WORKFLOW_RUN_CONCLUSIONS = Object.freeze(['SUCCESS', 'FAILURE', 'CANCELLED', 'TIMED_OUT', 'SKIPPED']);
const TRIGGER_TYPES = Object.freeze(['PUSH_REFERENCE', 'PULL_REQUEST_REFERENCE', 'MANUAL_DISPATCH_REFERENCE', 'SCHEDULE_REFERENCE']);
const GATE_SEVERITIES = Object.freeze(['INFO', 'WARNING', 'ERROR', 'CRITICAL']);
const GATE_STATUSES = Object.freeze(['PASSED', 'FAILED', 'WARNING', 'NOT_EVALUATED']);
const EVIDENCE_STATUSES = Object.freeze([
  'ARCHITECTURE_GATES_PASSED_SIMULATION', 'ARCHITECTURE_GATES_FAILED', 'ARCHITECTURE_GATES_INCOMPLETE',
  'ARCHITECTURE_GATES_EXPIRED_LOGICAL', 'ARCHITECTURE_GATES_CONFLICTED', 'ARCHITECTURE_GATES_VALIDATION_FAILED'
]);

const ARCHITECTURE_GATE_EVIDENCE_REFERENCE_SAFE_FLAGS = Object.freeze({
  evidence_applied: false,
  simulation: true,
  production_blocked: true
});

const MAX_GATE_RESULTS = 100;
const MAX_FINDING_CODE_REFERENCES = 200;

function isSanitizedList(list, maxItems) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString) && new Set(list).size === list.length;
}

function computeGateResultFingerprint(result) {
  const { gate_result_fingerprint, ...rest } = result;
  return stablePayload(rest);
}

function validateGateResult(result) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['gate_result_must_be_object'] };
  exactFields(result, GATE_RESULT_FIELDS, 'gate_result', errors);
  for (const field of ['gate_result_id', 'gate_id', 'gate_version', 'gate_result_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(result[field])) errors.push(`${field}_invalid`);
  }
  if (!GATE_STATUSES.includes(result.gate_status)) errors.push('gate_status_invalid');
  if (!GATE_SEVERITIES.includes(result.severity)) errors.push('severity_invalid');
  if (typeof result.required !== 'boolean') errors.push('required_must_be_boolean');
  if (!Number.isInteger(result.finding_count) || result.finding_count < 0) errors.push('finding_count_invalid');
  if (!isSanitizedList(result.finding_code_references, MAX_FINDING_CODE_REFERENCES)) errors.push('finding_code_references_invalid');
  if (result.finding_code_references.length !== result.finding_count) errors.push('finding_count_does_not_match_finding_code_references');
  if (typeof result.evaluated !== 'boolean') errors.push('evaluated_must_be_boolean');
  if (result.evaluated !== (result.gate_status !== 'NOT_EVALUATED')) errors.push('evaluated_does_not_match_gate_status');
  try {
    if (computeGateResultFingerprint(result) !== result.gate_result_fingerprint) errors.push('gate_result_fingerprint_mismatch');
  } catch (error) {
    errors.push('gate_result_fingerprint_mismatch');
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildGateResult(input = {}) {
  const gateStatus = GATE_STATUSES.includes(input.gate_status) ? input.gate_status : 'NOT_EVALUATED';
  const result = {
    gate_result_id: input.gate_result_id,
    gate_id: input.gate_id,
    gate_version: input.gate_version,
    gate_status: gateStatus,
    severity: GATE_SEVERITIES.includes(input.severity) ? input.severity : 'ERROR',
    required: input.required === true,
    finding_count: Array.isArray(input.finding_code_references) ? input.finding_code_references.length : 0,
    finding_code_references: Array.isArray(input.finding_code_references) ? uniqueSorted(input.finding_code_references) : [],
    evaluated: gateStatus !== 'NOT_EVALUATED',
    gate_result_fingerprint: 'pending',
    validator_version: 'gate_result_validator_v1'
  };
  result.gate_result_fingerprint = computeGateResultFingerprint({ ...result, gate_result_fingerprint: undefined });
  const validation = validateGateResult(result);
  if (!validation.valid) throw new Error(`gate_result_construction_invalid::${JSON.stringify(validation.errors)}`);
  return cloneFrozen(result);
}

function computeRepositoryReferenceFingerprint(reference) {
  const { repository_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function computeWorkflowReferenceFingerprint(reference) {
  const { workflow_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function computeWorkflowRunReferenceFingerprint(reference) {
  const { workflow_run_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRepositoryReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['repository_reference_must_be_object'] };
  exactFields(reference, REPOSITORY_REFERENCE_FIELDS, 'repository_reference', errors);
  for (const field of REPOSITORY_REFERENCE_FIELDS) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  try {
    if (computeRepositoryReferenceFingerprint(reference) !== reference.repository_fingerprint) errors.push('repository_fingerprint_mismatch');
  } catch (error) {
    errors.push('repository_fingerprint_mismatch');
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateWorkflowReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['workflow_reference_must_be_object'] };
  exactFields(reference, WORKFLOW_REFERENCE_FIELDS, 'workflow_reference', errors);
  for (const field of WORKFLOW_REFERENCE_FIELDS) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  try {
    if (computeWorkflowReferenceFingerprint(reference) !== reference.workflow_fingerprint) errors.push('workflow_fingerprint_mismatch');
  } catch (error) {
    errors.push('workflow_fingerprint_mismatch');
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateWorkflowRunReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['workflow_run_reference_must_be_object'] };
  exactFields(reference, WORKFLOW_RUN_REFERENCE_FIELDS, 'workflow_run_reference', errors);
  for (const field of ['workflow_run_id', 'validator_version']) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.workflow_run_attempt) || reference.workflow_run_attempt < 1) errors.push('workflow_run_attempt_invalid');
  if (!WORKFLOW_RUN_STATUSES.includes(reference.workflow_run_status)) errors.push('workflow_run_status_invalid');
  if (!WORKFLOW_RUN_CONCLUSIONS.includes(reference.workflow_run_conclusion)) errors.push('workflow_run_conclusion_invalid');
  if (!HEX_SHA_PATTERN.test(reference.head_commit_sha || '')) errors.push('head_commit_sha_invalid');
  if (!HEX_SHA_PATTERN.test(reference.base_commit_sha || '')) errors.push('base_commit_sha_invalid');
  if (!TRIGGER_TYPES.includes(reference.trigger_type)) errors.push('trigger_type_invalid');
  if (!isNonEmptyString(reference.workflow_run_fingerprint)) errors.push('workflow_run_fingerprint_invalid');
  try {
    if (computeWorkflowRunReferenceFingerprint(reference) !== reference.workflow_run_fingerprint) errors.push('workflow_run_fingerprint_mismatch');
  } catch (error) {
    errors.push('workflow_run_fingerprint_mismatch');
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function deriveEvidenceStatus({ expiredLogically, workflowRun, headCommitMatches, requiredGateIncomplete, failedGateCount, allRequiredGatesPassed }) {
  if (expiredLogically) return 'ARCHITECTURE_GATES_EXPIRED_LOGICAL';
  if (workflowRun.workflow_run_status !== 'COMPLETED') return 'ARCHITECTURE_GATES_INCOMPLETE';
  if (requiredGateIncomplete) return 'ARCHITECTURE_GATES_INCOMPLETE';
  if (workflowRun.workflow_run_conclusion !== 'SUCCESS') return 'ARCHITECTURE_GATES_FAILED';
  if (!headCommitMatches) return 'ARCHITECTURE_GATES_CONFLICTED';
  if (failedGateCount > 0 || !allRequiredGatesPassed) return 'ARCHITECTURE_GATES_FAILED';
  return 'ARCHITECTURE_GATES_PASSED_SIMULATION';
}

function computeEvidenceFingerprint(evidence) {
  const { evidence_fingerprint, evidence_digest, ...rest } = evidence;
  return stablePayload(rest);
}

function computeEvidenceDigest(evidence) {
  const { evidence_digest, ...rest } = evidence;
  return computeCanonicalContentDigest(rest);
}

function validateArchitectureGateEvidenceReference(evidence) {
  const errors = [];
  if (!isPlainObject(evidence)) return { valid: false, errors: ['architecture_gate_evidence_reference_must_be_object'] };
  exactFields(evidence, ARCHITECTURE_GATE_EVIDENCE_REFERENCE_FIELDS, 'architecture_gate_evidence_reference', errors);
  for (const field of [
    'architecture_gate_evidence_reference_id', 'ruleset_id', 'ruleset_version', 'evidence_fingerprint',
    'evidence_digest', 'validator_version'
  ]) {
    if (!isNonEmptyString(evidence[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(evidence.architecture_gate_evidence_reference_version) || evidence.architecture_gate_evidence_reference_version < 1) {
    errors.push('architecture_gate_evidence_reference_version_invalid');
  }
  if (!HEX_SHA_PATTERN.test(evidence.commit_sha || '')) errors.push('commit_sha_invalid');
  if (!HEX_SHA_PATTERN.test(evidence.base_commit_sha || '')) errors.push('base_commit_sha_invalid');

  errors.push(...validateRepositoryReference(evidence.repository_reference).errors.map((e) => `repository_reference_${e}`));
  errors.push(...validateWorkflowReference(evidence.workflow_reference).errors.map((e) => `workflow_reference_${e}`));
  errors.push(...validateWorkflowRunReference(evidence.workflow_run_reference).errors.map((e) => `workflow_run_reference_${e}`));

  const gateResultsValid = Array.isArray(evidence.gate_results) && evidence.gate_results.length <= MAX_GATE_RESULTS && evidence.gate_results.length > 0;
  if (!gateResultsValid) {
    errors.push('gate_results_invalid');
  } else {
    evidence.gate_results.forEach((result, index) => {
      const validation = validateGateResult(result);
      if (!validation.valid) errors.push(`gate_results[${index}]_invalid::${validation.errors.join('|')}`);
    });
    // canonically ordered by gate_id.
    for (let i = 1; i < evidence.gate_results.length; i += 1) {
      if (evidence.gate_results[i].gate_id < evidence.gate_results[i - 1].gate_id) {
        errors.push('gate_results_not_canonically_ordered');
        break;
      }
    }
    const gateIds = evidence.gate_results.map((r) => r.gate_id);
    if (new Set(gateIds).size !== gateIds.length) errors.push('duplicate_gate_id');

    if (Array.isArray(evidence.gate_result_ids)) {
      const idsMatch = evidence.gate_result_ids.length === evidence.gate_results.length
        && evidence.gate_result_ids.every((id, index) => id === evidence.gate_results[index].gate_result_id);
      if (!idsMatch) errors.push('gate_result_ids_does_not_match_gate_results');
      if (new Set(evidence.gate_result_ids).size !== evidence.gate_result_ids.length) errors.push('gate_result_ids_not_unique');
    } else {
      errors.push('gate_result_ids_invalid');
    }

    const expectedCounts = {
      gate_count: evidence.gate_results.length,
      passed_gate_count: evidence.gate_results.filter((r) => r.gate_status === 'PASSED').length,
      failed_gate_count: evidence.gate_results.filter((r) => r.gate_status === 'FAILED').length,
      warning_gate_count: evidence.gate_results.filter((r) => r.gate_status === 'WARNING').length
    };
    for (const [field, expected] of Object.entries(expectedCounts)) {
      if (evidence[field] !== expected) errors.push(`${field}_does_not_match_gate_results`);
    }
    const expectedAllRequiredPassed = evidence.gate_results.every((r) => r.required !== true || r.gate_status === 'PASSED');
    if (evidence.all_required_gates_passed !== expectedAllRequiredPassed) errors.push('all_required_gates_passed_does_not_match_gate_results');
  }

  if (!Number.isInteger(evidence.evidence_created_logical_sequence) || evidence.evidence_created_logical_sequence < 0) {
    errors.push('evidence_created_logical_sequence_invalid');
  }
  if (!Number.isInteger(evidence.maximum_valid_sequences) || evidence.maximum_valid_sequences < 0) errors.push('maximum_valid_sequences_invalid');
  if (!Number.isInteger(evidence.current_logical_sequence) || evidence.current_logical_sequence < evidence.evidence_created_logical_sequence) {
    errors.push('current_logical_sequence_invalid');
  }
  const expectedExpired = Number.isInteger(evidence.current_logical_sequence) && Number.isInteger(evidence.evidence_created_logical_sequence)
    ? (evidence.current_logical_sequence - evidence.evidence_created_logical_sequence) > evidence.maximum_valid_sequences
    : true;
  if (evidence.expired_logically !== expectedExpired) errors.push('expired_logically_does_not_match_sequences');

  if (!EVIDENCE_STATUSES.includes(evidence.evidence_status)) errors.push('evidence_status_invalid');
  if (typeof evidence.evidence_validated !== 'boolean') errors.push('evidence_validated_must_be_boolean');
  const expectedValidated = evidence.evidence_status === 'ARCHITECTURE_GATES_PASSED_SIMULATION';
  if (evidence.evidence_validated !== expectedValidated) errors.push('evidence_validated_does_not_match_evidence_status');

  for (const [field, expected] of Object.entries(ARCHITECTURE_GATE_EVIDENCE_REFERENCE_SAFE_FLAGS)) {
    if (evidence[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (evidence.validator_version !== ARCHITECTURE_GATE_EVIDENCE_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(evidence);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeEvidenceFingerprint(evidence) !== evidence.evidence_fingerprint) errors.push('evidence_fingerprint_mismatch');
  } catch (error) {
    errors.push('evidence_fingerprint_mismatch');
  }
  try {
    if (computeEvidenceDigest(evidence) !== evidence.evidence_digest) errors.push('evidence_digest_mismatch');
  } catch (error) {
    errors.push('evidence_digest_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(evidence));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

// Never executes a gate, never queries GitHub -- only structurally validates and canonicalizes a
// content-only evidence bundle an external CI run already produced.
function buildRepositoryReference(input) {
  if (!isPlainObject(input)) return input;
  const reference = { ...input, repository_fingerprint: 'pending', validator_version: 'repository_reference_validator_v1' };
  reference.repository_fingerprint = computeRepositoryReferenceFingerprint(reference);
  return reference;
}

function buildWorkflowReference(input) {
  if (!isPlainObject(input)) return input;
  const reference = { ...input, workflow_fingerprint: 'pending', validator_version: 'workflow_reference_validator_v1' };
  reference.workflow_fingerprint = computeWorkflowReferenceFingerprint(reference);
  return reference;
}

function buildWorkflowRunReference(input) {
  if (!isPlainObject(input)) return input;
  const reference = { ...input, workflow_run_fingerprint: 'pending', validator_version: 'workflow_run_reference_validator_v1' };
  reference.workflow_run_fingerprint = computeWorkflowRunReferenceFingerprint(reference);
  return reference;
}

function buildArchitectureGateEvidenceReference(input = {}) {
  const repositoryReference = buildRepositoryReference(input.repository_reference);
  const workflowReference = buildWorkflowReference(input.workflow_reference);
  const workflowRunReference = buildWorkflowRunReference(input.workflow_run_reference);
  const gateResults = Array.isArray(input.gate_results)
    ? [...input.gate_results].sort((a, b) => (a.gate_id < b.gate_id ? -1 : a.gate_id > b.gate_id ? 1 : 0))
    : [];

  const expiredLogically = Number.isInteger(input.current_logical_sequence) && Number.isInteger(input.evidence_created_logical_sequence)
    && Number.isInteger(input.maximum_valid_sequences)
    ? (input.current_logical_sequence - input.evidence_created_logical_sequence) > input.maximum_valid_sequences
    : true;
  const headCommitMatches = isPlainObject(workflowRunReference) && workflowRunReference.head_commit_sha === input.commit_sha;
  const requiredGateIncomplete = gateResults.some((r) => r.required === true && r.gate_status === 'NOT_EVALUATED');
  const failedGateCount = gateResults.filter((r) => r.gate_status === 'FAILED').length;
  const allRequiredGatesPassed = gateResults.every((r) => r.required !== true || r.gate_status === 'PASSED');

  const evidenceStatus = deriveEvidenceStatus({
    expiredLogically, workflowRun: isPlainObject(workflowRunReference) ? workflowRunReference : {}, headCommitMatches,
    requiredGateIncomplete, failedGateCount, allRequiredGatesPassed
  });

  const evidence = {
    architecture_gate_evidence_reference_id: input.architecture_gate_evidence_reference_id,
    architecture_gate_evidence_reference_version: Number.isInteger(input.architecture_gate_evidence_reference_version)
      ? input.architecture_gate_evidence_reference_version : 1,
    repository_reference: repositoryReference,
    commit_sha: input.commit_sha,
    base_commit_sha: input.base_commit_sha,
    workflow_reference: workflowReference,
    workflow_run_reference: workflowRunReference,
    ruleset_id: input.ruleset_id,
    ruleset_version: input.ruleset_version,
    gate_result_ids: gateResults.map((r) => r.gate_result_id),
    gate_results: gateResults,
    gate_count: gateResults.length,
    passed_gate_count: gateResults.filter((r) => r.gate_status === 'PASSED').length,
    failed_gate_count: failedGateCount,
    warning_gate_count: gateResults.filter((r) => r.gate_status === 'WARNING').length,
    all_required_gates_passed: allRequiredGatesPassed,
    evidence_status: evidenceStatus,
    evidence_created_logical_sequence: Number.isInteger(input.evidence_created_logical_sequence) ? input.evidence_created_logical_sequence : 0,
    maximum_valid_sequences: Number.isInteger(input.maximum_valid_sequences) ? input.maximum_valid_sequences : 0,
    current_logical_sequence: Number.isInteger(input.current_logical_sequence) ? input.current_logical_sequence : 0,
    expired_logically: expiredLogically,
    evidence_fingerprint: 'pending',
    evidence_digest: 'pending',
    evidence_validated: evidenceStatus === 'ARCHITECTURE_GATES_PASSED_SIMULATION',
    evidence_applied: false,
    simulation: true,
    production_blocked: true,
    validator_version: ARCHITECTURE_GATE_EVIDENCE_REFERENCE_VALIDATOR_VERSION
  };
  evidence.evidence_fingerprint = computeEvidenceFingerprint(evidence);
  evidence.evidence_digest = computeEvidenceDigest(evidence);

  const validation = validateArchitectureGateEvidenceReference(evidence);
  if (!validation.valid) {
    throw new Error(`architecture_gate_evidence_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(evidence);
}

module.exports = {
  ARCHITECTURE_GATE_EVIDENCE_REFERENCE_FIELDS,
  ARCHITECTURE_GATE_EVIDENCE_REFERENCE_SAFE_FLAGS,
  ARCHITECTURE_GATE_EVIDENCE_REFERENCE_VALIDATOR_VERSION,
  EVIDENCE_STATUSES,
  GATE_RESULT_FIELDS,
  GATE_SEVERITIES,
  GATE_STATUSES,
  HEX_SHA_PATTERN,
  REPOSITORY_REFERENCE_FIELDS,
  TRIGGER_TYPES,
  WORKFLOW_REFERENCE_FIELDS,
  WORKFLOW_RUN_CONCLUSIONS,
  WORKFLOW_RUN_REFERENCE_FIELDS,
  WORKFLOW_RUN_STATUSES,
  buildArchitectureGateEvidenceReference,
  buildGateResult,
  buildRepositoryReference,
  buildWorkflowReference,
  buildWorkflowRunReference,
  computeEvidenceDigest,
  computeEvidenceFingerprint,
  computeGateResultFingerprint,
  computeRepositoryReferenceFingerprint,
  computeWorkflowReferenceFingerprint,
  computeWorkflowRunReferenceFingerprint,
  validateArchitectureGateEvidenceReference,
  validateGateResult,
  validateRepositoryReference,
  validateWorkflowReference,
  validateWorkflowRunReference
};
