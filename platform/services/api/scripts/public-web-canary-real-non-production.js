#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');
const { createPublicWebCanaryStagingBootstrap } = require('../src/pilots/public-web-canary-staging-bootstrap');
const {
  REQUIRED_CONFIRMATION,
  createPublicWebCanaryRealNonProductionExecutionBridge
} = require('../src/pilots/public-web-canary-real-non-production-execution-bridge');

const ALLOWED_FLAGS = new Set(['--bootstrap']);
const BOOTSTRAP_PATH = path.resolve(__dirname, '../config/public-web-canary-real-non-production.local.js');

function parseArgs(argv) {
  if (argv.length === 0) return { ok: true, bootstrapPath: BOOTSTRAP_PATH };
  if (argv.length !== 2 || argv[0] !== '--bootstrap' || !argv[1] || argv[1].startsWith('--')) {
    return { ok: false, reason: 'only_bootstrap_path_is_allowed' };
  }
  if (!ALLOWED_FLAGS.has(argv[0])) return { ok: false, reason: 'unknown_argument' };
  return { ok: true, bootstrapPath: path.resolve(argv[1]) };
}

function loadBootstrap(bootstrapPath) {
  if (!fs.existsSync(bootstrapPath)) return null;
  const loaded = require(bootstrapPath);
  return loaded && typeof loaded === 'object' ? loaded : null;
}

async function readExactConfirmation() {
  if (!input.isTTY || !output.isTTY) return '';
  output.write(`Digite exatamente: ${REQUIRED_CONFIRMATION}\n`);
  const rl = readline.createInterface({ input, output });
  try { return await rl.question('Confirmacao: '); }
  finally { rl.close(); }
}

async function executeOperationalCanary(options = {}) {
  const confirmationReader = options.confirmationReader || readExactConfirmation;
  const raw = options.bootstrap;
  if (!raw) return { ok: false, status: 'operational_bootstrap_not_configured', executed: false, real_provider_called: false };

  const runtime = createPublicWebCanaryStagingBootstrap(raw.runtime || {});
  if (!runtime.ok) return { ...runtime, status: 'operational_runtime_blocked', executed: false, real_provider_called: false };

  const featureEnabled = await runtime.featureFlagResolver('public_web_canary_real_non_production');
  if (featureEnabled !== true) return { ok: false, status: 'feature_flag_disabled', executed: false, real_provider_called: false };
  const killed = await runtime.killSwitchResolver('public_web_canary_real_non_production');
  if (killed !== false) return { ok: false, status: 'kill_switch_active', executed: false, real_provider_called: false };

  const confirmation = await confirmationReader();
  if (confirmation !== REQUIRED_CONFIRMATION) return { ok: false, status: 'exact_human_confirmation_required', executed: false, real_provider_called: false };

  const bridgeInput = Object.freeze({ ...(raw.bridgeInput || {}), activation_confirmation: confirmation });
  const bridge = createPublicWebCanaryRealNonProductionExecutionBridge({ clock: runtime.clock });
  return bridge.execute({ chain: raw.chain, bridgeInput, runtime });
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) { output.write(JSON.stringify({ ok:false, status:'cli_blocked', reason:parsed.reason })+'\n'); process.exitCode=2; return; }
  const bootstrap = loadBootstrap(parsed.bootstrapPath);
  try {
    const result = await executeOperationalCanary({ bootstrap });
    output.write(JSON.stringify(result, null, 2)+'\n');
    process.exitCode = result && result.ok ? 0 : 2;
  } catch (_error) {
    output.write(JSON.stringify({ ok:false, status:'operational_canary_failed_safe', executed:false, real_provider_called:false })+'\n');
    process.exitCode=3;
  }
}

if (require.main === module) main();
module.exports = { BOOTSTRAP_PATH, parseArgs, executeOperationalCanary };
