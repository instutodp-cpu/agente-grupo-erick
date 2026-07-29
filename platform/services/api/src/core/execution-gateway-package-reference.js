'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// A compact, self-contained summary of a fully-prepared Execution Plan package -- every id and
// every fingerprint the Gateway needs to cross-check, without embedding any of the referenced
// objects' own full content. "package_reference_validated=true somente após validação integral"
// is a two-layer guarantee: this contract's own builder can only verify its own internal
// consistency (required status literals, every id/fingerprint present) -- the real cross-check
// against the actual Plan/Result/ledgers this reference summarizes is execution-gateway-
// boundary.js's own job (recomputing the package fingerprint/digest and comparing).
const EXECUTION_GATEWAY_PACKAGE_REFERENCE_VALIDATOR_VERSION = 'execution_gateway_package_reference_validator_v1';

const REQUIRED_EXECUTION_PLAN_STATUS = 'EXECUTION_PLAN_PREPARED_SIMULATION';
const REQUIRED_EXECUTION_PLAN_RESULT_STATUS = 'EXECUTION_PLAN_PREPARED_SIMULATION';

const EXECUTION_GATEWAY_PACKAGE_REFERENCE_FIELDS = Object.freeze([
  'gateway_package_reference_id', 'gateway_package_reference_version', 'execution_plan_id',
  'execution_plan_request_id', 'execution_plan_result_id', 'authorization_decision_id',
  'authorization_provenance_reference_id', 'authorization_scope_reference_id', 'registry_snapshot_reference_id',
  'stage_manifest_reference_id', 'dependency_graph_reference_id', 'binding_ledger_id', 'validation_ledger_id',
  'architecture_gate_evidence_reference_id', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id',
  'agent_id', 'actor_id', 'execution_plan_status', 'execution_plan_result_status', 'execution_plan_fingerprint',
  'execution_plan_result_fingerprint', 'authorization_fingerprint', 'authorization_provenance_fingerprint',
  'authorization_scope_fingerprint', 'registry_snapshot_fingerprint', 'stage_manifest_fingerprint',
  'dependency_graph_fingerprint', 'binding_ledger_fingerprint', 'validation_ledger_fingerprint',
  'architecture_gate_evidence_fingerprint', 'package_digest', 'package_reference_validated',
  'package_reference_applied', 'executable', 'execution_authorized', 'execution_started', 'simulation',
  'production_blocked', 'validator_version'
]);

const ID_FIELDS = Object.freeze([
  'execution_plan_id', 'execution_plan_request_id', 'execution_plan_result_id', 'authorization_decision_id',
  'authorization_provenance_reference_id', 'authorization_scope_reference_id', 'registry_snapshot_reference_id',
  'stage_manifest_reference_id', 'dependency_graph_reference_id', 'binding_ledger_id', 'validation_ledger_id',
  'architecture_gate_evidence_reference_id'
]);

const FINGERPRINT_FIELDS = Object.freeze([
  'execution_plan_fingerprint', 'execution_plan_result_fingerprint', 'authorization_fingerprint',
  'authorization_provenance_fingerprint', 'authorization_scope_fingerprint', 'registry_snapshot_fingerprint',
  'stage_manifest_fingerprint', 'dependency_graph_fingerprint', 'binding_ledger_fingerprint',
  'validation_ledger_fingerprint', 'architecture_gate_evidence_fingerprint'
]);

const EXECUTION_GATEWAY_PACKAGE_REFERENCE_SAFE_FLAGS = Object.freeze({
  package_reference_applied: false,
  executable: false,
  execution_authorized: false,
  execution_started: false,
  simulation: true,
  production_blocked: true
});

function validateExecutionGatewayPackageReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['execution_gateway_package_reference_must_be_object'] };
  exactFields(reference, EXECUTION_GATEWAY_PACKAGE_REFERENCE_FIELDS, 'execution_gateway_package_reference', errors);
  for (const field of [
    'gateway_package_reference_id', ...ID_FIELDS, 'tenant_id', 'organization_id', 'project_id',
    'session_reference_id', 'agent_id', 'actor_id', ...FINGERPRINT_FIELDS, 'package_digest', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.gateway_package_reference_version) || reference.gateway_package_reference_version < 1) {
    errors.push('gateway_package_reference_version_invalid');
  }
  if (reference.execution_plan_status !== REQUIRED_EXECUTION_PLAN_STATUS) errors.push('execution_plan_status_invalid');
  if (reference.execution_plan_result_status !== REQUIRED_EXECUTION_PLAN_RESULT_STATUS) errors.push('execution_plan_result_status_invalid');

  const structurallyComplete = [...ID_FIELDS, ...FINGERPRINT_FIELDS].every((field) => isNonEmptyString(reference[field]))
    && isNonEmptyString(reference.package_digest)
    && reference.execution_plan_status === REQUIRED_EXECUTION_PLAN_STATUS
    && reference.execution_plan_result_status === REQUIRED_EXECUTION_PLAN_RESULT_STATUS;
  if (typeof reference.package_reference_validated !== 'boolean') errors.push('package_reference_validated_must_be_boolean');
  if (reference.package_reference_validated !== structurallyComplete) errors.push('package_reference_validated_does_not_match_structural_completeness');

  for (const [field, expected] of Object.entries(EXECUTION_GATEWAY_PACKAGE_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== EXECUTION_GATEWAY_PACKAGE_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildExecutionGatewayPackageReference(input = {}) {
  const executionPlanStatus = input.execution_plan_status;
  const executionPlanResultStatus = input.execution_plan_result_status;
  const structurallyComplete = [...ID_FIELDS, ...FINGERPRINT_FIELDS].every((field) => isNonEmptyString(input[field]))
    && isNonEmptyString(input.package_digest)
    && executionPlanStatus === REQUIRED_EXECUTION_PLAN_STATUS
    && executionPlanResultStatus === REQUIRED_EXECUTION_PLAN_RESULT_STATUS;

  const reference = {
    gateway_package_reference_id: input.gateway_package_reference_id,
    gateway_package_reference_version: Number.isInteger(input.gateway_package_reference_version) ? input.gateway_package_reference_version : 1,
    execution_plan_id: input.execution_plan_id,
    execution_plan_request_id: input.execution_plan_request_id,
    execution_plan_result_id: input.execution_plan_result_id,
    authorization_decision_id: input.authorization_decision_id,
    authorization_provenance_reference_id: input.authorization_provenance_reference_id,
    authorization_scope_reference_id: input.authorization_scope_reference_id,
    registry_snapshot_reference_id: input.registry_snapshot_reference_id,
    stage_manifest_reference_id: input.stage_manifest_reference_id,
    dependency_graph_reference_id: input.dependency_graph_reference_id,
    binding_ledger_id: input.binding_ledger_id,
    validation_ledger_id: input.validation_ledger_id,
    architecture_gate_evidence_reference_id: input.architecture_gate_evidence_reference_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    agent_id: input.agent_id,
    actor_id: input.actor_id,
    execution_plan_status: executionPlanStatus,
    execution_plan_result_status: executionPlanResultStatus,
    execution_plan_fingerprint: input.execution_plan_fingerprint,
    execution_plan_result_fingerprint: input.execution_plan_result_fingerprint,
    authorization_fingerprint: input.authorization_fingerprint,
    authorization_provenance_fingerprint: input.authorization_provenance_fingerprint,
    authorization_scope_fingerprint: input.authorization_scope_fingerprint,
    registry_snapshot_fingerprint: input.registry_snapshot_fingerprint,
    stage_manifest_fingerprint: input.stage_manifest_fingerprint,
    dependency_graph_fingerprint: input.dependency_graph_fingerprint,
    binding_ledger_fingerprint: input.binding_ledger_fingerprint,
    validation_ledger_fingerprint: input.validation_ledger_fingerprint,
    architecture_gate_evidence_fingerprint: input.architecture_gate_evidence_fingerprint,
    package_digest: input.package_digest,
    package_reference_validated: structurallyComplete,
    ...EXECUTION_GATEWAY_PACKAGE_REFERENCE_SAFE_FLAGS,
    validator_version: EXECUTION_GATEWAY_PACKAGE_REFERENCE_VALIDATOR_VERSION
  };

  const validation = validateExecutionGatewayPackageReference(reference);
  if (!validation.valid) {
    throw new Error(`execution_gateway_package_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  EXECUTION_GATEWAY_PACKAGE_REFERENCE_FIELDS,
  EXECUTION_GATEWAY_PACKAGE_REFERENCE_SAFE_FLAGS,
  EXECUTION_GATEWAY_PACKAGE_REFERENCE_VALIDATOR_VERSION,
  FINGERPRINT_FIELDS,
  ID_FIELDS,
  REQUIRED_EXECUTION_PLAN_RESULT_STATUS,
  REQUIRED_EXECUTION_PLAN_STATUS,
  buildExecutionGatewayPackageReference,
  validateExecutionGatewayPackageReference
};
