'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { validateAgentSimulationContext } = require('./agent-context-contract');
const { validateExecutionGatewayPolicy } = require('./execution-gateway-policy');
const { validateExecutionGatewayPackageReference } = require('./execution-gateway-package-reference');
const { validateExecutionPlanContract } = require('./execution-plan-contract');
const { validateExecutionPlanResult } = require('./execution-plan-result');
const { validateExecutionAuthorizationDecision } = require('./execution-authorization-decision');
const { validateAuthorizationProvenanceReference } = require('./execution-authorization-provenance-reference');
const { validateAuthorizationScopeReference } = require('./execution-authorization-scope-reference');
const { validateExecutionRegistrySnapshotReference } = require('./execution-registry-snapshot-reference');
const { validateOrchestratorStageManifestReference } = require('./orchestrator-stage-manifest-reference');
const { validateExecutionPlanDependencyGraphReference } = require('./execution-plan-dependency-graph-reference');
const { validateExecutionReferenceBindingLedger } = require('./execution-reference-binding-ledger');
const { validateValidationLedger } = require('./validation-ledger');
const { validateArchitectureGateEvidenceReference } = require('./architecture-gate-evidence-reference');
const { validateExecutionGatewayFreshnessReference } = require('./execution-gateway-freshness-reference');
const { validateExecutionGatewayReplayReference } = require('./execution-gateway-replay-reference');

const EXECUTION_GATEWAY_REQUEST_VALIDATOR_VERSION = 'execution_gateway_request_validator_v1';

const EXECUTION_GATEWAY_REQUEST_FIELDS = Object.freeze([
  'gateway_request_id', 'gateway_request_version', 'gateway_policy', 'gateway_package_reference',
  'execution_plan_reference', 'execution_plan_result_reference', 'authorization_decision_reference',
  'authorization_provenance_reference', 'authorization_scope_reference', 'registry_snapshot_reference',
  'stage_manifest_reference', 'dependency_graph_reference', 'binding_ledger_reference', 'validation_ledger_reference',
  'architecture_gate_evidence_reference', 'freshness_reference', 'replay_reference', 'correlation_id',
  'causation_id', 'trace_id', 'logical_sequence', 'expected_gateway_registry_version', 'simulation_context',
  'validator_version'
]);

// Every nested reference this request carries, and the real validator each one is checked
// against -- never a parallel, weaker re-implementation of any of these contracts.
const NESTED_REFERENCE_VALIDATORS = Object.freeze([
  ['gateway_policy', validateExecutionGatewayPolicy],
  ['gateway_package_reference', validateExecutionGatewayPackageReference],
  ['execution_plan_reference', validateExecutionPlanContract],
  ['execution_plan_result_reference', validateExecutionPlanResult],
  ['authorization_decision_reference', validateExecutionAuthorizationDecision],
  ['authorization_provenance_reference', validateAuthorizationProvenanceReference],
  ['authorization_scope_reference', validateAuthorizationScopeReference],
  ['registry_snapshot_reference', validateExecutionRegistrySnapshotReference],
  ['stage_manifest_reference', validateOrchestratorStageManifestReference],
  ['dependency_graph_reference', validateExecutionPlanDependencyGraphReference],
  ['binding_ledger_reference', validateExecutionReferenceBindingLedger],
  ['validation_ledger_reference', validateValidationLedger],
  ['architecture_gate_evidence_reference', validateArchitectureGateEvidenceReference],
  ['freshness_reference', validateExecutionGatewayFreshnessReference],
  ['replay_reference', validateExecutionGatewayReplayReference]
]);

function validateExecutionGatewayRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['execution_gateway_request_must_be_object'] };
  exactFields(request, EXECUTION_GATEWAY_REQUEST_FIELDS, 'execution_gateway_request', errors);
  for (const field of ['gateway_request_id', 'correlation_id', 'causation_id', 'trace_id', 'validator_version']) {
    if (!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(request.gateway_request_version) || request.gateway_request_version < 1) errors.push('gateway_request_version_invalid');
  if (!Number.isInteger(request.logical_sequence) || request.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (!Number.isInteger(request.expected_gateway_registry_version) || request.expected_gateway_registry_version < 1) {
    errors.push('expected_gateway_registry_version_invalid');
  }

  errors.push(...validateAgentSimulationContext(request.simulation_context).errors.map((e) => `simulation_context_${e}`));

  for (const [field, validator] of NESTED_REFERENCE_VALIDATORS) {
    const result = validator(request[field]);
    if (!result.valid) errors.push(`${field}_invalid::${result.errors.join('|')}`);
  }

  if (request.validator_version !== EXECUTION_GATEWAY_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(request);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

// Never mutates or re-derives any nested reference -- every one of them must already be a fully
// built, self-valid object before being handed to this constructor. This request is a pure
// aggregation boundary; `simulation_context` and every reference travel through unchanged.
function buildExecutionGatewayRequest(input = {}) {
  const request = {
    gateway_request_id: input.gateway_request_id,
    gateway_request_version: Number.isInteger(input.gateway_request_version) ? input.gateway_request_version : 1,
    gateway_policy: input.gateway_policy,
    gateway_package_reference: input.gateway_package_reference,
    execution_plan_reference: input.execution_plan_reference,
    execution_plan_result_reference: input.execution_plan_result_reference,
    authorization_decision_reference: input.authorization_decision_reference,
    authorization_provenance_reference: input.authorization_provenance_reference,
    authorization_scope_reference: input.authorization_scope_reference,
    registry_snapshot_reference: input.registry_snapshot_reference,
    stage_manifest_reference: input.stage_manifest_reference,
    dependency_graph_reference: input.dependency_graph_reference,
    binding_ledger_reference: input.binding_ledger_reference,
    validation_ledger_reference: input.validation_ledger_reference,
    architecture_gate_evidence_reference: input.architecture_gate_evidence_reference,
    freshness_reference: input.freshness_reference,
    replay_reference: input.replay_reference,
    correlation_id: input.correlation_id,
    causation_id: input.causation_id,
    trace_id: input.trace_id,
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    expected_gateway_registry_version: Number.isInteger(input.expected_gateway_registry_version) ? input.expected_gateway_registry_version : 1,
    simulation_context: input.simulation_context,
    validator_version: EXECUTION_GATEWAY_REQUEST_VALIDATOR_VERSION
  };

  const validation = validateExecutionGatewayRequest(request);
  if (!validation.valid) {
    throw new Error(`execution_gateway_request_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(request);
}

module.exports = {
  EXECUTION_GATEWAY_REQUEST_FIELDS,
  EXECUTION_GATEWAY_REQUEST_VALIDATOR_VERSION,
  NESTED_REFERENCE_VALIDATORS,
  buildExecutionGatewayRequest,
  validateExecutionGatewayRequest
};
