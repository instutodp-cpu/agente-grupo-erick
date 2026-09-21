#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createPublicWebCanaryOperationalTrial, REQUIRED_CONFIRMATION } = require('../src/pilots/public-web-canary-operational-trial');

const CONFIG_PATH = path.resolve(__dirname, '../config/public-web-canary-third-target.json');
const BOOTSTRAP_PATH = path.resolve(__dirname, '../config/public-web-canary-trial-bootstrap.local.js');

function fail(reason) {
  process.stdout.write(JSON.stringify({ ok: false, status: 'third_canary_execution_blocked', blocked_reason: reason, executed: false, external_network_called: false }) + '\n');
  process.exitCode = 2;
}

async function main() {
  const confirmation = process.env.HERMES_THIRD_CANARY_CONFIRMATION || '';
  if (confirmation !== REQUIRED_CONFIRMATION) return fail('exact_human_confirmation_required');
  if (!fs.existsSync(CONFIG_PATH)) return fail('third_canary_target_config_missing');
  if (!fs.existsSync(BOOTSTRAP_PATH)) return fail('trial_operational_bootstrap_not_configured');

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (
    config.environment !== 'staging' ||
    config.origin !== 'https://example.com' ||
    config.path !== '/' ||
    config.method !== 'GET' ||
    config.port !== 443 ||
    config.maximum_requests !== 1 ||
    config.rollout_percentage !== 1 ||
    config.redirects_allowed !== false
  ) return fail('immutable_third_canary_scope_mismatch');

  const bootstrap = require(BOOTSTRAP_PATH);
  if (!bootstrap || bootstrap.operationalBootstrapConfigured !== true) return fail('trial_operational_bootstrap_not_configured');

  const trial = createPublicWebCanaryOperationalTrial({
    ...bootstrap,
    injectedConfirmationReader: async () => confirmation
  });
  const result = await trial.executeTrial({ configPath: CONFIG_PATH, ...bootstrap });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result && result.ok ? 0 : 2;
}

main().catch(() => fail('third_canary_execution_failed_safe'));
