'use strict';

const { findConfigurationForbiddenFields } = require('./provider-configuration-contract');

const STAGING_SECRET_REFERENCE_TYPE = 'public_web_staging_opaque_reference';
const STAGING_SECRET_REFERENCE_ENVIRONMENT = 'staging';
const ALLOWED_FIELDS = Object.freeze([
  'reference_id','reference_type','provider_id','workspace_type','tenant_id','environment',
  'status','reference_version','synthetic','disabled','revoked','required_secret_names','metadata'
]);
const ALLOWED_METADATA_FIELDS = Object.freeze(['label','purpose','classification']);

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validatePublicWebStagingSecretReference(reference) {
  const errors = [];
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
    return Object.freeze({ valid: false, errors: ['staging_secret_reference_must_be_object'] });
  }
  for (const key of Object.keys(reference)) {
    if (!ALLOWED_FIELDS.includes(key)) errors.push(`staging_secret_reference_unknown_field::${key}`);
  }
  for (const field of ['reference_id','provider_id','workspace_type','tenant_id']) {
    if (!nonEmpty(reference[field])) errors.push(`invalid_${field}`);
  }
  if (reference.reference_type !== STAGING_SECRET_REFERENCE_TYPE) errors.push('staging_secret_reference_type_mismatch');
  if (reference.environment !== STAGING_SECRET_REFERENCE_ENVIRONMENT) errors.push('staging_secret_reference_environment_mismatch');
  if (reference.status !== 'reference_registered' && reference.status !== 'structurally_ready') errors.push('staging_secret_reference_status_not_resolvable');
  if (!Number.isInteger(reference.reference_version) || reference.reference_version < 1) errors.push('invalid_reference_version');
  if (reference.synthetic !== true) errors.push('staging_secret_reference_must_be_synthetic');
  if (reference.disabled !== false) errors.push('staging_secret_reference_disabled');
  if (reference.revoked !== false) errors.push('staging_secret_reference_revoked');
  if (!Array.isArray(reference.required_secret_names) || reference.required_secret_names.length < 1 || reference.required_secret_names.some((x) => !nonEmpty(x))) {
    errors.push('required_secret_names_required');
  }
  if (!reference.metadata || typeof reference.metadata !== 'object' || Array.isArray(reference.metadata)) {
    errors.push('staging_secret_reference_metadata_must_be_object');
  } else {
    for (const key of Object.keys(reference.metadata)) {
      if (!ALLOWED_METADATA_FIELDS.includes(key)) errors.push(`staging_secret_reference_metadata_unknown_field::${key}`);
    }
    if (reference.metadata.purpose !== 'public_web_canary_execution') errors.push('staging_secret_reference_purpose_mismatch');
  }
  errors.push(...findConfigurationForbiddenFields(reference));
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze([...new Set(errors)].sort()),
    reference_type: STAGING_SECRET_REFERENCE_TYPE,
    environment: STAGING_SECRET_REFERENCE_ENVIRONMENT,
    exportable: false,
    production_allowed: false,
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false
  });
}

module.exports = {
  STAGING_SECRET_REFERENCE_TYPE,
  STAGING_SECRET_REFERENCE_ENVIRONMENT,
  validatePublicWebStagingSecretReference
};
