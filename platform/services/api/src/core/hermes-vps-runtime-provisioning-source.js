'use strict';

const { isPlainObject } = require('./read-only-adapter-contract');
const {
  buildHermesVpsBootstrapContract
} = require('./hermes-vps-bootstrap-contract');
const {
  buildHermesVpsProvisioningPlan
} = require('./hermes-vps-provisioning-plan');

const RUNTIME_PROVISIONING_SOURCE_VERSION = 'hermes-vps-runtime-provisioning-source-v1';
const INPUT_FIELDS = Object.freeze(['provenance', 'bootstrap_overrides']);
const PROVENANCE_FIELDS = Object.freeze(['repository', 'branch', 'commit_sha']);
const FORBIDDEN_INPUT_KEYS = new Set([
  'databaseurl',
  'hermesdurabledatabaseurl',
  'postgresurl',
  'supabaseurl',
  'supabasekey',
  'password',
  'token',
  'credential',
  'connectionstring',
  'secret'
]);

function invalidInput(reason) {
  const error = new Error(`hermes_runtime_provisioning_input_${reason}`);
  error.code = `HERMES_RUNTIME_PROVISIONING_INPUT_${reason.toUpperCase()}`;
  return error;
}

function exactFields(value, fields, reason) {
  if (!isPlainObject(value)) throw invalidInput(`${reason}_must_be_object`);
  const expected = new Set(fields);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) throw invalidInput(`${reason}_unknown_field`);
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) throw invalidInput(`${reason}_${field}_required`);
  }
}

function normalizedKey(key) {
  return String(key).replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function rejectSecretMaterial(value) {
  if (!isPlainObject(value) && !Array.isArray(value)) {
    if (typeof value === 'string' && /postgres(?:ql)?:\/\//i.test(value)) throw invalidInput('secret_material_forbidden');
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_INPUT_KEYS.has(normalizedKey(key))) throw invalidInput('secret_material_forbidden');
    rejectSecretMaterial(child);
  }
}

function createHermesVpsRuntimeProvisioning({ input } = {}) {
  exactFields(input, INPUT_FIELDS, 'input');
  exactFields(input.provenance, PROVENANCE_FIELDS, 'provenance');
  if (!isPlainObject(input.bootstrap_overrides)) throw invalidInput('bootstrap_overrides_must_be_object');

  rejectSecretMaterial(input);

  const bootstrap_contract = buildHermesVpsBootstrapContract({
    ...input.bootstrap_overrides,
    provenance: { ...input.provenance }
  });
  const provisioning_plan = buildHermesVpsProvisioningPlan({ bootstrap_contract });

  return Object.freeze({
    runtime_provisioning_source_version: RUNTIME_PROVISIONING_SOURCE_VERSION,
    bootstrap_contract,
    provisioning_plan
  });
}

module.exports = {
  INPUT_FIELDS,
  RUNTIME_PROVISIONING_SOURCE_VERSION,
  createHermesVpsRuntimeProvisioning
};
