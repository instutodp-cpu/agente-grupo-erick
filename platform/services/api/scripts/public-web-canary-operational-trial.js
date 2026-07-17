#!/usr/bin/env node
'use strict';

const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');
const { createPublicWebCanaryOperationalTrial, REQUIRED_CONFIRMATION } = require('../src/pilots/public-web-canary-operational-trial');

const ALLOWED_FLAGS = new Set(['--config', '--preflight-only', '--dry-run-only', '--report', '--cancel']);
const BLOCKED_FLAGS = new Set(['--force', '--yes', '--skip-preflight', '--skip-dry-run', '--production', '--url', '--target', '--token', '--secret', '--header', '--cookie']);

function parseArgs(argv) {
  const args = { mode: 'execute' };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (BLOCKED_FLAGS.has(item)) return { ok: false, code: 2, reason: `blocked_argument:${item}` };
    if (!ALLOWED_FLAGS.has(item)) return { ok: false, code: 4, reason: `unknown_argument:${item}` };
    if (item === '--config') {
      args.configPath = argv[index + 1];
      index += 1;
    } else if (item === '--preflight-only') args.mode = 'preflight';
    else if (item === '--dry-run-only') args.mode = 'dry_run';
    else if (item === '--report') args.mode = 'report';
    else if (item === '--cancel') args.mode = 'cancel';
  }
  if (!args.configPath && args.mode !== 'report' && args.mode !== 'cancel') return { ok: false, code: 4, reason: 'config_required' };
  return { ok: true, args };
}

async function readExactConfirmation() {
  if (!input.isTTY || !output.isTTY) return '';
  output.write('Digite exatamente: EXECUTAR CANARY PUBLIC WEB\n');
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
  const trial = createPublicWebCanaryOperationalTrial({
    injectedConfirmationReader: readExactConfirmation
  });
  try {
    let result;
    if (parsed.args.mode === 'report') result = { ok: false, status: 'report_requires_runtime_context' };
    else if (parsed.args.mode === 'cancel') result = { ok: false, status: 'cancel_requires_runtime_context' };
    else if (parsed.args.mode === 'preflight') result = await trial.prepareTrial({ configPath: parsed.args.configPath });
    else if (parsed.args.mode === 'dry_run') result = await trial.prepareTrial({ configPath: parsed.args.configPath });
    else result = await trial.executeTrial({ configPath: parsed.args.configPath });
    output.write(JSON.stringify(result, null, 2) + '\n');
    process.exitCode = result && result.ok ? 0 : 2;
  } catch (error) {
    output.write(JSON.stringify({ ok: false, status: 'trial_failed_safe' }) + '\n');
    process.exitCode = 3;
  }
}

main();
