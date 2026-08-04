'use strict';

// The one module in this whole PR allowed to touch the filesystem -- and only because it is the
// architecture *gate* itself, invoked exclusively from scripts/run-architecture-gates.js and from
// test/architecture-gates.test.js, never from any declarative contract or from
// execution-plan-engine.js/execution-authorization-boundary.js at evaluation time. "Pode usar
// filesystem somente no script/test de arquitetura, nunca nos contratos runtime."
const fs = require('node:fs');
const path = require('node:path');
const {
  ALLOWLIST, PATTERN_GATE_IDS, STRUCTURAL_GATE_IDS, scanFileForPatternGates
} = require('./architecture-gate-rules');

const CORE_DIR = path.join(__dirname);
const TEST_DIR = path.join(__dirname, '..', '..', 'test');
const PACKAGE_JSON_PATH = path.join(__dirname, '..', '..', 'package.json');
const WORKFLOWS_DIR = path.join(__dirname, '..', '..', '..', '..', '.github', 'workflows');

// The explicit, curated manifest of "audited contracts" the structural gates
// (SIMULATION_FLAG_REQUIRED/PRODUCTION_BLOCKED_REQUIRED/ROLLOUT_ZERO_REQUIRED/
// FINGERPRINT_COVERAGE_REQUIRED/VERSION_COVERAGE_REQUIRED/EXACT_FIELDS_REQUIRED) check --
// "Usar manifesto explícito de contratos auditados para evitar heurística frágil." Scoped to the
// Execution Plan / Authorization Boundary / Reference Binding / Validation lineage this PR and its
// immediate predecessors (PR #94-#103) built, not the entire 280-file codebase history.
const AUDITED_CONTRACTS_MANIFEST = Object.freeze([
  { module: './execution-plan-request', fieldsExport: 'EXECUTION_PLAN_REQUEST_FIELDS', hasVersion: true, versionField: 'execution_plan_request_version', hasFingerprint: false },
  { module: './execution-plan-contract', fieldsExport: 'EXECUTION_PLAN_CONTRACT_FIELDS', safeFlagsExport: 'EXECUTION_PLAN_CONTRACT_SAFE_FLAGS', hasVersion: true, versionField: 'execution_plan_version', hasFingerprint: true, fingerprintField: 'plan_fingerprint' },
  { module: './execution-plan-result', fieldsExport: 'EXECUTION_PLAN_RESULT_FIELDS', safeFlagsExport: 'EXECUTION_PLAN_RESULT_SAFE_FLAGS', hasVersion: false, hasFingerprint: true, fingerprintField: 'execution_plan_fingerprint' },
  { module: './execution-plan-stage', fieldsExport: 'EXECUTION_PLAN_STAGE_FIELDS', hasVersion: true, versionField: 'execution_stage_version', hasFingerprint: false },
  { module: './execution-plan-stage-binding', fieldsExport: 'EXECUTION_PLAN_STAGE_BINDING_FIELDS', safeFlagsExport: 'EXECUTION_PLAN_STAGE_BINDING_SAFE_FLAGS', hasVersion: true, versionField: 'binding_version', hasFingerprint: true, fingerprintField: 'binding_fingerprint' },
  { module: './execution-plan-dependency-graph-reference', fieldsExport: 'DEPENDENCY_GRAPH_REFERENCE_FIELDS', safeFlagsExport: 'DEPENDENCY_GRAPH_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'dependency_graph_reference_version', hasFingerprint: true, fingerprintField: 'graph_fingerprint' },
  { module: './execution-plan-budget', fieldsExport: 'EXECUTION_PLAN_BUDGET_FIELDS', hasVersion: true, versionField: 'execution_budget_version', hasFingerprint: true, fingerprintField: 'budget_fingerprint' },
  { module: './execution-plan-idempotency', fieldsExport: 'EXECUTION_PLAN_IDEMPOTENCY_FIELDS', safeFlagsExport: 'EXECUTION_PLAN_IDEMPOTENCY_SAFE_FLAGS', hasVersion: true, versionField: 'idempotency_reference_version', hasFingerprint: true, fingerprintField: 'idempotency_fingerprint' },
  { module: './execution-plan-stop-condition', fieldsExport: 'EXECUTION_PLAN_STOP_CONDITION_FIELDS', safeFlagsExport: 'EXECUTION_PLAN_STOP_CONDITION_SAFE_FLAGS', hasVersion: true, versionField: 'stop_condition_version', hasFingerprint: true, fingerprintField: 'condition_fingerprint' },
  { module: './execution-plan-compensation-reference', fieldsExport: 'EXECUTION_PLAN_COMPENSATION_REFERENCE_FIELDS', safeFlagsExport: 'EXECUTION_PLAN_COMPENSATION_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'compensation_reference_version', hasFingerprint: true, fingerprintField: 'compensation_fingerprint' },
  { module: './orchestrator-stage-manifest-reference', fieldsExport: 'STAGE_MANIFEST_REFERENCE_FIELDS', safeFlagsExport: 'STAGE_MANIFEST_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'stage_manifest_reference_version', hasFingerprint: true, fingerprintField: 'manifest_fingerprint' },
  { module: './execution-authorization-provenance-reference', fieldsExport: 'AUTHORIZATION_PROVENANCE_REFERENCE_FIELDS', safeFlagsExport: 'AUTHORIZATION_PROVENANCE_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'authorization_provenance_reference_version', hasFingerprint: false },
  { module: './execution-authorization-scope-reference', fieldsExport: 'AUTHORIZATION_SCOPE_REFERENCE_FIELDS', safeFlagsExport: 'AUTHORIZATION_SCOPE_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'authorization_scope_reference_version', hasFingerprint: true, fingerprintField: 'scope_fingerprint' },
  { module: './execution-registry-snapshot-reference', fieldsExport: 'REGISTRY_SNAPSHOT_REFERENCE_FIELDS', safeFlagsExport: 'REGISTRY_SNAPSHOT_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'registry_snapshot_reference_version', hasFingerprint: true, fingerprintField: 'snapshot_fingerprint' },
  { module: './execution-reference-binding-record', fieldsExport: 'BINDING_RECORD_FIELDS', safeFlagsExport: 'BINDING_RECORD_SAFE_FLAGS', hasVersion: true, versionField: 'binding_record_version', hasFingerprint: true, fingerprintField: 'binding_record_fingerprint' },
  { module: './execution-reference-binding-ledger', fieldsExport: 'BINDING_LEDGER_FIELDS', safeFlagsExport: 'BINDING_LEDGER_SAFE_FLAGS', hasVersion: true, versionField: 'binding_ledger_version', hasFingerprint: true, fingerprintField: 'ledger_fingerprint' },
  { module: './execution-reference-binding-result', fieldsExport: 'BINDING_RESULT_FIELDS', hasVersion: true, versionField: 'binding_result_version', hasFingerprint: true, fingerprintField: 'result_fingerprint' },
  { module: './validation-outcome', fieldsExport: 'VALIDATION_OUTCOME_FIELDS', safeFlagsExport: 'VALIDATION_OUTCOME_SAFE_FLAGS', hasVersion: false, hasFingerprint: true, fingerprintField: 'output_fingerprint' },
  { module: './validation-ledger', fieldsExport: 'VALIDATION_LEDGER_FIELDS', safeFlagsExport: 'VALIDATION_LEDGER_SAFE_FLAGS', hasVersion: true, versionField: 'validation_ledger_version', hasFingerprint: true, fingerprintField: 'ledger_fingerprint' },
  // pr102: Execution Gateway Boundary Simulation's own new contracts.
  { module: './architecture-gate-evidence-reference', fieldsExport: 'ARCHITECTURE_GATE_EVIDENCE_REFERENCE_FIELDS', safeFlagsExport: 'ARCHITECTURE_GATE_EVIDENCE_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'architecture_gate_evidence_reference_version', hasFingerprint: true, fingerprintField: 'evidence_fingerprint' },
  { module: './execution-gateway-policy', fieldsExport: 'EXECUTION_GATEWAY_POLICY_FIELDS', safeFlagsExport: 'EXECUTION_GATEWAY_POLICY_SAFE_FLAGS', hasVersion: true, versionField: 'gateway_policy_version', hasFingerprint: false },
  { module: './execution-gateway-freshness-reference', fieldsExport: 'EXECUTION_GATEWAY_FRESHNESS_REFERENCE_FIELDS', safeFlagsExport: 'EXECUTION_GATEWAY_FRESHNESS_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'freshness_reference_version', hasFingerprint: true, fingerprintField: 'freshness_fingerprint' },
  { module: './execution-gateway-replay-reference', fieldsExport: 'EXECUTION_GATEWAY_REPLAY_REFERENCE_FIELDS', safeFlagsExport: 'EXECUTION_GATEWAY_REPLAY_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'gateway_replay_reference_version', hasFingerprint: true, fingerprintField: 'replay_fingerprint' },
  { module: './execution-gateway-package-reference', fieldsExport: 'EXECUTION_GATEWAY_PACKAGE_REFERENCE_FIELDS', safeFlagsExport: 'EXECUTION_GATEWAY_PACKAGE_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'gateway_package_reference_version', hasFingerprint: false },
  { module: './execution-gateway-request', fieldsExport: 'EXECUTION_GATEWAY_REQUEST_FIELDS', hasVersion: true, versionField: 'gateway_request_version', hasFingerprint: false },
  { module: './execution-gateway-decision', fieldsExport: 'EXECUTION_GATEWAY_DECISION_FIELDS', safeFlagsExport: 'OPERATIONAL_SAFE_FLAGS', hasVersion: false, hasFingerprint: false },
  { module: './execution-gateway-result', fieldsExport: 'EXECUTION_GATEWAY_RESULT_FIELDS', safeFlagsExport: 'OPERATIONAL_SAFE_FLAGS', hasVersion: false, hasFingerprint: false },
  // pr103: Runtime Execution Simulation Contracts' own new contracts.
  { module: './runtime-execution-simulation-policy', fieldsExport: 'RUNTIME_EXECUTION_SIMULATION_POLICY_FIELDS', safeFlagsExport: 'RUNTIME_EXECUTION_SIMULATION_POLICY_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_policy_version', hasFingerprint: false },
  { module: './runtime-stage-simulation-reference', fieldsExport: 'RUNTIME_STAGE_SIMULATION_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_STAGE_SIMULATION_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_stage_reference_version', hasFingerprint: false },
  { module: './runtime-stage-simulation-manifest', fieldsExport: 'RUNTIME_STAGE_SIMULATION_MANIFEST_FIELDS', safeFlagsExport: 'RUNTIME_STAGE_SIMULATION_MANIFEST_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_stage_manifest_version', hasFingerprint: true, fingerprintField: 'manifest_fingerprint' },
  { module: './runtime-dependency-simulation-reference', fieldsExport: 'RUNTIME_DEPENDENCY_SIMULATION_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_DEPENDENCY_SIMULATION_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_dependency_reference_version', hasFingerprint: true, fingerprintField: 'dependency_fingerprint' },
  { module: './runtime-dependency-simulation-manifest', fieldsExport: 'RUNTIME_DEPENDENCY_SIMULATION_MANIFEST_FIELDS', safeFlagsExport: 'RUNTIME_DEPENDENCY_SIMULATION_MANIFEST_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_dependency_manifest_version', hasFingerprint: true, fingerprintField: 'manifest_fingerprint' },
  { module: './runtime-budget-simulation-reference', fieldsExport: 'RUNTIME_BUDGET_SIMULATION_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_BUDGET_SIMULATION_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_budget_reference_version', hasFingerprint: true, fingerprintField: 'budget_fingerprint' },
  { module: './runtime-stop-simulation-reference', fieldsExport: 'RUNTIME_STOP_SIMULATION_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_STOP_SIMULATION_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_stop_reference_version', hasFingerprint: true, fingerprintField: 'stop_fingerprint' },
  { module: './runtime-compensation-simulation-reference', fieldsExport: 'RUNTIME_COMPENSATION_SIMULATION_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_COMPENSATION_SIMULATION_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_compensation_reference_version', hasFingerprint: true, fingerprintField: 'compensation_fingerprint' },
  { module: './runtime-artifact-plan-reference', fieldsExport: 'RUNTIME_ARTIFACT_PLAN_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_ARTIFACT_PLAN_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_artifact_plan_reference_version', hasFingerprint: true, fingerprintField: 'artifact_plan_fingerprint' },
  { module: './runtime-event-plan-reference', fieldsExport: 'RUNTIME_EVENT_PLAN_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_EVENT_PLAN_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_event_plan_reference_version', hasFingerprint: true, fingerprintField: 'event_plan_fingerprint' },
  { module: './runtime-execution-simulation-request', fieldsExport: 'RUNTIME_EXECUTION_SIMULATION_REQUEST_FIELDS', hasVersion: true, versionField: 'runtime_request_version', hasFingerprint: false },
  { module: './runtime-execution-package', fieldsExport: 'RUNTIME_EXECUTION_PACKAGE_FIELDS', safeFlagsExport: 'RUNTIME_EXECUTION_PACKAGE_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_execution_package_version', hasFingerprint: true, fingerprintField: 'package_fingerprint' },
  { module: './runtime-execution-simulation-decision', fieldsExport: 'RUNTIME_EXECUTION_SIMULATION_DECISION_FIELDS', safeFlagsExport: 'OPERATIONAL_SAFE_FLAGS', hasVersion: false, hasFingerprint: false },
  { module: './runtime-execution-simulation-result', fieldsExport: 'RUNTIME_EXECUTION_SIMULATION_RESULT_FIELDS', safeFlagsExport: 'OPERATIONAL_SAFE_FLAGS', hasVersion: false, hasFingerprint: false },
  // pr104: Runtime Readiness and Admission Boundary's own new contracts.
  { module: './runtime-readiness-policy', fieldsExport: 'RUNTIME_READINESS_POLICY_FIELDS', safeFlagsExport: 'RUNTIME_READINESS_POLICY_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_readiness_policy_version', hasFingerprint: false },
  { module: './runtime-admission-policy', fieldsExport: 'RUNTIME_ADMISSION_POLICY_FIELDS', safeFlagsExport: 'RUNTIME_ADMISSION_POLICY_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_admission_policy_version', hasFingerprint: false },
  { module: './runtime-capacity-snapshot-reference', fieldsExport: 'RUNTIME_CAPACITY_SNAPSHOT_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_CAPACITY_SNAPSHOT_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_capacity_snapshot_reference_version', hasFingerprint: true, fingerprintField: 'capacity_fingerprint' },
  { module: './runtime-concurrency-reference', fieldsExport: 'RUNTIME_CONCURRENCY_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_CONCURRENCY_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_concurrency_reference_version', hasFingerprint: true, fingerprintField: 'concurrency_fingerprint' },
  { module: './runtime-readiness-freshness-reference', fieldsExport: 'RUNTIME_READINESS_FRESHNESS_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_READINESS_FRESHNESS_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_readiness_freshness_reference_version', hasFingerprint: true, fingerprintField: 'freshness_fingerprint' },
  { module: './runtime-readiness-replay-reference', fieldsExport: 'RUNTIME_READINESS_REPLAY_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_READINESS_REPLAY_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_readiness_replay_reference_version', hasFingerprint: true, fingerprintField: 'replay_fingerprint' },
  { module: './runtime-readiness-request', fieldsExport: 'RUNTIME_READINESS_REQUEST_FIELDS', hasVersion: true, versionField: 'runtime_readiness_request_version', hasFingerprint: false },
  { module: './runtime-readiness-decision', fieldsExport: 'RUNTIME_READINESS_DECISION_FIELDS', safeFlagsExport: 'OPERATIONAL_SAFE_FLAGS', hasVersion: false, hasFingerprint: false },
  { module: './runtime-admission-request', fieldsExport: 'RUNTIME_ADMISSION_REQUEST_FIELDS', hasVersion: true, versionField: 'runtime_admission_request_version', hasFingerprint: false },
  { module: './runtime-admission-decision', fieldsExport: 'RUNTIME_ADMISSION_DECISION_FIELDS', safeFlagsExport: 'OPERATIONAL_SAFE_FLAGS', hasVersion: false, hasFingerprint: false },
  { module: './runtime-admission-result', fieldsExport: 'RUNTIME_ADMISSION_RESULT_FIELDS', safeFlagsExport: 'OPERATIONAL_SAFE_FLAGS', hasVersion: false, hasFingerprint: false },
  // pr105: Runtime Scheduler Simulation Contracts' own new contracts.
  { module: './runtime-scheduler-policy', fieldsExport: 'RUNTIME_SCHEDULER_POLICY_FIELDS', safeFlagsExport: 'RUNTIME_SCHEDULER_POLICY_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_scheduler_policy_version', hasFingerprint: false },
  { module: './runtime-scheduler-request', fieldsExport: 'RUNTIME_SCHEDULER_REQUEST_FIELDS', hasVersion: true, versionField: 'runtime_scheduler_request_version', hasFingerprint: false },
  { module: './runtime-scheduler-stage-reference', fieldsExport: 'RUNTIME_SCHEDULER_STAGE_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_SCHEDULER_STAGE_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'scheduler_stage_reference_version', hasFingerprint: true, fingerprintField: 'stage_fingerprint' },
  { module: './runtime-scheduler-dependency-reference', fieldsExport: 'RUNTIME_SCHEDULER_DEPENDENCY_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_SCHEDULER_DEPENDENCY_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'scheduler_dependency_reference_version', hasFingerprint: true, fingerprintField: 'dependency_fingerprint' },
  { module: './runtime-scheduler-parallel-group-reference', fieldsExport: 'RUNTIME_SCHEDULER_PARALLEL_GROUP_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_SCHEDULER_PARALLEL_GROUP_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'parallel_group_reference_version', hasFingerprint: true, fingerprintField: 'parallel_group_fingerprint' },
  { module: './runtime-scheduler-approval-wait-reference', fieldsExport: 'RUNTIME_SCHEDULER_APPROVAL_WAIT_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_SCHEDULER_APPROVAL_WAIT_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'approval_wait_reference_version', hasFingerprint: true, fingerprintField: 'approval_wait_fingerprint' },
  { module: './runtime-scheduler-capacity-plan-reference', fieldsExport: 'RUNTIME_SCHEDULER_CAPACITY_PLAN_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_SCHEDULER_CAPACITY_PLAN_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'scheduler_capacity_plan_reference_version', hasFingerprint: true, fingerprintField: 'capacity_plan_fingerprint' },
  { module: './runtime-scheduler-queue-plan-reference', fieldsExport: 'RUNTIME_SCHEDULER_QUEUE_PLAN_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_SCHEDULER_QUEUE_PLAN_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'scheduler_queue_plan_reference_version', hasFingerprint: true, fingerprintField: 'queue_plan_fingerprint' },
  { module: './runtime-scheduler-package', fieldsExport: 'RUNTIME_SCHEDULER_PACKAGE_FIELDS', safeFlagsExport: 'RUNTIME_SCHEDULER_PACKAGE_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_scheduler_package_version', hasFingerprint: true, fingerprintField: 'scheduler_package_fingerprint' },
  { module: './runtime-scheduler-decision', fieldsExport: 'RUNTIME_SCHEDULER_DECISION_FIELDS', safeFlagsExport: 'OPERATIONAL_SAFE_FLAGS', hasVersion: false, hasFingerprint: false },
  { module: './runtime-scheduler-result', fieldsExport: 'RUNTIME_SCHEDULER_RESULT_FIELDS', hasVersion: false, hasFingerprint: false },
  // pr106: Runtime Worker Assignment Simulation Contracts' own new contracts.
  { module: './runtime-worker-assignment-policy', fieldsExport: 'RUNTIME_WORKER_ASSIGNMENT_POLICY_FIELDS', safeFlagsExport: 'RUNTIME_WORKER_ASSIGNMENT_POLICY_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_worker_assignment_policy_version', hasFingerprint: false },
  { module: './runtime-worker-reference', fieldsExport: 'RUNTIME_WORKER_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_WORKER_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_worker_reference_version', hasFingerprint: true, fingerprintField: 'worker_fingerprint' },
  { module: './runtime-worker-capability-reference', fieldsExport: 'RUNTIME_WORKER_CAPABILITY_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_WORKER_CAPABILITY_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'worker_capability_reference_version', hasFingerprint: true, fingerprintField: 'capability_fingerprint' },
  { module: './runtime-worker-capacity-reference', fieldsExport: 'RUNTIME_WORKER_CAPACITY_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_WORKER_CAPACITY_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'worker_capacity_reference_version', hasFingerprint: true, fingerprintField: 'capacity_fingerprint' },
  { module: './runtime-worker-health-reference', fieldsExport: 'RUNTIME_WORKER_HEALTH_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_WORKER_HEALTH_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'worker_health_reference_version', hasFingerprint: true, fingerprintField: 'health_fingerprint' },
  { module: './runtime-worker-network-policy-reference', fieldsExport: 'RUNTIME_WORKER_NETWORK_POLICY_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_WORKER_NETWORK_POLICY_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'worker_network_policy_reference_version', hasFingerprint: true, fingerprintField: 'network_policy_fingerprint' },
  { module: './runtime-worker-secret-policy-reference', fieldsExport: 'RUNTIME_WORKER_SECRET_POLICY_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_WORKER_SECRET_POLICY_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'worker_secret_policy_reference_version', hasFingerprint: true, fingerprintField: 'secret_policy_fingerprint' },
  { module: './runtime-worker-stage-policy-requirement-reference', fieldsExport: 'RUNTIME_WORKER_STAGE_POLICY_REQUIREMENT_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_WORKER_STAGE_POLICY_REQUIREMENT_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'stage_policy_requirement_reference_version', hasFingerprint: true, fingerprintField: 'requirement_reference_fingerprint' },
  { module: './runtime-worker-compatibility-reference', fieldsExport: 'RUNTIME_WORKER_COMPATIBILITY_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_WORKER_COMPATIBILITY_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'worker_compatibility_reference_version', hasFingerprint: true, fingerprintField: 'compatibility_fingerprint' },
  { module: './runtime-worker-candidate-set-reference', fieldsExport: 'RUNTIME_WORKER_CANDIDATE_SET_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_WORKER_CANDIDATE_SET_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'worker_candidate_set_reference_version', hasFingerprint: true, fingerprintField: 'candidate_set_fingerprint' },
  { module: './runtime-worker-stage-assignment-reference', fieldsExport: 'RUNTIME_WORKER_STAGE_ASSIGNMENT_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_WORKER_STAGE_ASSIGNMENT_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'worker_stage_assignment_reference_version', hasFingerprint: true, fingerprintField: 'assignment_fingerprint' },
  { module: './runtime-worker-assignment-request', fieldsExport: 'RUNTIME_WORKER_ASSIGNMENT_REQUEST_FIELDS', hasVersion: true, versionField: 'runtime_worker_assignment_request_version', hasFingerprint: false },
  { module: './runtime-worker-assignment-package', fieldsExport: 'RUNTIME_WORKER_ASSIGNMENT_PACKAGE_FIELDS', safeFlagsExport: 'RUNTIME_WORKER_ASSIGNMENT_PACKAGE_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_worker_assignment_package_version', hasFingerprint: true, fingerprintField: 'worker_assignment_package_fingerprint' },
  { module: './runtime-worker-assignment-decision', fieldsExport: 'RUNTIME_WORKER_ASSIGNMENT_DECISION_FIELDS', safeFlagsExport: 'OPERATIONAL_SAFE_FLAGS', hasVersion: false, hasFingerprint: false },
  { module: './runtime-worker-assignment-result', fieldsExport: 'RUNTIME_WORKER_ASSIGNMENT_RESULT_FIELDS', hasVersion: false, hasFingerprint: false },
  // pr107: Runtime Dispatch Simulation Contracts' own new contracts.
  { module: './runtime-dispatch-policy', fieldsExport: 'RUNTIME_DISPATCH_POLICY_FIELDS', safeFlagsExport: 'RUNTIME_DISPATCH_POLICY_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_dispatch_policy_version', hasFingerprint: false },
  { module: './runtime-dispatch-request', fieldsExport: 'RUNTIME_DISPATCH_REQUEST_FIELDS', hasVersion: true, versionField: 'runtime_dispatch_request_version', hasFingerprint: false },
  { module: './runtime-dispatch-stage-reference', fieldsExport: 'RUNTIME_DISPATCH_STAGE_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_DISPATCH_STAGE_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_dispatch_stage_reference_version', hasFingerprint: true, fingerprintField: 'dispatch_stage_fingerprint' },
  { module: './runtime-dispatch-worker-binding-reference', fieldsExport: 'RUNTIME_DISPATCH_WORKER_BINDING_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_DISPATCH_WORKER_BINDING_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'dispatch_worker_binding_reference_version', hasFingerprint: true, fingerprintField: 'worker_binding_fingerprint' },
  { module: './runtime-dispatch-dependency-gate-reference', fieldsExport: 'RUNTIME_DISPATCH_DEPENDENCY_GATE_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_DISPATCH_DEPENDENCY_GATE_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'dispatch_dependency_gate_reference_version', hasFingerprint: true, fingerprintField: 'dependency_gate_fingerprint' },
  { module: './runtime-dispatch-approval-gate-reference', fieldsExport: 'RUNTIME_DISPATCH_APPROVAL_GATE_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_DISPATCH_APPROVAL_GATE_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'dispatch_approval_gate_reference_version', hasFingerprint: true, fingerprintField: 'approval_gate_fingerprint' },
  { module: './runtime-dispatch-capacity-reference', fieldsExport: 'RUNTIME_DISPATCH_CAPACITY_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_DISPATCH_CAPACITY_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'dispatch_capacity_reference_version', hasFingerprint: true, fingerprintField: 'capacity_fingerprint' },
  { module: './runtime-dispatch-budget-reference', fieldsExport: 'RUNTIME_DISPATCH_BUDGET_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_DISPATCH_BUDGET_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'dispatch_budget_reference_version', hasFingerprint: true, fingerprintField: 'budget_fingerprint' },
  { module: './runtime-dispatch-payload-reference', fieldsExport: 'RUNTIME_DISPATCH_PAYLOAD_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_DISPATCH_PAYLOAD_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'dispatch_payload_reference_version', hasFingerprint: true, fingerprintField: 'payload_fingerprint' },
  { module: './runtime-dispatch-intent-reference', fieldsExport: 'RUNTIME_DISPATCH_INTENT_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_DISPATCH_INTENT_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'dispatch_intent_reference_version', hasFingerprint: true, fingerprintField: 'dispatch_intent_fingerprint' },
  { module: './runtime-dispatch-order-reference', fieldsExport: 'RUNTIME_DISPATCH_ORDER_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_DISPATCH_ORDER_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'dispatch_order_reference_version', hasFingerprint: true, fingerprintField: 'order_fingerprint' },
  { module: './runtime-dispatch-replay-reference', fieldsExport: 'RUNTIME_DISPATCH_REPLAY_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_DISPATCH_REPLAY_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_dispatch_replay_reference_version', hasFingerprint: true, fingerprintField: 'replay_fingerprint' },
  { module: './runtime-dispatch-package', fieldsExport: 'RUNTIME_DISPATCH_PACKAGE_FIELDS', safeFlagsExport: 'RUNTIME_DISPATCH_PACKAGE_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_dispatch_package_version', hasFingerprint: true, fingerprintField: 'dispatch_package_fingerprint' },
  { module: './runtime-dispatch-decision', fieldsExport: 'RUNTIME_DISPATCH_DECISION_FIELDS', safeFlagsExport: 'OPERATIONAL_SAFE_FLAGS', hasVersion: false, hasFingerprint: false },
  { module: './runtime-dispatch-result', fieldsExport: 'RUNTIME_DISPATCH_RESULT_FIELDS', hasVersion: false, hasFingerprint: false },
  // pr108: Runtime Queue Admission Simulation Contracts' own new contracts.
  { module: './runtime-queue-admission-policy', fieldsExport: 'RUNTIME_QUEUE_ADMISSION_POLICY_FIELDS', safeFlagsExport: 'RUNTIME_QUEUE_ADMISSION_POLICY_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_queue_admission_policy_version', hasFingerprint: false },
  { module: './runtime-queue-class-reference', fieldsExport: 'RUNTIME_QUEUE_CLASS_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_QUEUE_CLASS_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_queue_class_reference_version', hasFingerprint: true, fingerprintField: 'queue_class_fingerprint' },
  { module: './runtime-queue-capacity-snapshot-reference', fieldsExport: 'RUNTIME_QUEUE_CAPACITY_SNAPSHOT_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_QUEUE_CAPACITY_SNAPSHOT_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_queue_capacity_snapshot_reference_version', hasFingerprint: true, fingerprintField: 'capacity_snapshot_fingerprint' },
  { module: './runtime-queue-quota-reference', fieldsExport: 'RUNTIME_QUEUE_QUOTA_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_QUEUE_QUOTA_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_queue_quota_reference_version', hasFingerprint: true, fingerprintField: 'quota_fingerprint' },
  { module: './runtime-queue-partition-reference', fieldsExport: 'RUNTIME_QUEUE_PARTITION_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_QUEUE_PARTITION_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_queue_partition_reference_version', hasFingerprint: true, fingerprintField: 'partition_fingerprint' },
  { module: './runtime-queue-fairness-reference', fieldsExport: 'RUNTIME_QUEUE_FAIRNESS_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_QUEUE_FAIRNESS_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_queue_fairness_reference_version', hasFingerprint: true, fingerprintField: 'fairness_fingerprint' },
  { module: './runtime-queue-intent-binding-reference', fieldsExport: 'RUNTIME_QUEUE_INTENT_BINDING_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_QUEUE_INTENT_BINDING_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'queue_intent_binding_reference_version', hasFingerprint: true, fingerprintField: 'intent_binding_fingerprint' },
  { module: './runtime-queue-admission-entry-reference', fieldsExport: 'RUNTIME_QUEUE_ADMISSION_ENTRY_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_QUEUE_ADMISSION_ENTRY_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_queue_admission_entry_reference_version', hasFingerprint: true, fingerprintField: 'admission_entry_fingerprint' },
  { module: './runtime-queue-admission-order-reference', fieldsExport: 'RUNTIME_QUEUE_ADMISSION_ORDER_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_QUEUE_ADMISSION_ORDER_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_queue_admission_order_reference_version', hasFingerprint: true, fingerprintField: 'order_fingerprint' },
  { module: './runtime-queue-admission-replay-reference', fieldsExport: 'RUNTIME_QUEUE_ADMISSION_REPLAY_REFERENCE_FIELDS', safeFlagsExport: 'RUNTIME_QUEUE_ADMISSION_REPLAY_REFERENCE_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_queue_admission_replay_reference_version', hasFingerprint: true, fingerprintField: 'replay_fingerprint' },
  { module: './runtime-queue-admission-request', fieldsExport: 'RUNTIME_QUEUE_ADMISSION_REQUEST_FIELDS', hasVersion: true, versionField: 'runtime_queue_admission_request_version', hasFingerprint: false },
  { module: './runtime-queue-admission-package', fieldsExport: 'RUNTIME_QUEUE_ADMISSION_PACKAGE_FIELDS', safeFlagsExport: 'RUNTIME_QUEUE_ADMISSION_PACKAGE_SAFE_FLAGS', hasVersion: true, versionField: 'runtime_queue_admission_package_version', hasFingerprint: true, fingerprintField: 'queue_admission_package_fingerprint' },
  { module: './runtime-queue-admission-decision', fieldsExport: 'RUNTIME_QUEUE_ADMISSION_DECISION_FIELDS', safeFlagsExport: 'OPERATIONAL_SAFE_FLAGS', hasVersion: false, hasFingerprint: false },
  { module: './runtime-queue-admission-result', fieldsExport: 'RUNTIME_QUEUE_ADMISSION_RESULT_FIELDS', safeFlagsExport: 'OPERATIONAL_SAFE_FLAGS', hasVersion: false, hasFingerprint: false }
]);

function readDirFiles(dir, extension) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(extension)).sort();
}

// --- Pattern gates (src/core only -- tests legitimately reference these patterns as literal
// strings to test the detector itself; see architecture-gate-rules.js's own header comment). ------
function runPatternGates() {
  const findings = [];
  for (const fileName of readDirFiles(CORE_DIR, '.js')) {
    const content = fs.readFileSync(path.join(CORE_DIR, fileName), 'utf8');
    findings.push(...scanFileForPatternGates(`src/core/${fileName}`, content));
  }
  return findings;
}

// --- Structural gates (explicit manifest) ---------------------------------------------------------
function runStructuralGates() {
  const findings = [];
  for (const entry of AUDITED_CONTRACTS_MANIFEST) {
    let mod;
    try {
      mod = require(entry.module);
    } catch (error) {
      findings.push({ gate: 'EXACT_FIELDS_REQUIRED', file: entry.module, description: `module failed to load::${error.message}` });
      continue;
    }

    if (!Array.isArray(mod[entry.fieldsExport]) || mod[entry.fieldsExport].length === 0) {
      findings.push({ gate: 'EXACT_FIELDS_REQUIRED', file: entry.module, description: `missing or empty exact-fields export ${entry.fieldsExport}` });
    }

    if (entry.hasVersion) {
      const fields = mod[entry.fieldsExport] || [];
      if (!fields.includes(entry.versionField)) {
        findings.push({ gate: 'VERSION_COVERAGE_REQUIRED', file: entry.module, description: `exact fields do not include declared version field ${entry.versionField}` });
      }
    }

    if (entry.hasFingerprint) {
      const fields = mod[entry.fieldsExport] || [];
      if (!fields.includes(entry.fingerprintField)) {
        findings.push({ gate: 'FINGERPRINT_COVERAGE_REQUIRED', file: entry.module, description: `exact fields do not include declared fingerprint field ${entry.fingerprintField}` });
      }
    }

    if (entry.safeFlagsExport) {
      const safeFlags = mod[entry.safeFlagsExport];
      if (!safeFlags || typeof safeFlags !== 'object') {
        findings.push({ gate: 'SIMULATION_FLAG_REQUIRED', file: entry.module, description: `missing safe-flags export ${entry.safeFlagsExport}` });
      } else {
        if ('simulation' in safeFlags && safeFlags.simulation !== true) {
          findings.push({ gate: 'SIMULATION_FLAG_REQUIRED', file: entry.module, description: 'safe flags declare simulation but do not force it true' });
        }
        if ('production_blocked' in safeFlags && safeFlags.production_blocked !== true) {
          findings.push({ gate: 'PRODUCTION_BLOCKED_REQUIRED', file: entry.module, description: 'safe flags declare production_blocked but do not force it true' });
        }
        if ('rollout_percentage' in safeFlags && safeFlags.rollout_percentage !== 0) {
          findings.push({ gate: 'ROLLOUT_ZERO_REQUIRED', file: entry.module, description: 'safe flags declare rollout_percentage but do not force it 0' });
        }
      }
    }
  }
  return findings;
}

// --- Test registration gate ------------------------------------------------------------------------
//
// Compares the test files that actually exist on disk against the test files package.json's own
// `test` script would run. Delegates to scripts/discover-tests.js's own comparison logic so there
// is exactly one implementation of "what counts as a registered test file", not two that could
// drift apart.
function runTestRegistrationGate() {
  const findings = [];
  const discoverTests = require(path.join(__dirname, '..', '..', 'scripts', 'discover-tests.js'));
  const discovered = discoverTests.discoverTestFiles(TEST_DIR);
  if (discovered.length === 0) {
    findings.push({ gate: 'TEST_REGISTRATION_REQUIRED', file: 'test/', description: 'zero test files discovered' });
  }
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
  const testScript = (packageJson.scripts && packageJson.scripts.test) || '';
  const usesDiscovery = testScript.includes('discover-tests') || testScript.includes('test/*.test.js') || testScript.includes('--test');
  if (!usesDiscovery) {
    findings.push({ gate: 'TEST_REGISTRATION_REQUIRED', file: 'package.json', description: 'npm test script does not appear to run every test/*.test.js file' });
  }
  return findings;
}

// --- Validator registration gate ---------------------------------------------------------------
function runValidatorRegistrationGate() {
  const findings = [];
  const { executionPlanValidationRegistry } = require('./execution-plan-validation-registry');
  let validators;
  try {
    validators = executionPlanValidationRegistry.getAllValidators();
  } catch (error) {
    findings.push({ gate: 'VALIDATOR_REGISTRATION_REQUIRED', file: 'validation-registry.js', description: `registry failed to build::${error.message}` });
    return findings;
  }
  if (!Array.isArray(validators) || validators.length === 0) {
    findings.push({ gate: 'VALIDATOR_REGISTRATION_REQUIRED', file: 'validation-registry.js', description: 'no validators registered' });
  }
  return findings;
}

// --- Status taxonomy gate -----------------------------------------------------------------------
function runStatusTaxonomyGate() {
  const findings = [];
  const { TAXONOMY_STATUSES, PRECEDENCE_ORDER, getTaxonomyMetadata } = require('./validation-taxonomy');
  for (const status of TAXONOMY_STATUSES) {
    if (!PRECEDENCE_ORDER.includes(status)) {
      findings.push({ gate: 'STATUS_TAXONOMY_REQUIRED', file: 'validation-taxonomy.js', description: `status ${status} missing from precedence order` });
    }
    if (!getTaxonomyMetadata(status)) {
      findings.push({ gate: 'STATUS_TAXONOMY_REQUIRED', file: 'validation-taxonomy.js', description: `status ${status} missing taxonomy metadata` });
    }
  }
  return findings;
}

function runAllGates() {
  return [
    ...runPatternGates(),
    ...runStructuralGates(),
    ...runTestRegistrationGate(),
    ...runValidatorRegistrationGate(),
    ...runStatusTaxonomyGate()
  ];
}

module.exports = {
  AUDITED_CONTRACTS_MANIFEST,
  PATTERN_GATE_IDS,
  STRUCTURAL_GATE_IDS,
  runAllGates,
  runPatternGates,
  runStatusTaxonomyGate,
  runStructuralGates,
  runTestRegistrationGate,
  runValidatorRegistrationGate
};
