#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');
const { createPublicWebCanaryOperationalTrial, REQUIRED_CONFIRMATION } = require('../src/pilots/public-web-canary-operational-trial');

const ALLOWED_FLAGS = new Set(['--config', '--preflight-only', '--dry-run-only', '--report', '--cancel', '--trial-id']);
const MODE_FLAGS = new Set(['--preflight-only', '--dry-run-only', '--report', '--cancel']);
const VALUE_FLAGS = new Set(['--config', '--trial-id']);
const BLOCKED_FLAGS = new Set(['--force', '--yes', '--skip-preflight', '--skip-dry-run', '--production', '--url', '--target', '--token', '--secret', '--header', '--cookie']);
const BOOTSTRAP_PATH = path.resolve(__dirname, '../config/public-web-canary-trial-bootstrap.local.js');

function fail(code, reason) {
  return { ok: false, code, reason };
}

function parseArgs(argv) {
  const args = { mode: 'execute' };
  let modeSeen = false;
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (BLOCKED_FLAGS.has(item)) return fail(2, `blocked_argument:${item}`);
    if (!ALLOWED_FLAGS.has(item)) return fail(4, `unknown_argument:${item}`);
    if (MODE_FLAGS.has(item)) {
      if (modeSeen) return fail(4, 'multiple_modes_blocked');
      modeSeen = true;
      if (item === '--preflight-only') args.mode = 'preflight';
      else if (item === '--dry-run-only') args.mode = 'dry_run';
      else if (item === '--report') args.mode = 'report';
      else if (item === '--cancel') args.mode = 'cancel';
      continue;
    }
    if (VALUE_FLAGS.has(item)) {
      const value = argv[index + 1];
      if (typeof value !== 'string' || value.trim() === '' || value.startsWith('--')) return fail(4, `${item.slice(2)}_value_required`);
      if (item === '--config') args.configPath = value;
      else if (item === '--trial-id') args.trialId = value;
      index += 1;
      continue;
    }
  }
  if (!args.configPath && (args.mode === 'execute' || args.mode === 'preflight' || args.mode === 'dry_run')) return fail(4, 'config_required');
  if (!args.trialId && (args.mode === 'report' || args.mode === 'cancel')) return fail(4, 'trial_id_required');
  return { ok: true, args };
}

function loadBootstrap() {
  if (!fs.existsSync(BOOTSTRAP_PATH)) return null;
  const bootstrap = require(BOOTSTRAP_PATH);
  if (!bootstrap || typeof bootstrap !== 'object' || bootstrap.operationalBootstrapConfigured !== true) return null;
  return bootstrap;
}

async function readExactConfirmation() {
  if (!input.isTTY || !output.isTTY) return '';
  output.write(`Digite exatamente: ${REQUIRED_CONFIRMATION}\n`);
  const rl = readline.createInterface({ input, output });
  try {
    return await rl.question('Confirmacao: ');
  } finally {
    rl.close();
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    output.write(JSON.stringify({ ok: false, blocked_reason: parsed.reason }) + '\n');
    process.exitCode = parsed.code;
    return;
  }
  const bootstrap = loadBootstrap();
  const trial = createPublicWebCanaryOperationalTrial({
    ...(bootstrap || {}),
    injectedConfirmationReader: readExactConfirmation
  });
  try {
    let result;
    if (parsed.args.mode === 'report') result = trial.getTrialReport(parsed.args.trialId) || { ok: false, status: 'report_not_found' };
    else if (parsed.args.mode === 'cancel') result = trial.cancelTrial({ trial_id: parsed.args.trialId, request_id: `${parsed.args.trialId}_cancel`, change_id: `${parsed.args.trialId}_cancel_change`, expected_version: 1 });
    else if (parsed.args.mode === 'preflight') result = await trial.prepareTrial({ configPath: parsed.args.configPath, preflightOnly: true, ...(bootstrap || {}) });
    else if (parsed.args.mode === 'dry_run') result = await trial.prepareTrial({ configPath: parsed.args.configPath, ...(bootstrap || {}) });
    else if (!bootstrap) result = {
      ok: false,
      status: 'trial_operational_bootstrap_not_configured',
      error: { error_code: 'TRIAL_OPERATIONAL_BOOTSTRAP_NOT_CONFIGURED', blocked_reason: 'trial_operational_bootstrap_not_configured' },
      executed: false,
      real_provider_called: false
    };
    else result = await trial.executeTrial({ configPath: parsed.args.configPath, ...bootstrap });
    output.write(JSON.stringify(result, null, 2) + '\n');
    process.exitCode = result && result.ok ? 0 : 2;
  } catch (error) {
    output.write(JSON.stringify({ ok: false, status: 'trial_failed_safe' }) + '\n');
    process.exitCode = 3;
  }
}

main();
