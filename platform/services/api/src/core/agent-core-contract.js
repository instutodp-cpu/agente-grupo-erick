'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  cloneFrozen,
  exactFields,
  findAgentCoreOperationalMaterial,
  stablePayload
} = require('./agent-identity-contract');
const { validateAgentIdentity } = require('./agent-identity-contract');
const { validateAgentMetadata } = require('./agent-metadata-contract');
const { validateAgentContext, validateAgentSimulationContext } = require('./agent-context-contract');
const { validateAgentLifecycle } = require('./agent-lifecycle-contract');
const { validateAgentCapability, isOrderedUniqueRefList } = require('./agent-capability-contract');

const AGENT_CORE_CONTRACT_VALIDATOR_VERSION = 'agent_core_contract_validator_v1';
const AGENT_CORE_CONTRACT_FIELDS = Object.freeze([
  'contract_id',
  'contract_version',
  'identity',
  'metadata',
  'context',
  'lifecycle',
  'capabilities',
  'policy_references',
  'dependency_references',
  'simulation_context',
  'contract_status',
  'validation_summary',
  'validator_version'
]);
const AGENT_CONTRACT_STATUSES = Object.freeze([
  'VALIDATED_SIMULATION',
  'INVALID',
  'POLICY_BLOCKED',
  'TENANT_BLOCKED',
  'VERSION_BLOCKED',
  'DEPENDENCY_BLOCKED'
]);
const FORBIDDEN_AGENT_CONTRACT_STATUSES = Object.freeze(['ACTIVE', 'EXECUTABLE']);
const VALIDATION_SUMMARY_FIELDS = Object.freeze([
  'identity_valid',
  'metadata_valid',
  'context_valid',
  'lifecycle_valid',
  'capabilities_valid',
  'tenant_binding_valid',
  'organization_binding_valid',
  'versions_valid',
  'dependencies_valid',
  'policy_references_valid',
  'executable_material_absent',
  'validation_errors',
  'validation_warnings',
  'validator_version'
]);
const MAX_CAPABILITIES = 50;

