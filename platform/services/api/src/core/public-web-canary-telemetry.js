'use strict';

const TELEMETRY_FIELDS = Object.freeze([
  'provider_invoked',
  'transport_invoked',
  'external_network_called'
]);

function normalizeCanaryTelemetry(input = {}) {
  const providerInvoked = input.provider_invoked === true;
  const transportInvoked = input.transport_invoked === true;
  const externalNetworkCalled = input.external_network_called === true;
  return {
    provider_invoked: providerInvoked,
    transport_invoked: transportInvoked,
    external_network_called: externalNetworkCalled,
    simulated: !(providerInvoked && transportInvoked && externalNetworkCalled)
  };
}

function validateCanaryTelemetry(input = {}) {
  const telemetry = normalizeCanaryTelemetry(input);
  const errors = [];
  if (telemetry.transport_invoked && !telemetry.provider_invoked) errors.push('transport_requires_provider_invocation');
  if (telemetry.external_network_called && !telemetry.transport_invoked) errors.push('external_network_requires_transport_invocation');
  return { valid: errors.length === 0, errors, ...telemetry };
}

module.exports = {
  TELEMETRY_FIELDS,
  normalizeCanaryTelemetry,
  validateCanaryTelemetry
};
