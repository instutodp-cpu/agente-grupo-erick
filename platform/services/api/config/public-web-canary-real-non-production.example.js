'use strict';

// TEMPLATE ONLY. Copy to public-web-canary-real-non-production.local.js.
// Never commit the local copy or database credentials. The template deliberately
// keeps real transport disabled and provides no operational authorization.
// Prerequisites: staging-only PostgreSQL credentials injected securely via
// environment (prefer POSTGRES_PASSWORD_FILE over raw password values),
// verified CA file, and a separately approved human reauth flow.
const { Pool } = require('pg');
const { createPublicWebCanaryOperationalPostgresBootstrap } =
  require('../src/pilots/public-web-canary-operational-postgres-bootstrap');

const environment = { ...process.env };
if (environment.HERMES_PUBLIC_WEB_REAL_CANARY_ENABLED === 'true' ||
    environment.HERMES_PUBLIC_WEB_REAL_CANARY_KILL_SWITCH === 'false' ||
    environment.HERMES_PUBLIC_WEB_READ_ONLY_ENABLED === 'true' ||
    environment.HERMES_PUBLIC_WEB_READ_ONLY_KILL_SWITCH === 'false') {
  throw new Error('template_requires_all_execution_flags_fail_closed');
}

const operational = createPublicWebCanaryOperationalPostgresBootstrap({
  environment,
  PoolClass: Pool,
  runtime: {
    operationalBootstrapConfigured: true,
    stagingRealTransportOptIn: true,
    environment: 'staging',
    production: false,
    production_allowed: false,
    maximum_requests: 1,
    rollout_percentage: 1
  }
});

// No preparedExecution or operationalComposition: execution is impossible
// through this template. Preflight may check durable audit connectivity.
module.exports = Object.freeze({
  runtime: operational.bootstrap,
  close: operational.close
});
