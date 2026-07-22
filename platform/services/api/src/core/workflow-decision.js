'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { validateWorkflowContract } = require('./workflow-contract');
const { validateWorkflowStep } = require('./workflow-step-contract');

const WORKFLOW_DECISION_VALIDATOR_VERSION = 'workflow_decision_validator_v1';
const WORKFLOW_DECISION_FIELDS = Object.freeze([
  'decision_id', 'workflow_id', 'tenant_id', 'organization_id', 'status', 'decision', 'workflow_fingerprint',
  'step_fingerprints', 'blockers', 'reason_codes', 'workflow_executed', 'step_executed', 'tool_called',
  'model_called', 'provider_called', 'network_used', 'runtime_enabled', 'simulation', 'production_blocked',
  'rollout_percentage', 'validator_version'
]);
const DECISION_STATUSES = Object.freeze(['WORKFLOW_REGISTERED_SIMULATION', 'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED']);
const DECISION_VALUES = Object.freeze(['REGISTER_WORKFLOW_REFERENCE', 'BLOCKED']);
const NOT_AVAILABLE_FINGERPRINT = 'fingerprint_not_available';
const WORKFLOW_DECISION_SAFE_FLAGS = Object.freeze({
  workflow_executed: false,
  step_executed: false,
  tool_called: false,
  model_called: false,
  provider_called: false,
  network_used: false,
  runtime_enabled: false,
  simulation: true,
  production_blocked: true,
  rollout_percentage: 0
});

function fingerprint(value) {
  try {
    return stablePayload(value === undefined ? null : value);
  } catch (error) {
    return `fingerprint_invalid::${error.message}`;
  }
}

