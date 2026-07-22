'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { TOOL_CATEGORIES, validateToolContract } = require('./tool-contract');
const { TOOL_CAPABILITIES, validateToolCapabilityContract } = require('./tool-capability-contract');
const { validateToolPermissionContract } = require('./tool-permission-contract');
const { validateToolCostContract } = require('./tool-cost-contract');
const { validateToolSideEffectsContract } = require('./tool-side-effects-contract');

const TOOL_DECISION_VALIDATOR_VERSION = 'tool_decision_validator_v1';
const TOOL_DECISION_FIELDS = Object.freeze([
  'decision_id', 'tool_id', 'tenant_id', 'organization_id', 'status', 'decision', 'tool_fingerprint',
  'capability_fingerprint', 'permission_fingerprint', 'cost_fingerprint', 'side_effect_fingerprint', 'category',
  'capabilities', 'blockers', 'reason_codes', 'executed', 'runtime_enabled', 'network_used', 'provider_called',
  'tool_called', 'simulation', 'production_blocked', 'rollout_percentage', 'validator_version'
]);
const DECISION_STATUSES = Object.freeze(['TOOL_REGISTERED_SIMULATION', 'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED']);
const DECISION_VALUES = Object.freeze(['REGISTER_TOOL_REFERENCE', 'BLOCKED']);
const NOT_AVAILABLE_FINGERPRINT = 'fingerprint_not_available';
const TOOL_DECISION_SAFE_FLAGS = Object.freeze({
  executed: false,
  runtime_enabled: false,
  network_used: false,
  provider_called: false,
  tool_called: false,
  simulation: true,
  production_blocked: true,
  rollout_percentage: 0
});

