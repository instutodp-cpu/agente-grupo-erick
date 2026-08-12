'use strict';

const { isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');

const CONTRACT_VERSION = 'hermes-execution-host-contract-v1';
const HOST_ROLE = 'hermes_execution_plane';
const CONTROL_PLANE = 'base44_maestro';
const EXECUTION_PLANE = 'hermes_vps';
const ENVIRONMENTS = Object.freeze(['staging']);
const CAPABILITIES = Object.freeze([
  'CAPABILITY_NETWORK_OUTBOUND',
  'CAPABILITY_PROVIDER_CALL',
  'CAPABILITY_SHELL_EXECUTION',
  'CAPABILITY_QUEUE_MUTATION',
  'CAPABILITY_SCHEDULER_MUTATION',
  'CAPABILITY_DISPATCH',
  'CAPABILITY_SECRET_RESOLUTION',
  'CAPABILITY_OPERATIONAL_PERSISTENCE',
  'CAPABILITY_PRODUCTION_EFFECT'
]);

const HOST_FIELDS = Object.freeze([
  'contract_version', 'host_role', 'environment', 'production_allowed',
  'control_plane', 'execution_plane', 'network', 'services', 'secrets',
  'execution', 'audit', 'deployment', 'capabilities'
]);
const NETWORK_FIELDS = Object.freeze(['inbound', 'outbound']);
const INBOUND_FIELDS = Object.freeze(['default', 'allowed']);
const OUTBOUND_FIELDS = Object.freeze(['default', 'policy_controlled']);
const SERVICE_FIELDS = Object.freeze([
  'reverse_proxy', 'hermes_api', 'hermes_worker', 'scheduler', 'queue', 'public_web_canary'
]);
const SECRET_FIELDS = Object.freeze(['plaintext_repository', 'plaintext_filesystem', 'runtime_injection_required']);
const EXECUTION_FIELDS = Object.freeze([
  'provider_without_authorization', 'shell_without_authorization',
  'network_without_authorization', 'production_execution'
]);
const AUDIT_FIELDS = Object.freeze(['receipts_required', 'correlation_id_required', 'authorization_binding_required']);
const DEPLOYMENT_FIELDS = Object.freeze(['containerized', 'reproducible', 'docker_compose_preferred']);

function exactFields(value, fields, prefix, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${prefix}_must_be_object`);
    return;
  }
  const expected = new Set(fields);
  for (const key of Object.keys(value)) if (!expected.has(key)) errors.push(`${prefix}_unknown_field::${key}`);
  for (const field of fields) if (!Object.prototype.hasOwnProperty.call(value, field)) errors.push(`${prefix}_missing_field::${field}`);
}

function hashContract(contract) {
  const copy = JSON.parse(JSON.stringify(contract));
  delete copy.contract_fingerprint;
  return computeCanonicalContentDigest(JSON.parse(stablePayload(copy)));
}

function buildHermesExecutionHostContract(overrides = {}) {
  const contract = {
    contract_version: CONTRACT_VERSION,
    host_role: HOST_ROLE,
    environment: 'staging',
    production_allowed: false,
    control_plane: CONTROL_PLANE,
    execution_plane: EXECUTION_PLANE,
    network: {
      inbound: { default: 'deny', allowed: ['https_443'] },
      outbound: { default: 'deny', policy_controlled: true }
    },
    services: {
      reverse_proxy: true, hermes_api: true, hermes_worker: true,
      scheduler: true, queue: true, public_web_canary: true
    },
    secrets: {
      plaintext_repository: 'forbidden', plaintext_filesystem: 'forbidden', runtime_injection_required: true
    },
    execution: {
      provider_without_authorization: 'forbidden', shell_without_authorization: 'forbidden',
      network_without_authorization: 'forbidden', production_execution: 'forbidden'
    },
    audit: { receipts_required: true, correlation_id_required: true, authorization_binding_required: true },
    deployment: { containerized: true, reproducible: true, docker_compose_preferred: true },
    capabilities: Object.fromEntries(CAPABILITIES.map((capability) => [capability, false]))
  };
  const merged = {
    ...contract,
    ...overrides,
    network: { ...contract.network, ...(overrides.network || {}) },
    services: { ...contract.services, ...(overrides.services || {}) },
    secrets: { ...contract.secrets, ...(overrides.secrets || {}) },
    execution: { ...contract.execution, ...(overrides.execution || {}) },
    audit: { ...contract.audit, ...(overrides.audit || {}) },
    deployment: { ...contract.deployment, ...(overrides.deployment || {}) },
    capabilities: { ...contract.capabilities, ...(overrides.capabilities || {}) }
  };
  merged.contract_fingerprint = hashContract(merged);
  return Object.freeze(merged);
}

function validateHermesExecutionHostContract(contract) {
  const errors = [];
  if (!isPlainObject(contract)) return { valid: false, errors: ['host_contract_must_be_object'] };
  exactFields(contract, [...HOST_FIELDS, 'contract_fingerprint'], 'host_contract', errors);
  exactFields(contract.network, NETWORK_FIELDS, 'network', errors);
  exactFields(contract.network && contract.network.inbound, INBOUND_FIELDS, 'inbound', errors);
  exactFields(contract.network && contract.network.outbound, OUTBOUND_FIELDS, 'outbound', errors);
  exactFields(contract.services, SERVICE_FIELDS, 'services', errors);
  exactFields(contract.secrets, SECRET_FIELDS, 'secrets', errors);
  exactFields(contract.execution, EXECUTION_FIELDS, 'execution', errors);
  exactFields(contract.audit, AUDIT_FIELDS, 'audit', errors);
  exactFields(contract.deployment, DEPLOYMENT_FIELDS, 'deployment', errors);

  if (contract.contract_version !== CONTRACT_VERSION) errors.push('contract_version_invalid');
  if (contract.host_role !== HOST_ROLE) errors.push('host_role_invalid');
  if (!ENVIRONMENTS.includes(contract.environment)) errors.push('environment_blocked');
  if (contract.production_allowed !== false) errors.push('production_must_remain_blocked');
  if (contract.control_plane !== CONTROL_PLANE || contract.execution_plane !== EXECUTION_PLANE) errors.push('plane_identity_invalid');
  if (contract.network && contract.network.inbound && (contract.network.inbound.default !== 'deny' || JSON.stringify(contract.network.inbound.allowed) !== '["https_443"]')) errors.push('inbound_not_deny_by_default');
  if (contract.network && contract.network.outbound && (contract.network.outbound.default !== 'deny' || contract.network.outbound.policy_controlled !== true)) errors.push('outbound_not_deny_by_default');
  if (contract.secrets && (contract.secrets.plaintext_repository !== 'forbidden' || contract.secrets.plaintext_filesystem !== 'forbidden' || contract.secrets.runtime_injection_required !== true)) errors.push('secret_policy_invalid');
  if (contract.execution && Object.values(contract.execution).some((value) => value !== 'forbidden')) errors.push('execution_boundary_invalid');
  if (contract.audit && Object.values(contract.audit).some((value) => value !== true)) errors.push('audit_requirement_missing');
  if (contract.deployment && Object.values(contract.deployment).some((value) => value !== true)) errors.push('deployment_contract_invalid');
  if (!isPlainObject(contract.capabilities)) errors.push('capabilities_must_be_object');
  else {
    const keys = Object.keys(contract.capabilities);
    for (const capability of CAPABILITIES) if (contract.capabilities[capability] !== false) errors.push(`capability_must_not_be_granted::${capability}`);
    for (const key of keys) if (!CAPABILITIES.includes(key)) errors.push(`capabilities_unknown_field::${key}`);
  }
  if (contract.contract_fingerprint !== hashContract(contract)) errors.push('contract_fingerprint_mismatch');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  CAPABILITIES,
  CONTRACT_VERSION,
  ENVIRONMENTS,
  buildHermesExecutionHostContract,
  hashContract,
  validateHermesExecutionHostContract
};
