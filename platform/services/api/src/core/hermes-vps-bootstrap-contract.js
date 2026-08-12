'use strict';

const { isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');

const CONTRACT_VERSION = 'hermes-vps-bootstrap-contract-v1';
const RECEIPT_VERSION = 'hermes-vps-bootstrap-receipt-v1';
const HOST_ROLE = 'hermes_execution_plane';
const ENVIRONMENT = 'staging';
const DEFAULT_OS = 'ubuntu_server_lts';
const SUPPORTED_OS = Object.freeze(['ubuntu_server_lts', 'debian_stable']);
const SUPPORTED_ARCHITECTURES = Object.freeze(['x86_64', 'arm64']);
const MUTATION_CLASSES = Object.freeze([
  'READ_ONLY', 'LOCAL_CONFIG', 'PACKAGE_INSTALL', 'SERVICE_CONFIG',
  'NETWORK_CONFIG', 'FIREWALL_CONFIG', 'FILESYSTEM_MUTATION', 'SERVICE_START',
  'EXTERNAL_MUTATION'
]);
const EXECUTION_FLAGS = Object.freeze([
  'production_execution_default', 'provider_execution_default',
  'shell_execution_default', 'network_execution_default',
  'scheduler_execution_default', 'queue_execution_default', 'worker_execution_default'
]);
const SAFE_MODE_FLAGS = Object.freeze({
  safe_mode: true,
  production_execution_default: false,
  provider_execution_default: false,
  shell_execution_default: false,
  network_execution_default: false,
  scheduler_execution_default: false,
  queue_execution_default: false,
  worker_execution_default: false,
  production_effect: 'ZERO'
});

function exactFields(value, fields, prefix, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${prefix}_must_be_object`);
    return;
  }
  const expected = new Set(fields);
  for (const key of Object.keys(value)) if (!expected.has(key)) errors.push(`${prefix}_unknown_field::${key}`);
  for (const field of fields) if (!Object.prototype.hasOwnProperty.call(value, field)) errors.push(`${prefix}_missing_field::${field}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!isPlainObject(value) && !Array.isArray(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function hashContract(contract) {
  const copy = clone(contract);
  if (copy.provenance) delete copy.provenance.contract_hash;
  delete copy.contract_hash;
  return computeCanonicalContentDigest(JSON.parse(stablePayload(copy)));
}

function buildHermesVpsBootstrapContract(overrides = {}) {
  const base = {
    contract_version: CONTRACT_VERSION,
    host_role: HOST_ROLE,
    operating_system: DEFAULT_OS,
    architecture: 'x86_64',
    hostname_policy: 'operator_assigned_non_secret',
    timezone: 'UTC',
    locale: 'C.UTF-8',
    environment: ENVIRONMENT,
    network: {
      inbound_policy: 'deny_by_default',
      outbound_policy: 'deny_by_default',
      allowed_tcp_ports: [443],
      denied_by_default: true,
      ipv4_required: true,
      ipv6_policy: 'disabled_or_explicitly_controlled',
      dns_policy: 'resolver_required_no_credentials'
    },
    ssh: {
      root_login: false,
      password_authentication: false,
      key_authentication: true,
      allowed_users: ['non_root_admin'],
      allowed_source_policy: 'restricted_operator_sources'
    },
    firewall: {
      enabled: true,
      default_inbound: 'deny',
      default_outbound: 'deny',
      explicit_rules: [{ id: 'https_443', direction: 'inbound', protocol: 'tcp', port: 443, action: 'allow' }]
    },
    runtime: {
      container_runtime: 'docker_compatible',
      compose_or_orchestrator: 'docker_compose',
      restart_policy: 'unless_stopped_with_health_gate',
      resource_limits_required: true,
      healthcheck_required: true
    },
    reverse_proxy: {
      required: true,
      tls_required: true,
      http_to_https_redirect: true,
      allowed_public_routes: ['/hermes-canary/v1/health']
    },
    filesystem: {
      application_root: '/opt/hermes/app',
      config_root: '/etc/hermes',
      data_root: '/var/lib/hermes',
      logs_root: '/var/log/hermes',
      backup_root: '/var/backups/hermes',
      temp_policy: 'ephemeral_no_secrets'
    },
    secrets: {
      storage_policy: 'runtime_injection_only',
      plaintext_forbidden: true,
      repository_forbidden: true,
      logging_forbidden: true,
      rotation_supported: true
    },
    logging: {
      structured_logs: true,
      retention_policy: 'bounded_and_rotated',
      secret_redaction: true,
      correlation_id_required: true
    },
    monitoring: {
      health_endpoint: '/hermes-canary/v1/health',
      host_metrics: true,
      disk_usage_monitoring: true,
      memory_monitoring: true,
      process_monitoring: true,
      alerting_contract: 'declarative_operator_alerts_required'
    },
    backups: {
      enabled: true,
      scope: 'persistent_data_and_config_metadata_without_secret_values',
      frequency_policy: 'operator_defined_before_bootstrap',
      retention_policy: 'operator_defined_before_bootstrap',
      restore_test_required: true
    },
    updates: {
      os_security_updates: 'supported_automatic_policy',
      runtime_update_policy: 'pinned_reviewed_updates',
      application_update_policy: 'exact_revision_only',
      rollback_required: true
    },
    deployment: {
      strategy: 'immutable_revision',
      immutable_artifact_preferred: true,
      exact_revision_required: true,
      health_gate_required: true,
      rollback_on_failure: true
    },
    execution_safety: { ...SAFE_MODE_FLAGS },
    provenance: {
      repository: 'instutodp-cpu/agente-grupo-erick',
      branch: null,
      commit_sha: null,
      contract_hash: null
    }
  };
  const merged = {
    ...base,
    ...overrides,
    network: { ...base.network, ...(overrides.network || {}) },
    ssh: { ...base.ssh, ...(overrides.ssh || {}) },
    firewall: { ...base.firewall, ...(overrides.firewall || {}) },
    runtime: { ...base.runtime, ...(overrides.runtime || {}) },
    reverse_proxy: { ...base.reverse_proxy, ...(overrides.reverse_proxy || {}) },
    filesystem: { ...base.filesystem, ...(overrides.filesystem || {}) },
    secrets: { ...base.secrets, ...(overrides.secrets || {}) },
    logging: { ...base.logging, ...(overrides.logging || {}) },
    monitoring: { ...base.monitoring, ...(overrides.monitoring || {}) },
    backups: { ...base.backups, ...(overrides.backups || {}) },
    updates: { ...base.updates, ...(overrides.updates || {}) },
    deployment: { ...base.deployment, ...(overrides.deployment || {}) },
    execution_safety: { ...base.execution_safety, ...(overrides.execution_safety || {}) },
    provenance: { ...base.provenance, ...(overrides.provenance || {}) }
  };
  merged.provenance.contract_hash = hashContract(merged);
  return deepFreeze(merged);
}

function validateHermesVpsBootstrapContract(contract) {
  const errors = [];
  if (!isPlainObject(contract)) return { valid: false, errors: ['contract_must_be_object'] };
  const fields = ['contract_version', 'host_role', 'operating_system', 'architecture', 'hostname_policy', 'timezone', 'locale', 'environment', 'network', 'ssh', 'firewall', 'runtime', 'reverse_proxy', 'filesystem', 'secrets', 'logging', 'monitoring', 'backups', 'updates', 'deployment', 'execution_safety', 'provenance'];
  exactFields(contract, fields, 'contract', errors);
  exactFields(contract.network, ['inbound_policy', 'outbound_policy', 'allowed_tcp_ports', 'denied_by_default', 'ipv4_required', 'ipv6_policy', 'dns_policy'], 'network', errors);
  exactFields(contract.ssh, ['root_login', 'password_authentication', 'key_authentication', 'allowed_users', 'allowed_source_policy'], 'ssh', errors);
  exactFields(contract.firewall, ['enabled', 'default_inbound', 'default_outbound', 'explicit_rules'], 'firewall', errors);
  exactFields(contract.runtime, ['container_runtime', 'compose_or_orchestrator', 'restart_policy', 'resource_limits_required', 'healthcheck_required'], 'runtime', errors);
  exactFields(contract.reverse_proxy, ['required', 'tls_required', 'http_to_https_redirect', 'allowed_public_routes'], 'reverse_proxy', errors);
  exactFields(contract.filesystem, ['application_root', 'config_root', 'data_root', 'logs_root', 'backup_root', 'temp_policy'], 'filesystem', errors);
  exactFields(contract.secrets, ['storage_policy', 'plaintext_forbidden', 'repository_forbidden', 'logging_forbidden', 'rotation_supported'], 'secrets', errors);
  exactFields(contract.logging, ['structured_logs', 'retention_policy', 'secret_redaction', 'correlation_id_required'], 'logging', errors);
  exactFields(contract.monitoring, ['health_endpoint', 'host_metrics', 'disk_usage_monitoring', 'memory_monitoring', 'process_monitoring', 'alerting_contract'], 'monitoring', errors);
  exactFields(contract.backups, ['enabled', 'scope', 'frequency_policy', 'retention_policy', 'restore_test_required'], 'backups', errors);
  exactFields(contract.updates, ['os_security_updates', 'runtime_update_policy', 'application_update_policy', 'rollback_required'], 'updates', errors);
  exactFields(contract.deployment, ['strategy', 'immutable_artifact_preferred', 'exact_revision_required', 'health_gate_required', 'rollback_on_failure'], 'deployment', errors);
  exactFields(contract.execution_safety, Object.keys(SAFE_MODE_FLAGS), 'execution_safety', errors);
  exactFields(contract.provenance, ['repository', 'branch', 'commit_sha', 'contract_hash'], 'provenance', errors);
  if (contract.contract_version !== CONTRACT_VERSION) errors.push('contract_version_invalid');
  if (contract.host_role !== HOST_ROLE) errors.push('host_role_invalid');
  if (contract.operating_system !== DEFAULT_OS || !SUPPORTED_OS.includes(contract.operating_system)) errors.push('unsupported_or_noncanonical_os');
  if (!SUPPORTED_ARCHITECTURES.includes(contract.architecture)) errors.push('architecture_invalid');
  if (contract.environment !== ENVIRONMENT) errors.push('environment_must_be_staging');
  if (contract.network && (contract.network.inbound_policy !== 'deny_by_default' || contract.network.outbound_policy !== 'deny_by_default' || contract.network.denied_by_default !== true || JSON.stringify(contract.network.allowed_tcp_ports) !== '[443]')) errors.push('network_not_deny_by_default');
  if (contract.ssh && (contract.ssh.root_login !== false || contract.ssh.password_authentication !== false || contract.ssh.key_authentication !== true)) errors.push('ssh_policy_invalid');
  if (contract.firewall && (contract.firewall.enabled !== true || contract.firewall.default_inbound !== 'deny' || contract.firewall.default_outbound !== 'deny')) errors.push('firewall_policy_invalid');
  if (contract.runtime && (contract.runtime.resource_limits_required !== true || contract.runtime.healthcheck_required !== true)) errors.push('runtime_safety_requirements_missing');
  if (contract.reverse_proxy && (contract.reverse_proxy.required !== true || contract.reverse_proxy.tls_required !== true)) errors.push('reverse_proxy_tls_required');
  if (contract.secrets && Object.values(contract.secrets).some((value, index) => index < 3 && value !== true && value !== 'runtime_injection_only')) errors.push('secret_policy_invalid');
  if (contract.logging && (contract.logging.structured_logs !== true || contract.logging.secret_redaction !== true || contract.logging.correlation_id_required !== true)) errors.push('logging_requirements_missing');
  if (contract.backups && contract.backups.restore_test_required !== true) errors.push('backup_restore_test_required');
  if (contract.deployment && Object.values(contract.deployment).some((value, index) => index > 0 && value !== true && typeof value !== 'string')) errors.push('deployment_requirement_invalid');
  if (contract.execution_safety && Object.entries(SAFE_MODE_FLAGS).some(([key, value]) => contract.execution_safety[key] !== value)) errors.push('safe_mode_boundary_invalid');
  if (contract.provenance && (contract.provenance.repository !== 'instutodp-cpu/agente-grupo-erick' || typeof contract.provenance.branch !== 'string' || !/^[0-9a-f]{40}$/.test(contract.provenance.commit_sha || ''))) errors.push('exact_provenance_required');
  if (contract.provenance && contract.provenance.contract_hash !== hashContract(contract)) errors.push('contract_hash_mismatch');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildHermesVpsBootstrapPlan(contract, options = {}) {
  const validation = validateHermesVpsBootstrapContract(contract);
  if (!validation.valid) throw new Error(`invalid_host_contract::${validation.errors.join(',')}`);
  const steps = [
    ['host_preflight', 'READ_ONLY', false, false, false, true],
    ['local_config_prepare', 'LOCAL_CONFIG', false, false, false, true],
    ['package_installation', 'PACKAGE_INSTALL', true, true, false, true],
    ['service_configuration', 'SERVICE_CONFIG', false, true, false, true],
    ['network_policy_configuration', 'NETWORK_CONFIG', false, true, false, true],
    ['firewall_policy_configuration', 'FIREWALL_CONFIG', false, true, false, true],
    ['filesystem_prepare', 'FILESYSTEM_MUTATION', false, true, false, true],
    ['service_start_after_health_gate', 'SERVICE_START', false, true, false, true]
  ].map(([id, mutation_class, requires_network, requires_root, requires_secret, reversible]) => ({
    id,
    category: mutation_class === 'READ_ONLY' ? 'preflight' : 'bootstrap',
    description: `Declarative future step: ${id}`,
    mutation_class,
    requires_network,
    requires_root,
    requires_secret,
    reversible,
    idempotency_key: `hermes-vps-bootstrap-v1::${id}`,
    precondition: `precondition::${id}`,
    postcondition: `postcondition::${id}`
  }));
  const plan = {
    contract_version: CONTRACT_VERSION,
    target_host_fingerprint: options.target_host_fingerprint || 'host_fingerprint_required',
    expected_os: contract.operating_system,
    expected_arch: contract.architecture,
    execution_mode: 'plan_only',
    mutations_executed: false,
    authorization_required: true,
    steps,
    preconditions: ['supported_os', 'supported_architecture', 'safe_configuration', 'exact_revision'],
    postconditions: ['safe_mode_preserved', 'health_gate_defined', 'audit_requirements_preserved'],
    rollback_steps: steps.filter((step) => step.reversible).map((step) => ({ step_id: step.id, action: `rollback::${step.id}`, preserves: ['logs', 'receipts', 'audit_trail', 'secrets', 'persistent_data'] }))
  };
  plan.plan_hash = computeCanonicalContentDigest(JSON.parse(stablePayload(plan)));
  return deepFreeze(plan);
}

function validateHermesVpsBootstrapPlan(plan) {
  const errors = [];
  if (!isPlainObject(plan)) return { valid: false, errors: ['plan_must_be_object'] };
  if (plan.contract_version !== CONTRACT_VERSION) errors.push('plan_contract_version_invalid');
  if (plan.execution_mode !== 'plan_only' || plan.mutations_executed !== false) errors.push('plan_must_not_execute');
  if (!isCanonicalContentDigest(plan.plan_hash)) errors.push('plan_hash_invalid');
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) errors.push('plan_steps_required');
  else {
    const ids = plan.steps.map((step) => step.id);
    if (new Set(ids).size !== ids.length) errors.push('plan_step_ids_must_be_unique');
    for (const step of plan.steps) {
      if (!MUTATION_CLASSES.includes(step.mutation_class)) errors.push(`plan_mutation_class_invalid::${step.id}`);
      if (step.idempotency_key !== `hermes-vps-bootstrap-v1::${step.id}`) errors.push(`plan_idempotency_key_invalid::${step.id}`);
    }
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateHermesVpsBootstrapPreflight(input) {
  const errors = [];
  if (!isPlainObject(input)) return { valid: false, status: 'UNKNOWN', errors: ['preflight_input_must_be_object'] };
  const required = ['contract', 'observed_host'];
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(input, key)) errors.push(`preflight_missing::${key}`);
  const contractResult = input.contract ? validateHermesVpsBootstrapContract(input.contract) : { valid: false, errors: [] };
  if (!contractResult.valid) errors.push(...contractResult.errors.map((error) => `contract::${error}`));
  const host = input.observed_host;
  if (host && isPlainObject(host)) {
    if (host.operating_system !== input.contract.operating_system) errors.push('host_os_mismatch');
    if (host.architecture !== input.contract.architecture) errors.push('host_architecture_mismatch');
    if (host.timezone !== input.contract.timezone) errors.push('host_timezone_mismatch');
    if (host.is_root !== false) errors.push('root_execution_context_forbidden');
    if (host.disk_free_bytes < 10737418240) errors.push('disk_minimum_not_met');
    if (host.memory_bytes < 2147483648) errors.push('memory_minimum_not_met');
    if (host.cpu_count < 2) errors.push('cpu_minimum_not_met');
    if (!Array.isArray(host.open_tcp_ports) || host.open_tcp_ports.some((port) => ![443].includes(port))) errors.push('unexpected_open_port');
    if (host.container_runtime !== 'docker_compatible') errors.push('container_runtime_missing');
    if (!Array.isArray(host.conflicting_paths) || host.conflicting_paths.length !== 0) errors.push('conflicting_paths_present');
    if (host.secrets_in_prohibited_paths !== false) errors.push('prohibited_secret_path_detected');
    if (host.branch !== input.contract.provenance.branch || host.commit_sha !== input.contract.provenance.commit_sha) errors.push('revision_provenance_mismatch');
  } else errors.push('observed_host_required');
  return { valid: errors.length === 0, status: errors.length === 0 ? 'READY' : 'NOT_READY', errors: uniqueSorted(errors) };
}

function buildHermesVpsBootstrapReceipt(values = {}) {
  return deepFreeze({
    contract_version: RECEIPT_VERSION,
    target_host_fingerprint: values.target_host_fingerprint || 'host_fingerprint_required',
    plan_hash: values.plan_hash || 'plan_hash_required',
    execution_authorization_id: values.execution_authorization_id || 'authorization_id_required',
    started_at: values.started_at || null,
    finished_at: values.finished_at || null,
    steps_attempted: values.steps_attempted || [],
    steps_succeeded: values.steps_succeeded || [],
    steps_failed: values.steps_failed || [],
    rollback_attempted: values.rollback_attempted || false,
    rollback_result: values.rollback_result || 'not_attempted',
    final_host_state: values.final_host_state || 'not_executed',
    production_effect: 'ZERO',
    real_execution_performed: false
  });
}

function validateHermesVpsBootstrapReceipt(receipt) {
  const errors = [];
  const fields = ['contract_version', 'target_host_fingerprint', 'plan_hash', 'execution_authorization_id', 'started_at', 'finished_at', 'steps_attempted', 'steps_succeeded', 'steps_failed', 'rollback_attempted', 'rollback_result', 'final_host_state', 'production_effect', 'real_execution_performed'];
  exactFields(receipt, fields, 'receipt', errors);
  if (receipt && receipt.contract_version !== RECEIPT_VERSION) errors.push('receipt_contract_version_invalid');
  if (receipt && (receipt.production_effect !== 'ZERO' || receipt.real_execution_performed !== false)) errors.push('receipt_execution_boundary_invalid');
  if (receipt && (!isCanonicalContentDigest(receipt.plan_hash) || typeof receipt.execution_authorization_id !== 'string')) errors.push('receipt_provenance_invalid');
  if (receipt && (Object.keys(receipt).some((key) => /secret|token|password|cookie|credential|api_key|private_key/i.test(key)))) errors.push('receipt_secret_field_forbidden');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  CONTRACT_VERSION,
  DEFAULT_OS,
  ENVIRONMENT,
  MUTATION_CLASSES,
  RECEIPT_VERSION,
  SAFE_MODE_FLAGS,
  SUPPORTED_ARCHITECTURES,
  SUPPORTED_OS,
  buildHermesVpsBootstrapContract,
  buildHermesVpsBootstrapPlan,
  buildHermesVpsBootstrapReceipt,
  hashContract,
  validateHermesVpsBootstrapContract,
  validateHermesVpsBootstrapPlan,
  validateHermesVpsBootstrapPreflight,
  validateHermesVpsBootstrapReceipt
};