function isOrderedUniqueDecisionCapabilityList(list) {
  if (!Array.isArray(list) || list.length > TOOL_CAPABILITIES.length) return false;
  if (!list.every((item) => isNonEmptyString(item) && TOOL_CAPABILITIES.includes(item))) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function fingerprint(value) {
  try {
    return stablePayload(value === undefined ? null : value);
  } catch (error) {
    return `fingerprint_invalid::${error.message}`;
  }
}

function validateToolDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) return { valid: false, errors: ['decision_must_be_object'] };
  exactFields(decision, TOOL_DECISION_FIELDS, 'decision', errors);
  for (const field of [
    'decision_id', 'tool_id', 'tenant_id', 'organization_id', 'tool_fingerprint', 'capability_fingerprint',
    'permission_fingerprint', 'cost_fingerprint', 'side_effect_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(decision[field])) errors.push(`${field}_invalid`);
  }
  if (!DECISION_STATUSES.includes(decision.status)) errors.push(`status_not_allowed::${decision.status}`);
  if (!DECISION_VALUES.includes(decision.decision)) errors.push(`decision_not_allowed::${decision.decision}`);
  if (!TOOL_CATEGORIES.includes(decision.category)) errors.push(`category_not_allowed::${decision.category}`);
  if (!isOrderedUniqueDecisionCapabilityList(decision.capabilities)) errors.push('capabilities_invalid');
  if (!Array.isArray(decision.blockers) || !decision.blockers.every(isNonEmptyString)) errors.push('blockers_invalid');
  if (!Array.isArray(decision.reason_codes) || !decision.reason_codes.every(isNonEmptyString)) errors.push('reason_codes_invalid');
  for (const [field, expected] of Object.entries(TOOL_DECISION_SAFE_FLAGS)) {
    if (decision[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (decision.status === 'TOOL_REGISTERED_SIMULATION') {
    if (decision.decision !== 'REGISTER_TOOL_REFERENCE') errors.push('decision_must_be_register_tool_reference');
  } else if (decision.decision !== 'BLOCKED') {
    errors.push('decision_must_be_blocked');
  }
  if (decision.validator_version !== TOOL_DECISION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(decision);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(decision));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildToolDecision(input = {}) {
  const { tool, capabilitySet, permissionSet, costReference, sideEffectReference } = input;
  const toolValidation = validateToolContract(tool);
  const capabilityValidation = validateToolCapabilityContract(capabilitySet);
  const permissionValidation = validateToolPermissionContract(permissionSet);
  const costValidation = validateToolCostContract(costReference);
  const sideEffectValidation = validateToolSideEffectsContract(sideEffectReference);

  const crossErrors = [];
  const tenantId = isPlainObject(tool) ? tool.tenant_id : undefined;
  const organizationId = isPlainObject(tool) ? tool.organization_id : undefined;
  const toolId = isPlainObject(tool) ? tool.tool_id : undefined;
  let crossStatus = null;
  for (const [label, sub] of [
    ['capability_set', capabilitySet], ['permission_set', permissionSet], ['cost_reference', costReference],
    ['side_effect_reference', sideEffectReference]
  ]) {
    if (!isPlainObject(sub)) continue;
    if (sub.tool_id !== toolId) crossErrors.push(`${label}_tool_id_mismatch`);
    if (sub.tenant_id !== tenantId) { crossErrors.push(`${label}_tenant_id_mismatch`); crossStatus = crossStatus || 'TENANT_BLOCKED'; }
    if (sub.organization_id !== organizationId) { crossErrors.push(`${label}_organization_id_mismatch`); crossStatus = crossStatus || 'ORGANIZATION_BLOCKED'; }
  }

  const allValid = toolValidation.valid && capabilityValidation.valid && permissionValidation.valid &&
    costValidation.valid && sideEffectValidation.valid && crossErrors.length === 0;

  const status = allValid ? 'TOOL_REGISTERED_SIMULATION' : (crossStatus || 'VALIDATION_FAILED');
  const isRegistered = status === 'TOOL_REGISTERED_SIMULATION';
  const combinedErrors = uniqueSorted([
    ...toolValidation.errors, ...capabilityValidation.errors, ...permissionValidation.errors,
    ...costValidation.errors, ...sideEffectValidation.errors, ...crossErrors
  ]);

  const decision = {
    decision_id: input.decisionId || 'tool_decision_not_available',
    tool_id: toolId || 'tool_not_available',
    tenant_id: tenantId || 'tenant_not_available',
    organization_id: organizationId || 'organization_not_available',
    status,
    decision: isRegistered ? 'REGISTER_TOOL_REFERENCE' : 'BLOCKED',
    tool_fingerprint: fingerprint(tool),
    capability_fingerprint: fingerprint(capabilitySet),
    permission_fingerprint: fingerprint(permissionSet),
    cost_fingerprint: fingerprint(costReference),
    side_effect_fingerprint: fingerprint(sideEffectReference),
    category: isPlainObject(tool) && TOOL_CATEGORIES.includes(tool.category) ? tool.category : 'CUSTOM_REFERENCE',
    capabilities: isRegistered && isPlainObject(capabilitySet) && Array.isArray(capabilitySet.capabilities) ? [...capabilitySet.capabilities].sort() : [],
    blockers: uniqueSorted([...(input.blockers || []), ...(isRegistered ? [] : combinedErrors)]),
    reason_codes: uniqueSorted([...(input.reasonCodes || []), ...(isRegistered ? ['tool_registered_simulation_only'] : combinedErrors.slice(0, 1))]),
    validator_version: TOOL_DECISION_VALIDATOR_VERSION,
    ...TOOL_DECISION_SAFE_FLAGS
  };

  const validation = validateToolDecision(decision);
  if (!validation.valid) {
    return cloneFrozen({
      ...decision,
      status: crossStatus || 'VALIDATION_FAILED',
      decision: 'BLOCKED',
      tool_fingerprint: decision.tool_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      capability_fingerprint: decision.capability_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      permission_fingerprint: decision.permission_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      cost_fingerprint: decision.cost_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      side_effect_fingerprint: decision.side_effect_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      capabilities: [],
      blockers: uniqueSorted([...decision.blockers, ...validation.errors]),
      reason_codes: uniqueSorted([...decision.reason_codes, validation.errors[0] || 'tool_decision_invalid']),
      ...TOOL_DECISION_SAFE_FLAGS
    });
  }
  return cloneFrozen(decision);
}

module.exports = {
  DECISION_STATUSES,
  DECISION_VALUES,
  NOT_AVAILABLE_FINGERPRINT,
  TOOL_DECISION_FIELDS,
  TOOL_DECISION_SAFE_FLAGS,
  TOOL_DECISION_VALIDATOR_VERSION,
  buildToolDecision,
  validateToolDecision
};
