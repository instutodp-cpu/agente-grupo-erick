'use strict';

const STAGING_ENVIRONMENT = 'staging';
const STAGING_PURPOSE = 'public_web_canary_execution';

function validatePublicWebStagingSecretAccessContract(contract) {
  const valid = Boolean(
    contract &&
    typeof contract === 'object' &&
    contract.environment === STAGING_ENVIRONMENT &&
    contract.purpose === STAGING_PURPOSE &&
    contract.production_allowed === false &&
    contract.exportable === false &&
    contract.single_request === true
  );
  return Object.freeze({
    valid,
    environment: STAGING_ENVIRONMENT,
    purpose: STAGING_PURPOSE,
    production_allowed: false,
    exportable: false,
    single_request: true,
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    blocked_reason: valid ? null : 'staging_secret_access_contract_invalid'
  });
}

module.exports = {
  STAGING_ENVIRONMENT,
  STAGING_PURPOSE,
  validatePublicWebStagingSecretAccessContract
};