function validateValidationSummary(summary) {
  const errors = [];
  if (!isPlainObject(summary)) return { valid: false, errors: ['validation_summary_must_be_object'] };
  exactFields(summary, VALIDATION_SUMMARY_FIELDS, 'validation_summary', errors);
  for (const field of ['identity_valid', 'metadata_valid', 'context_valid', 'lifecycle_valid', 'capabilities_valid', 'tenant_binding_valid', 'organization_binding_valid', 'versions_valid', 'dependencies_valid', 'policy_references_valid', 'executable_material_absent']) {
    if (typeof summary[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (!Array.isArray(summary.validation_errors) || !summary.validation_errors.every(isNonEmptyString)) errors.push('validation_errors_invalid');
  if (!Array.isArray(summary.validation_warnings) || !summary.validation_warnings.every(isNonEmptyString)) errors.push('validation_warnings_invalid');
  if (summary.validator_version !== AGENT_CORE_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateAgentCoreContract(contract) {
  const errors = [];
  if (!isPlainObject(contract)) return { valid: false, errors: ['agent_core_contract_must_be_object'] };
  exactFields(contract, AGENT_CORE_CONTRACT_FIELDS, 'agent_core_contract', errors);
  if (!isNonEmptyString(contract.contract_id)) errors.push('contract_id_invalid');
  if (!Number.isInteger(contract.contract_version) || contract.contract_version < 1) errors.push('contract_version_invalid');
  if (!AGENT_CONTRACT_STATUSES.includes(contract.contract_status)) errors.push(`contract_status_not_allowed::${contract.contract_status}`);
  if (FORBIDDEN_AGENT_CONTRACT_STATUSES.includes(contract.contract_status)) errors.push(`contract_status_forbidden::${contract.contract_status}`);
  if (!isOrderedUniqueRefList(contract.policy_references)) errors.push('policy_references_invalid');
  if (!isOrderedUniqueRefList(contract.dependency_references)) errors.push('dependency_references_invalid');
  if (!Array.isArray(contract.capabilities) || contract.capabilities.length > MAX_CAPABILITIES) errors.push('capabilities_invalid');
  const identityValidation = validateAgentIdentity(contract.identity);
  errors.push(...identityValidation.errors.map((error) => `identity_${error}`));
  const metadataValidation = validateAgentMetadata(contract.metadata);
  errors.push(...metadataValidation.errors.map((error) => `metadata_${error}`));
  const contextValidation = validateAgentContext(contract.context);
  errors.push(...contextValidation.errors.map((error) => `context_${error}`));
  const lifecycleValidation = validateAgentLifecycle(contract.lifecycle);
  errors.push(...lifecycleValidation.errors.map((error) => `lifecycle_${error}`));
  const capabilityValidations = Array.isArray(contract.capabilities) ? contract.capabilities.map((capability) => validateAgentCapability(capability)) : [];
  capabilityValidations.forEach((validation, index) => errors.push(...validation.errors.map((error) => `capabilities[${index}]_${error}`)));
  const simulationValidation = validateAgentSimulationContext(contract.simulation_context);
  errors.push(...simulationValidation.errors.map((error) => `simulation_context_${error}`));
  const summaryValidation = validateValidationSummary(contract.validation_summary);
  errors.push(...summaryValidation.errors.map((error) => `validation_summary_${error}`));
  if (contract.validator_version !== AGENT_CORE_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(contract);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function tenantBindingValid(identity, metadata, context, lifecycle, capabilities) {
  if (!isPlainObject(identity) || !isNonEmptyString(identity.tenant_id)) return false;
  const tenantId = identity.tenant_id;
  if (isPlainObject(metadata) && metadata.tenant_id !== tenantId) return false;
  if (isPlainObject(context) && context.tenant_id !== tenantId) return false;
  if (isPlainObject(lifecycle) && lifecycle.tenant_id !== tenantId) return false;
  if (Array.isArray(capabilities) && !capabilities.every((capability) => isPlainObject(capability) && capability.tenant_id === tenantId)) return false;
  return true;
}

function organizationBindingValid(identity, context) {
  if (!isPlainObject(identity) || !isNonEmptyString(identity.organization_id)) return false;
  if (!isPlainObject(context) || context.organization_id !== identity.organization_id) return false;
  return true;
}

function agentIdBindingValid(identity, metadata, context, lifecycle, capabilities) {
  if (!isPlainObject(identity) || !isNonEmptyString(identity.agent_id)) return false;
  const agentId = identity.agent_id;
  if (isPlainObject(metadata) && metadata.agent_id !== agentId) return false;
  if (isPlainObject(context) && context.agent_id !== agentId) return false;
  if (isPlainObject(lifecycle) && lifecycle.agent_id !== agentId) return false;
  if (Array.isArray(capabilities) && !capabilities.every((capability) => isPlainObject(capability) && capability.agent_id === agentId)) return false;
  return true;
}

function buildAgentCoreContract(input = {}) {
  const identity = input.identity || {};
  const metadata = input.metadata || {};
  const context = input.context || {};
  const lifecycle = input.lifecycle || {};
  const capabilities = Array.isArray(input.capabilities) ? input.capabilities : [];
  const policyReferences = Array.isArray(input.policy_references) ? input.policy_references : [];
  const dependencyReferences = Array.isArray(input.dependency_references) ? input.dependency_references : [];
  const simulationContext = input.simulation_context || {};

  const identityValidation = validateAgentIdentity(identity);
  const metadataValidation = validateAgentMetadata(metadata);
  const contextValidation = validateAgentContext(context);
  const lifecycleValidation = validateAgentLifecycle(lifecycle);
  const capabilityValidations = capabilities.map((capability) => validateAgentCapability(capability));
  const capabilitiesValid = capabilities.length <= MAX_CAPABILITIES && capabilityValidations.every((validation) => validation.valid);
  const simulationValidation = validateAgentSimulationContext(simulationContext);
  const policyReferencesValid = isOrderedUniqueRefList(policyReferences);
  const dependenciesValid = isOrderedUniqueRefList(dependencyReferences);

  const tenantValid = tenantBindingValid(identity, metadata, context, lifecycle, capabilities) && agentIdBindingValid(identity, metadata, context, lifecycle, capabilities);
  const organizationValid = organizationBindingValid(identity, context);
  const versionsValid = Number.isInteger(input.contract_version) && input.contract_version >= 1;

  const executableMaterialAbsent = findAgentCoreOperationalMaterial({
    identity,
    metadata,
    context,
    lifecycle,
    capabilities,
    policy_references: policyReferences,
    dependency_references: dependencyReferences
  }).length === 0;

  const validationErrors = uniqueSorted([
    ...identityValidation.errors.map((error) => `identity_${error}`),
    ...metadataValidation.errors.map((error) => `metadata_${error}`),
    ...contextValidation.errors.map((error) => `context_${error}`),
    ...lifecycleValidation.errors.map((error) => `lifecycle_${error}`),
    ...capabilityValidations.flatMap((validation, index) => validation.errors.map((error) => `capabilities[${index}]_${error}`)),
    ...simulationValidation.errors.map((error) => `simulation_context_${error}`),
    ...(policyReferencesValid ? [] : ['policy_references_invalid']),
    ...(dependenciesValid ? [] : ['dependency_references_invalid']),
    ...(tenantValid ? [] : ['tenant_binding_invalid']),
    ...(organizationValid ? [] : ['organization_binding_invalid']),
    ...(versionsValid ? [] : ['contract_version_invalid']),
    ...(executableMaterialAbsent ? [] : ['executable_material_present'])
  ]);

  const allSubValid = identityValidation.valid && metadataValidation.valid && contextValidation.valid &&
    lifecycleValidation.valid && capabilitiesValid && simulationValidation.valid &&
    policyReferencesValid && dependenciesValid && executableMaterialAbsent;

  let status;
  if (!tenantValid) status = 'TENANT_BLOCKED';
  else if (!allSubValid) status = 'INVALID';
  else if (!versionsValid) status = 'VERSION_BLOCKED';
  else if (!dependenciesValid) status = 'DEPENDENCY_BLOCKED';
  else status = 'VALIDATED_SIMULATION';

  const validationSummary = {
    identity_valid: identityValidation.valid,
    metadata_valid: metadataValidation.valid,
    context_valid: contextValidation.valid,
    lifecycle_valid: lifecycleValidation.valid,
    capabilities_valid: capabilitiesValid,
    tenant_binding_valid: tenantValid,
    organization_binding_valid: organizationValid,
    versions_valid: versionsValid,
    dependencies_valid: dependenciesValid,
    policy_references_valid: policyReferencesValid,
    executable_material_absent: executableMaterialAbsent,
    validation_errors: validationErrors,
    validation_warnings: [],
    validator_version: AGENT_CORE_CONTRACT_VALIDATOR_VERSION
  };

  const contract = {
    contract_id: isNonEmptyString(input.contract_id) ? input.contract_id : 'contract_not_available',
    contract_version: Number.isInteger(input.contract_version) ? input.contract_version : 0,
    identity,
    metadata,
    context,
    lifecycle,
    capabilities,
    policy_references: policyReferences,
    dependency_references: dependencyReferences,
    simulation_context: simulationContext,
    contract_status: status,
    validation_summary: validationSummary,
    validator_version: AGENT_CORE_CONTRACT_VALIDATOR_VERSION
  };

  const contractValidation = validateAgentCoreContract(contract);
  const finalContract = contractValidation.valid ? contract : {
    ...contract,
    contract_status: status === 'VALIDATED_SIMULATION' ? 'INVALID' : status,
    validation_summary: {
      ...validationSummary,
      validation_errors: uniqueSorted([...validationErrors, ...contractValidation.errors])
    }
  };

  let contractFingerprint = 'invalid_contract';
  let contextFingerprint = 'invalid_context';
  let capabilityFingerprints = [];
  try {
    contractFingerprint = stablePayload(finalContract);
  } catch (_error) {
    contractFingerprint = 'invalid_contract';
  }
  try {
    contextFingerprint = stablePayload(context);
  } catch (_error) {
    contextFingerprint = 'invalid_context';
  }
  try {
    capabilityFingerprints = uniqueSorted(capabilities.map((capability) => stablePayload(capability)));
  } catch (_error) {
    capabilityFingerprints = [];
  }

  return cloneFrozen({
    contract: finalContract,
    contract_fingerprint: contractFingerprint,
    context_fingerprint: contextFingerprint,
    capability_fingerprints: capabilityFingerprints,
    executed: false,
    runtime_enabled: false,
    simulation: true,
    production_blocked: true,
    rollout_percentage: 0
  });
}

module.exports = {
  AGENT_CONTRACT_STATUSES,
  AGENT_CORE_CONTRACT_FIELDS,
  AGENT_CORE_CONTRACT_VALIDATOR_VERSION,
  FORBIDDEN_AGENT_CONTRACT_STATUSES,
  MAX_CAPABILITIES,
  VALIDATION_SUMMARY_FIELDS,
  buildAgentCoreContract,
  validateAgentCoreContract,
  validateValidationSummary
};
