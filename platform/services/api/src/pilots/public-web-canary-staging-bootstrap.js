'use strict';

const { createPublicWebNodeHttpsClient } = require('../adapters/public-web/public-web-node-https-client');
const { createPublicWebSafeDnsResolver } = require('../adapters/public-web/public-web-safe-dns-resolver');

const REQUIRED_CONTEXT_DEPENDENCIES = Object.freeze([
  'canarySessionRegistry',
  'targetAllowlist',
  'adapterRegistry',
  'lifecycleRegistry',
  'configurationRegistry',
  'secretReferenceRegistry',
  'secretResolver',
  'readinessResult',
  'rateLimitBudget',
  'costBudget',
  'featureFlagResolver',
  'killSwitchResolver',
  'operatorPolicy',
  'auditSink',
  'clock'
]);

function missingDependencies(options) {
  return REQUIRED_CONTEXT_DEPENDENCIES.filter((name) => !options[name]);
}

function blocked(reason, details = {}) {
  return Object.freeze({
    ok: false,
    operationalBootstrapConfigured: false,
    stagingRealTransportOptIn: false,
    production_allowed: false,
    blocked_reason: reason,
    missing_dependencies: details.missing_dependencies || []
  });
}

/**
 * Builds only the explicit non-production staging wiring. It does not select a
 * target, resolve a secret, or perform DNS/HTTP work during construction.
 */
function createPublicWebCanaryStagingBootstrap(options = {}) {
  if (options.operationalBootstrapConfigured !== true) return blocked('operational_bootstrap_not_configured');
  if (options.stagingRealTransportOptIn !== true) return blocked('staging_real_transport_opt_in_required');
  if (options.environment !== 'staging') return blocked('staging_environment_required');
  if (options.production === true || options.production_allowed === true) return blocked('production_blocked');
  if (options.maximum_requests !== 1) return blocked('maximum_requests_must_be_one');
  if (typeof options.rollout_percentage !== 'number' || options.rollout_percentage <= 0 || options.rollout_percentage > 1) {
    return blocked('rollout_percentage_must_be_at_most_one');
  }
  if (typeof options.featureFlagResolver !== 'function') return blocked('feature_flag_resolver_required');
  if (typeof options.killSwitchResolver !== 'function') return blocked('kill_switch_resolver_required');

  const missing = missingDependencies(options);
  if (missing.length > 0) return blocked('staging_context_dependency_missing', { missing_dependencies: missing });

  const nodeHttpsClient = options.nodeHttpsClient || createPublicWebNodeHttpsClient(options.httpClientOptions);
  const dnsResolver = options.dnsResolver || createPublicWebSafeDnsResolver(options.dnsOptions);
  if (!nodeHttpsClient || typeof nodeHttpsClient.execute !== 'function') return blocked('real_http_client_invalid');
  if (!dnsResolver || typeof dnsResolver.resolve !== 'function') return blocked('real_dns_resolver_invalid');

  return Object.freeze({
    ok: true,
    operationalBootstrapConfigured: true,
    stagingRealTransportOptIn: true,
    environment: 'staging',
    production: false,
    production_allowed: false,
    automatic_execution_allowed: false,
    realTransport: true,
    nodeHttpsClient,
    dnsResolver,
    ...Object.fromEntries(REQUIRED_CONTEXT_DEPENDENCIES.map((name) => [name, options[name]])),
    tenantAllowlist: options.tenantAllowlist,
    workspaceAllowlist: options.workspaceAllowlist,
    userAllowlist: options.userAllowlist,
    requireDurableAudit: options.requireDurableAudit === true,
    clock: options.clock
  });
}

module.exports = {
  REQUIRED_CONTEXT_DEPENDENCIES,
  createPublicWebCanaryStagingBootstrap
};