function isOrderedUniqueFingerprintList(list) {
  if (!Array.isArray(list) || list.length > 500) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateWorkflowDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) return { valid: false, errors: ['decision_must_be_object'] };
  exactFields(decision, WORKFLOW_DECISION_FIELDS, 'decision', errors);
  for (const field of ['decision_id', 'workflow_id', 'tenant_id', 'organization_id', 'workflow_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(decision[field])) errors.push(`${field}_invalid`);
  }
  if (!DECISION_STATUSES.includes(decision.status)) errors.push(`status_not_allowed::${decision.status}`);
  if (!DECISION_VALUES.includes(decision.decision)) errors.push(`decision_not_allowed::${decision.decision}`);
  if (!isOrderedUniqueFingerprintList(decision.step_fingerprints)) errors.push('step_fingerprints_invalid');
  if (!Array.isArray(decision.blockers) || !decision.blockers.every(isNonEmptyString)) errors.push('blockers_invalid');
  if (!Array.isArray(decision.reason_codes) || !decision.reason_codes.every(isNonEmptyString)) errors.push('reason_codes_invalid');
  for (const [field, expected] of Object.entries(WORKFLOW_DECISION_SAFE_FLAGS)) {
    if (decision[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (decision.status === 'WORKFLOW_REGISTERED_SIMULATION') {
    if (decision.decision !== 'REGISTER_WORKFLOW_REFERENCE') errors.push('decision_must_be_register_workflow_reference');
  } else if (decision.decision !== 'BLOCKED') {
    errors.push('decision_must_be_blocked');
  }
  if (decision.validator_version !== WORKFLOW_DECISION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(decision);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(decision));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function crossCheckReferenceBinding(reference, tenantId, organizationId, label, crossErrors, statusHolder) {
  if (!isPlainObject(reference)) return;
  if (reference.tenant_id !== tenantId) {
    crossErrors.push(`${label}_tenant_id_mismatch`);
    if (!statusHolder.value) statusHolder.value = 'TENANT_BLOCKED';
  }
  if (reference.organization_id !== organizationId) {
    crossErrors.push(`${label}_organization_id_mismatch`);
    if (!statusHolder.value) statusHolder.value = 'ORGANIZATION_BLOCKED';
  }
}

function buildWorkflowDecision(input = {}) {
  const { workflow, steps } = input;
  const workflowValidation = validateWorkflowContract(workflow);
  const stepList = Array.isArray(steps) ? steps : [];
  const stepValidations = stepList.map((step) => validateWorkflowStep(step));

  const structuralErrors = [];
  stepValidations.forEach((validation, index) => {
    structuralErrors.push(...validation.errors.map((error) => `steps[${index}]_${error}`));
  });

  const stepIds = [];
  const seenStepIds = new Set();
  stepList.forEach((step, index) => {
    if (!isPlainObject(step) || !isNonEmptyString(step.step_id)) return;
    if (seenStepIds.has(step.step_id)) structuralErrors.push(`steps_duplicate_step_id::${step.step_id}`);
    seenStepIds.add(step.step_id);
    stepIds.push(step.step_id);
  });

  const workflowStepReferences = isPlainObject(workflow) && Array.isArray(workflow.step_references) ? workflow.step_references : [];
  if (
    workflowStepReferences.length !== stepIds.length ||
    !workflowStepReferences.every((id) => seenStepIds.has(id))
  ) {
    structuralErrors.push('step_references_do_not_match_provided_steps');
  }

  stepList.forEach((step, index) => {
    if (!isPlainObject(step) || !Array.isArray(step.depends_on)) return;
    for (const dependency of step.depends_on) {
      if (!isPlainObject(dependency) || !isNonEmptyString(dependency.depends_on_step_id)) continue;
      if (dependency.depends_on_step_id === step.step_id) {
        structuralErrors.push(`steps[${index}]_depends_on_self::${step.step_id}`);
      } else if (!seenStepIds.has(dependency.depends_on_step_id)) {
        structuralErrors.push(`steps[${index}]_depends_on_unknown_step::${dependency.depends_on_step_id}`);
      }
    }
  });

  const crossErrors = [];
  const statusHolder = { value: null };
  const tenantId = isPlainObject(workflow) ? workflow.tenant_id : undefined;
  const organizationId = isPlainObject(workflow) ? workflow.organization_id : undefined;
  if (isPlainObject(workflow)) {
    crossCheckReferenceBinding(workflow.approval_policy_reference, tenantId, organizationId, 'approval_policy_reference', crossErrors, statusHolder);
    crossCheckReferenceBinding(workflow.timeout_reference, tenantId, organizationId, 'timeout_reference', crossErrors, statusHolder);
    crossCheckReferenceBinding(workflow.retry_reference, tenantId, organizationId, 'retry_reference', crossErrors, statusHolder);
    crossCheckReferenceBinding(workflow.compensation_reference, tenantId, organizationId, 'compensation_reference', crossErrors, statusHolder);
  }
  stepList.forEach((step, index) => {
    if (!isPlainObject(step)) return;
    for (const field of ['timeout_reference', 'retry_reference', 'compensation_reference']) {
      if (step[field] !== null) {
        crossCheckReferenceBinding(step[field], tenantId, organizationId, `steps[${index}]_${field}`, crossErrors, statusHolder);
      }
    }
  });

  const allValid = workflowValidation.valid && stepValidations.every((v) => v.valid) &&
    structuralErrors.length === 0 && crossErrors.length === 0;

  const status = allValid ? 'WORKFLOW_REGISTERED_SIMULATION' : (statusHolder.value || 'VALIDATION_FAILED');
  const isRegistered = status === 'WORKFLOW_REGISTERED_SIMULATION';
  const combinedErrors = uniqueSorted([
    ...workflowValidation.errors, ...structuralErrors, ...crossErrors
  ]);

  const stepFingerprints = isRegistered
    ? uniqueSorted(stepList.map((step) => fingerprint(step)))
    : [];

  const decision = {
    decision_id: input.decisionId || 'workflow_decision_not_available',
    workflow_id: (isPlainObject(workflow) && isNonEmptyString(workflow.workflow_id)) ? workflow.workflow_id : 'workflow_not_available',
    tenant_id: isNonEmptyString(tenantId) ? tenantId : 'tenant_not_available',
    organization_id: isNonEmptyString(organizationId) ? organizationId : 'organization_not_available',
    status,
    decision: isRegistered ? 'REGISTER_WORKFLOW_REFERENCE' : 'BLOCKED',
    workflow_fingerprint: fingerprint(workflow),
    step_fingerprints: stepFingerprints,
    blockers: uniqueSorted([...(input.blockers || []), ...(isRegistered ? [] : combinedErrors)]),
    reason_codes: uniqueSorted([...(input.reasonCodes || []), ...(isRegistered ? ['workflow_registered_simulation_only'] : combinedErrors.slice(0, 1))]),
    validator_version: WORKFLOW_DECISION_VALIDATOR_VERSION,
    ...WORKFLOW_DECISION_SAFE_FLAGS
  };

  const validation = validateWorkflowDecision(decision);
  if (!validation.valid) {
    return cloneFrozen({
      ...decision,
      status: statusHolder.value || 'VALIDATION_FAILED',
      decision: 'BLOCKED',
      workflow_fingerprint: decision.workflow_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      step_fingerprints: [],
      blockers: uniqueSorted([...decision.blockers, ...validation.errors]),
      reason_codes: uniqueSorted([...decision.reason_codes, validation.errors[0] || 'workflow_decision_invalid']),
      ...WORKFLOW_DECISION_SAFE_FLAGS
    });
  }
  return cloneFrozen(decision);
}

module.exports = {
  DECISION_STATUSES,
  DECISION_VALUES,
  NOT_AVAILABLE_FINGERPRINT,
  WORKFLOW_DECISION_FIELDS,
  WORKFLOW_DECISION_SAFE_FLAGS,
  WORKFLOW_DECISION_VALIDATOR_VERSION,
  buildWorkflowDecision,
  validateWorkflowDecision
};
