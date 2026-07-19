'use strict';

const { deepClone, findTranscriptionForbiddenFields, sanitizeTranscriptionData } = require('./transcription-contract');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { deepFreeze } = require('./transcription-provider-adapter-interface');
const { stablePayload } = require('./transcription-provider-contract-registry');

const TRANSCRIPTION_ORCHESTRATOR_AUDIT_VERSION = 'transcription_orchestrator_audit_v1';
const REQUIRED_ORCHESTRATOR_AUDIT_FIELDS = Object.freeze([
  'audit_id',
  'request_id',
  'pipeline',
  'steps',
  'logical_time',
  'sequence',
  'versions',
  'provider_slug',
  'adapter_id',
  'transport_contract_id',
  'decision',
  'blockers',
  'simulation',
  'network',
  'provider_execution',
  'executed',
  'validator_version'
]);

function cloneFrozen(value) {
  return deepFreeze(sanitizeTranscriptionData(deepClone(value)));
}

function validateTranscriptionOrchestratorAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['orchestrator_audit_must_be_object'] };
  const allowed = new Set(REQUIRED_ORCHESTRATOR_AUDIT_FIELDS);
  for (const field of REQUIRED_ORCHESTRATOR_AUDIT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(audit, field)) errors.push(`missing_${field}`);
  }
  for (const field of Object.keys(audit)) {
    if (!allowed.has(field)) errors.push(`unexpected_audit_field::${field}`);
  }
  for (const field of ['audit_id', 'request_id', 'pipeline', 'provider_slug', 'adapter_id', 'transport_contract_id', 'decision', 'validator_version']) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  if (!Array.isArray(audit.steps) || audit.steps.length === 0) errors.push('steps_required');
  if (!Number.isInteger(audit.logical_time) || audit.logical_time < 0) errors.push('logical_time_invalid');
  if (!Number.isInteger(audit.sequence) || audit.sequence < 1) errors.push('sequence_invalid');
  if (!isPlainObject(audit.versions)) errors.push('versions_must_be_object');
  if (!Array.isArray(audit.blockers)) errors.push('blockers_must_be_array');
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  if (audit.network !== false) errors.push('network_must_be_false');
  if (audit.provider_execution !== false) errors.push('provider_execution_must_be_false');
  if (audit.executed !== false) errors.push('executed_must_be_false');
  if (audit.validator_version !== TRANSCRIPTION_ORCHESTRATOR_AUDIT_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findTranscriptionForbiddenFields(audit));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildTranscriptionOrchestratorAudit(context = {}) {
  const request = context.request || {};
  const adapterMetadata = context.adapter_metadata || {};
  const transportContract = context.transport_contract || {};
  const audit = {
    audit_id: `audit_${request.request_id || 'missing'}`,
    request_id: request.request_id || 'request_not_available',
    pipeline: 'mock_transcription_orchestrator',
    steps: Object.freeze([...(context.steps || [])]),
    logical_time: Number.isInteger(context.logical_time) ? context.logical_time : 0,
    sequence: Number.isInteger(context.sequence) ? context.sequence : 1,
    versions: {
      request_version: request.request_version || 0,
      provider_contract_version: context.provider_contract ? context.provider_contract.contract_version : 0,
      adapter_version: adapterMetadata.adapter_version || 0,
      transport_version: transportContract.transport_version || 0
    },
    provider_slug: request.provider_slug || adapterMetadata.provider_slug || 'provider_not_available',
    adapter_id: adapterMetadata.adapter_id || 'adapter_not_available',
    transport_contract_id: transportContract.transport_contract_id || 'transport_not_available',
    decision: context.status || 'BLOCKED',
    blockers: uniqueSorted(context.blockers || []),
    simulation: true,
    network: false,
    provider_execution: false,
    executed: false,
    validator_version: TRANSCRIPTION_ORCHESTRATOR_AUDIT_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  REQUIRED_ORCHESTRATOR_AUDIT_FIELDS,
  TRANSCRIPTION_ORCHESTRATOR_AUDIT_VERSION,
  buildTranscriptionOrchestratorAudit,
  validateTranscriptionOrchestratorAudit
};
